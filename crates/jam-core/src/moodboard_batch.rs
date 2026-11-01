use crate::*;
use rusqlite::params;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddReferencesInput {
    /// Stable retry ID for the whole batch, 1–100 characters; required. Retry failed items with a new ID.
    #[schemars(length(min = 1, max = 100))]
    pub request_id: String,
    /// Default active frame in this project; item frameId overrides it. Omitted uses normal automatic placement.
    pub frame_id: Option<String>,
    /// 1–50 references, created in order with partial success and automatic placement.
    #[schemars(length(min = 1, max = 50))]
    pub items: Vec<AddReferencesItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddReferencesItem {
    /// Reference kind: asset, link or note; required.
    pub kind: ReferenceKind,
    /// Absolute readable local file; required for assets. Copies are limited to 50 MiB each.
    pub file_path: Option<String>,
    /// Copy asset bytes into managed storage; default false. Whole-batch copy limit is 500 MiB.
    pub copy: Option<bool>,
    /// HTTP(S) URL; required for link references.
    pub url: Option<String>,
    /// Optional heading, 1–140 characters; notes require a heading or caption.
    pub title: Option<String>,
    /// Optional Markdown caption; note content may be supplied here.
    pub caption: Option<String>,
    /// Optional tags, 1–24 characters each, stored lowercase in supplied order.
    pub tags: Option<Vec<String>>,
    /// Optional original HTTP(S) source without credentials or whitespace, at most 2048 characters.
    pub source_url: Option<String>,
    /// Optional origin: found, generated or own.
    pub origin: Option<ReferenceOrigin>,
    /// Existing original reference ID, or #<index> for an earlier successfully created item, e.g. #0.
    pub derived_from: Option<String>,
    /// Optional active frame in this project, overriding the batch default.
    pub frame_id: Option<String>,
    /// Optional epic, story or task key in this project to associate with this item.
    pub link_to: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedReference {
    pub index: usize,
    pub id: String,
    pub title: String,
    pub frame_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FailedReference {
    pub index: usize,
    pub field: String,
    pub message: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BatchReferenceFrame {
    pub id: String,
    pub h: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddReferencesResult {
    pub created: Vec<CreatedReference>,
    pub failed: Vec<FailedReference>,
    pub frames: Vec<BatchReferenceFrame>,
    pub replayed: bool,
}
fn failure(index: usize, error: Error) -> Result<FailedReference> {
    match error {
        Error::Validation { field, reason } => Ok(FailedReference {
            index,
            field,
            message: reason,
        }),
        other => Err(other),
    }
}

impl Store {
    pub fn add_references(
        &self,
        actor: &str,
        input: AddReferencesInput,
    ) -> Result<AddReferencesResult> {
        if input.items.is_empty() || input.items.len() > 50 {
            return Err(invalid("items", "Use 1 to 50 references"));
        }
        let payload = serde_json::to_value(&input)?;
        let hash = crate::receipts::payload_hash(&payload)?;
        if let Some(value) = self.read(|c| {
            crate::receipts::replay_receipt(
                c,
                actor,
                &input.request_id,
                "add_references",
                &hash,
                None,
            )
        })? {
            let mut result: AddReferencesResult = serde_json::from_value(value)?;
            result.replayed = true;
            return Ok(result);
        }
        // Validate call-level errors and the copy budget before creating any file.
        self.read(|c| {
            let batch = AddReference {
                frame_id: input.frame_id.clone(),
                ..Default::default()
            };
            crate::references::validate_reference_input(c, actor, &batch, false)
        })?;
        let total: u64 = input
            .items
            .iter()
            .filter(|item| item.copy == Some(true))
            .filter_map(|item| item.file_path.as_deref())
            .filter_map(|p| std::fs::metadata(p).ok())
            .map(|m| m.len())
            .sum();
        if total > 500 * 1024 * 1024 {
            return Err(invalid("items", "A batch may copy at most 500 MiB"));
        }
        let mut failed = vec![];
        let mut prepared = vec![];
        let mut copies = Vec::new();
        let preparation = (|| -> Result<()> {
            for (index, item) in input.items.iter().enumerate() {
                let mut reference: AddReference =
                    serde_json::from_value(serde_json::to_value(item)?)?;
                reference.frame_id = reference.frame_id.or(input.frame_id.clone());
                // Batch note text is carried by caption, not the excluded text field.
                if reference.kind == "note" {
                    reference.text = reference.caption.take();
                }
                let original = reference.derived_from.take();
                reference.derived_from = original.clone().filter(|id| !id.starts_with('#'));
                let validation = self
                    .read(|c| {
                        crate::references::validate_reference_input(c, actor, &reference, false)
                    })
                    .and_then(|_| {
                        if reference.kind == "asset" {
                            let path = reference
                                .file_path
                                .as_deref()
                                .ok_or_else(|| invalid("filePath", "A local file is required"))?;
                            let file = std::fs::File::open(path).map_err(|_| {
                                invalid("filePath", "The file must exist and be readable")
                            })?;
                            let metadata = file.metadata().map_err(|_| {
                                invalid("filePath", "The file must exist and be readable")
                            })?;
                            if metadata.len() > 50 * 1024 * 1024 {
                                return Err(invalid(
                                    "filePath",
                                    "Copied assets must be at most 50 MiB",
                                ));
                            }
                        }
                        Ok(())
                    });
                reference.derived_from = original;
                let path = match validation.and_then(|_| {
                    if reference.copy == Some(true) {
                        self.prepare_reference_copy(&mut reference).map(Some)
                    } else {
                        Ok(None)
                    }
                }) {
                    Ok(path) => path,
                    Err(error) => {
                        failed.push(failure(index, error)?);
                        prepared.push(None);
                        continue;
                    }
                };
                if let Some(path) = &path {
                    copies.push((index, path.clone()));
                }
                prepared.push(Some((reference, path)));
            }
            Ok(())
        })();
        let result = preparation.and_then(|_| self.write(|tx| {
            Ok(crate::receipts::with_receipt_if(tx,actor,Some(&input.request_id),"add_references",None,&payload,|| {
                // Revalidate the default frame inside the write transaction as well.
                crate::references::validate_reference_input(tx,actor,&AddReference { frame_id: input.frame_id.clone(), ..Default::default() },false)?;
                let mut result = AddReferencesResult { created:vec![],failed,frames:vec![],replayed:false };
                for (index, entry) in prepared.into_iter().enumerate() {
                    let Some((mut reference,path)) = entry else { continue; };
                    if let Some(original) = reference.derived_from.clone().filter(|id| id.starts_with('#')) {
                        let earlier = original[1..].parse::<usize>().ok().filter(|i| *i < index).and_then(|i| result.created.iter().find(|row| row.index == i));
                        if let Some(earlier) = earlier { reference.derived_from = Some(earlier.id.clone()); }
                        else {
                            result.failed.push(FailedReference { index, field:"derivedFrom".into(), message:format!("derivedFrom points to item {original}, which was not created") });
                            continue;
                        }
                    }
                    tx.execute_batch("SAVEPOINT moodboard_item;")?;
                    let created = crate::references::add_reference_tx(tx,actor,reference,false,None);
                    match created {
                        Ok(item) => {
                            if let Some(path) = path && let Some(folder) = crate::project_folders::folder_for_db(&self.path) {
                                let stored = path.strip_prefix(folder.canonicalize()?).map_err(|_|invalid("filePath","Copy left the project folder"))?.to_string_lossy().replace('\\',"/");
                                tx.execute("UPDATE assets SET storage_type='board_file',path_base='board',stored_path=?,location=? WHERE id=?", params![stored,stored,item.asset_id])?;
                            }
                            tx.execute_batch("RELEASE moodboard_item;")?;
                            result.created.push(CreatedReference { index,id:item.audit.id,title:item.title,frame_id:item.frame_id });
                        }
                        Err(error) => { tx.execute_batch("ROLLBACK TO moodboard_item; RELEASE moodboard_item;")?;result.failed.push(failure(index,error)?); }
                    }
                }
                result.failed.sort_by_key(|row|row.index);
                let frame_ids = result.created.iter().filter_map(|i|i.frame_id.clone()).collect::<std::collections::BTreeSet<_>>();
                for id in frame_ids { let h=tx.query_row("SELECT h FROM ref_frames WHERE id=?",[&id],|r|r.get(0))?;result.frames.push(BatchReferenceFrame{id,h}); }
                Ok((result,true))
            },|value|Ok(serde_json::from_value(value.clone())?))?.value)
        }));
        // Keep exactly the successful rows' files; rollback/replay/skips retain no orphan copies.
        let retained = result
            .as_ref()
            .ok()
            .filter(|r| !r.replayed)
            .map(|r| {
                r.created
                    .iter()
                    .map(|i| i.index)
                    .collect::<std::collections::HashSet<_>>()
            })
            .unwrap_or_default();
        for (index, path) in copies {
            if !retained.contains(&index) {
                let _ = std::fs::remove_file(path);
            }
        }
        result
    }
}
