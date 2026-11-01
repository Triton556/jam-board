use crate::*;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

/// A write result and whether its stable request ID was replayed.
pub struct Receipted<T> {
    pub value: T,
    pub replayed: bool,
}

pub(crate) fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let sorted = object
                .iter()
                .map(|(key, value)| (key.clone(), canonical_json(value)))
                .collect::<std::collections::BTreeMap<_, _>>();
            serde_json::to_value(sorted).expect("JSON values")
        }
        Value::Array(array) => Value::Array(array.iter().map(canonical_json).collect()),
        _ => value.clone(),
    }
}
pub(crate) fn canonical_hash(value: &Value) -> Result<String> {
    Ok(crate::storage_io::hash(&serde_json::to_vec(
        &canonical_json(value),
    )?))
}

/// Compact wire metadata shared by MCP writes and persisted receipts.
pub fn compact_mutation(kind: &str, value: &Value) -> Value {
    let replayed = value.get("replayed").is_some_and(|v| v == true);
    let task_version = value.get("taskVersion").filter(|v| v.is_object());
    let value = if value.get("id").is_none() {
        let reference = value.get("reference").filter(|v| v.is_object());
        let asset = value.get("asset").filter(|v| v.is_object());
        if kind == "reference" {
            reference.or(asset).unwrap_or(value)
        } else {
            value
                .get("asset")
                .filter(|v| v.is_object())
                .or_else(|| value.get("reference").filter(|v| v.is_object()))
                .unwrap_or(value)
        }
    } else {
        value
    };
    let mut out = json!({"kind":kind});
    for field in [
        "key",
        "id",
        "updatedAt",
        "claimGeneration",
        "externalRef",
        "status",
        "replayed",
    ] {
        if let Some(value) = value.get(field)
            && !value.is_null()
            && !(field == "replayed" && value == false)
        {
            out[field] = value.clone();
        }
    }
    if out.get("updatedAt").is_none() {
        out["updatedAt"] = value
            .get("createdAt")
            .cloned()
            .unwrap_or_else(|| json!(now()));
    }
    if replayed {
        out["replayed"] = json!(true);
    }
    if let Some(version) = task_version.filter(|_| kind != "reference") {
        out["updatedAt"] = version["updatedAt"].clone();
        out["claimGeneration"] = version["claimGeneration"].clone();
    }
    out
}

fn apply_metadata<T: Serialize + DeserializeOwned>(
    value: T,
    receipt: &Value,
    replayed: bool,
) -> Result<T> {
    let mut value = serde_json::to_value(value)?;
    for field in [
        "key",
        "id",
        "updatedAt",
        "claimGeneration",
        "externalRef",
        "status",
    ] {
        if let Some(meta) = receipt.get(field) {
            value[field] = meta.clone();
        }
    }
    if replayed {
        value["replayed"] = json!(true);
    }
    Ok(serde_json::from_value(value)?)
}

/// Run the mutation and store its compact receipt in the same SQLite transaction.
/// A replay loader reads the existing object without mutating it or writing events.
#[allow(clippy::too_many_arguments)] // Transaction, identity, compact kind and replay loading form one atomic boundary.
pub(crate) fn with_receipt<T: Serialize + DeserializeOwned>(
    tx: &Transaction<'_>,
    actor: &str,
    request_id: Option<&str>,
    tool: &str,
    kind: &str,
    payload: &impl Serialize,
    write: impl FnOnce() -> Result<T>,
    load: impl FnOnce(&Value) -> Result<T>,
) -> Result<Receipted<T>> {
    with_receipt_if(
        tx,
        actor,
        request_id,
        tool,
        Some(kind),
        payload,
        || Ok((write()?, true)),
        load,
    )
}

/// The same receipt boundary for reports and operations that can decide to write nothing.
/// A false write flag deliberately stores no receipt (including import dry runs/no-ops).
#[allow(clippy::too_many_arguments)]
pub(crate) fn with_receipt_if<T: Serialize + DeserializeOwned>(
    tx: &Transaction<'_>,
    actor: &str,
    request_id: Option<&str>,
    tool: &str,
    kind: Option<&str>,
    payload: &impl Serialize,
    write: impl FnOnce() -> Result<(T, bool)>,
    load: impl FnOnce(&Value) -> Result<T>,
) -> Result<Receipted<T>> {
    with_receipt_policy(
        tx,
        actor,
        ReceiptPolicy {
            request_id,
            tool,
            kind,
            legacy_hash: None,
        },
        payload,
        write,
        load,
    )
}

pub(crate) struct ReceiptPolicy<'a> {
    pub request_id: Option<&'a str>,
    pub tool: &'a str,
    pub kind: Option<&'a str>,
    pub legacy_hash: Option<&'a str>,
}

pub(crate) fn payload_hash(payload: &impl Serialize) -> Result<String> {
    let mut payload = serde_json::to_value(payload)?;
    if let Some(object) = payload.as_object_mut() {
        object.remove("requestId");
    }
    canonical_hash(&payload)
}

fn mismatch(request: &str, tool: &str) -> Error {
    Error::IdempotencyConflict(format!(
        "requestId {request} was already used for a different {tool} payload; use a new requestId"
    ))
}

