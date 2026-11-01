use crate::*;
use rusqlite::{Connection, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;
fn table(kind: RecordKind) -> &'static str {
    match kind {
        RecordKind::Epic => "epics",
        RecordKind::Story => "stories",
        RecordKind::Task => "tasks",
    }
}

pub(crate) fn validate_external_ref(value: Option<&str>) -> Result<()> {
    if value.is_some_and(|v| !(1..=120).contains(&v.chars().count()) || v.trim().is_empty()) {
        return Err(invalid("externalRef", "Use 1–120 nonblank characters"));
    }
    Ok(())
}
pub(crate) fn unique_external_ref(
    c: &Connection,
    kind: RecordKind,
    project: &str,
    id: Option<&str>,
    value: Option<&str>,
) -> Result<()> {
    validate_external_ref(value)?;
    if let Some(value) = value {
        let table = table(kind);
        if c.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE jam_id=? AND external_ref=? AND (? IS NULL OR id!=?))"),params![project,value,id,id],|r|r.get::<_,bool>(0))? {
            return Err(invalid("externalRef",&format!("{value} already identifies another {} in this project",kind.as_str())));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FindInput {
    /// Optional entity kind; omitted searches epics, stories and tasks. Example: story.
    pub kind: Option<RecordKind>,
    /// Source references to match, at most 500, each 1–120 chars. Example: ["ls/S0.1"]. Omitted adds no reference selector.
    #[schemars(length(max = 500))]
    pub external_refs: Option<Vec<String>>,
    /// Stable board keys to match, at most 500. Example: ["JB-S3"]. Omitted adds no key selector.
    #[schemars(length(max = 500))]
    pub keys: Option<Vec<String>>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpicListInput {
    /// Optional exact source reference, 1–120 chars, e.g. ls/E0; omitted lists all active epics.
    #[schemars(length(min = 1, max = 120))]
    pub external_ref: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecordVersion {
    pub kind: RecordKind,
    pub key: String,
    pub id: String,
    pub external_ref: Option<String>,
    pub title: String,
    pub status: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claim_generation: Option<String>,
}
impl Store {
    pub fn list_epics_with_ref(&self, input: EpicListInput) -> Result<Vec<Epic>> {
        validate_external_ref(input.external_ref.as_deref())?;
        Ok(self
            .list_epics()?
            .into_iter()
            .filter(|epic| {
                input
                    .external_ref
                    .as_ref()
                    .is_none_or(|r| epic.external_ref.as_ref() == Some(r))
            })
            .collect())
    }
    pub fn find(&self, input: FindInput) -> Result<Vec<RecordVersion>> {
        if input.external_refs.as_ref().is_some_and(|v| v.len() > 500)
            || input.keys.as_ref().is_some_and(|v| v.len() > 500)
        {
            return Err(invalid("find", "Use at most 500 externalRefs and 500 keys"));
        }
        if let Some(refs) = &input.external_refs {
            for value in refs {
                validate_external_ref(Some(value))?;
            }
        }
        if input
            .keys
            .as_ref()
            .is_some_and(|v| v.iter().any(|v| v.trim().is_empty()))
        {
            return Err(invalid("keys", "Keys must not be blank"));
        }
        self.read(|c| {
            let project=crate::service::jam(c)?.id;
            let mut result=vec![];
            for kind in [RecordKind::Epic,RecordKind::Story,RecordKind::Task] {
                if input.kind.is_some_and(|filter|filter!=kind) { continue; }
                let table=table(kind);
                let mut stmt=c.prepare(&format!("SELECT key,id,external_ref,title,status,updated_at FROM {table} WHERE jam_id=? ORDER BY position,key"))?;
                let rows=stmt.query_map([&project],|r|Ok(RecordVersion{kind,key:r.get(0)?,id:r.get(1)?,external_ref:r.get(2)?,title:r.get(3)?,status:r.get(4)?,updated_at:r.get(5)?,claim_generation:None}))?.collect::<std::result::Result<Vec<_>,_>>()?;
                for mut row in rows {
                    let all=input.external_refs.is_none() && input.keys.is_none();
                    let by_ref=input.external_refs.as_ref().is_some_and(|refs|row.external_ref.as_ref().is_some_and(|r|refs.contains(r)));
                    let by_key=input.keys.as_ref().is_some_and(|keys|keys.contains(&row.key));
                    if !(all||by_ref||by_key) { continue; }
                    if kind==RecordKind::Task { row.claim_generation=Some(crate::service::task(c,&row.key)?.claim_generation); }
                    result.push(row);
                }
            }
            Ok(result)
        })
    }
}