/// Exact-tool receipt, then preserved v9 tuple receipt, then v9 non-final journal.
/// This read is also used before registration touches the filesystem.
pub(crate) fn replay_receipt(
    c: &Connection,
    actor: &str,
    request: &str,
    tool: &str,
    hash: &str,
    legacy_hash: Option<&str>,
) -> Result<Option<Value>> {
    if !(1..=100).contains(&request.chars().count()) || request.trim().is_empty() {
        return Err(invalid("requestId", "Use 1–100 nonblank characters"));
    }
    crate::service::member(c, actor)?;
    let project = crate::service::jam(c)?.id;
    let row=c.query_row("SELECT payload_hash,result_json FROM write_receipts WHERE jam_id=? AND actor_id=? AND tool=? AND request_id=?",params![project,actor,tool,request],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional()?;
    if let Some((known, result)) = row {
        if !(tool == "create_task" && known == "legacy") && known != hash {
            return Err(mismatch(request, tool));
        }
        let value: Value = serde_json::from_str(&result)?;
        match value
            .pointer("/fileOperation/state")
            .and_then(Value::as_str)
        {
            Some("cancelled") => {
                return Err(invalid(
                    "requestId",
                    "This file operation was cancelled; use a new request ID",
                ));
            }
            Some("copying") => return Ok(None),
            _ => return Ok(Some(value)),
        }
    }
    if let Some(old_hash) = legacy_hash {
        let legacy=c.query_row("SELECT payload_hash,result_json FROM write_receipts WHERE jam_id=? AND actor_id=? AND tool='file_legacy' AND request_id=?",params![project,actor,request],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional()?;
        if let Some((known, result)) = legacy {
            if known != old_hash {
                return Err(mismatch(request, tool));
            }
            return Ok(Some(serde_json::from_str(&result)?));
        }
        let pending=c.query_row("SELECT payload_hash,state FROM file_operations WHERE project_id=? AND actor_id=? AND request_id=? AND state!='committed'",params![project,actor,request],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional()?;
        if let Some((known, state)) = pending {
            if known != old_hash {
                return Err(mismatch(request, tool));
            }
            if state == "cancelled" {
                return Err(invalid(
                    "requestId",
                    "This file operation was cancelled; use a new request ID",
                ));
            }
        }
    }
    Ok(None)
}

pub(crate) fn with_receipt_policy<T: Serialize + DeserializeOwned>(
    tx: &Transaction<'_>,
    actor: &str,
    policy: ReceiptPolicy<'_>,
    payload: &impl Serialize,
    write: impl FnOnce() -> Result<(T, bool)>,
    load: impl FnOnce(&Value) -> Result<T>,
) -> Result<Receipted<T>> {
    let ReceiptPolicy {
        request_id,
        tool,
        kind,
        legacy_hash,
    } = policy;
    let Some(request) = request_id else {
        return Ok(Receipted {
            value: write()?.0,
            replayed: false,
        });
    };
    if !(1..=100).contains(&request.chars().count()) || request.trim().is_empty() {
        return Err(invalid("requestId", "Use 1–100 nonblank characters"));
    }
    crate::service::member(tx, actor)?;
    let project = crate::service::jam(tx)?.id;
    let hash = payload_hash(payload)?;
    if let Some(receipt) = replay_receipt(tx, actor, request, tool, &hash, legacy_hash)? {
        return Ok(Receipted {
            value: apply_metadata(load(&receipt)?, &receipt, true)?,
            replayed: true,
        });
    }
    let (value, written) = write()?;
    if !written {
        return Ok(Receipted {
            value,
            replayed: false,
        });
    }
    let full = serde_json::to_value(&value)?;
    let receipt = kind.map_or(full.clone(), |kind| compact_mutation(kind, &full));
    if kind.is_some() && receipt["id"].as_str().is_none() {
        return Err(invalid(
            "receipt",
            "A mutation result must identify its object",
        ));
    }
    tx.execute("INSERT INTO write_receipts(jam_id,actor_id,request_id,tool,payload_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(jam_id,actor_id,tool,request_id) DO UPDATE SET payload_hash=excluded.payload_hash,result_json=excluded.result_json,created_at=excluded.created_at",params![project,actor,request,tool,hash,receipt.to_string(),now()])?;
    Ok(Receipted {
        value: apply_metadata(value, &receipt, false)?,
        replayed: false,
    })
}

/// A new streamed-copy journal entry belongs to the exact creating tool. It is
/// replaced atomically by the compact final receipt after the asset is committed.
pub(crate) fn begin_file_copy(
    tx: &Transaction<'_>,
    actor: &str,
    request: &str,
    tool: &str,
    payload: &impl Serialize,
    path: &str,
) -> Result<()> {
    let project = crate::service::jam(tx)?.id;
    crate::service::member(tx, actor)?;
    tx.execute("INSERT INTO write_receipts(jam_id,actor_id,request_id,tool,payload_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?)",params![project,actor,request,tool,payload_hash(payload)?,json!({"fileOperation":{"state":"copying","path":path}}).to_string(),now()])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_hash_sorts_nested_objects_and_preserves_array_order() {
        assert_eq!(
            canonical_hash(&json!({"z":{"b":2,"a":1},"a":[2,1]})).unwrap(),
            canonical_hash(
                &serde_json::from_str::<Value>(r#"{"a":[2,1],"z":{"a":1,"b":2}}"#).unwrap()
            )
            .unwrap()
        );
        assert_ne!(
            canonical_hash(&json!([1, 2])).unwrap(),
            canonical_hash(&json!([2, 1])).unwrap()
        );
    }
}
