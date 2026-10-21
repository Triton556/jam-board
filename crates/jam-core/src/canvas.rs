//! Canvas mutations share the normal domain transactions and activity feed.
use crate::planning::*;
use crate::references::reference_epic;
use crate::*;
use rusqlite::params;
use serde_json::json;

impl Store {
    /// Explicit user action only. Use the OS HTTP/TLS implementation without a new
    /// networking dependency; curl enforces the deadline, protocols and response cap.
    pub fn fetch_reference_preview(&self, actor: &str, id: &str) -> Result<RefItem> {
        let item = self.read(|c| {
            let row: RefItem = fetch(c, "ref_items", "id", id)?;
            editable_audit(&row.audit)?;
            crate::service::member(c, actor)?;
            Ok(row)
        })?;
        if item.kind != "link" {
            return Err(invalid("kind", "Only links have page previews"));
        }
        let url = item
            .url
            .ok_or_else(|| invalid("url", "The link has no URL"))?;
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            return Err(invalid("url", "Use an HTTP or HTTPS URL"));
        }
        #[cfg(windows)]
        let program = std::path::PathBuf::from(
            std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
        )
        .join("System32/curl.exe");
        #[cfg(not(windows))]
        let program = std::path::PathBuf::from("curl");
        let mut command = std::process::Command::new(program);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let output = command
            .args([
                "--disable",
                "--silent",
                "--show-error",
                "--fail",
                "--location",
                "--max-redirs",
                "3",
                "--max-time",
                "5",
                "--max-filesize",
                "2097152",
                "--proto",
                "=http,https",
                "--proto-redir",
                "=http,https",
                "--header",
                "Accept: text/html",
                "--url",
                &url,
            ])
            .output()
            .map_err(|_| invalid("preview", "The OS curl HTTP client is unavailable"))?;
        if !output.status.success() {
            return Err(invalid(
                "preview",
                "Page preview failed or exceeded the 5 second deadline / 2 MiB limit",
            ));
        }
        let text = String::from_utf8_lossy(&output.stdout);
        self.store_link_preview(actor, id, Some(parse_preview(&text)))
    }
    pub fn reference_canvas(&self) -> Result<ReferenceCanvas> {
        self.read(|c| {
            let j=crate::service::jam(c)?;
            Ok(ReferenceCanvas {
                items:records(c,"ref_items","jam_id=? AND archived_at IS NULL ORDER BY z,id",&[&j.id])?,
                // Archived frames retain their origin for released children and session undo.
                frames:records(c,"ref_frames","jam_id=? ORDER BY id",&[&j.id])?,
                edges:records(c,"ref_edges","jam_id=? AND archived_at IS NULL AND from_item IN (SELECT id FROM ref_items WHERE archived_at IS NULL) AND to_item IN (SELECT id FROM ref_items WHERE archived_at IS NULL)",&[&j.id])?,
                links:records(c,"ref_links","archived_at IS NULL AND item_id IN (SELECT id FROM ref_items WHERE jam_id=? AND archived_at IS NULL)",&[&j.id])?,
            })
        })
    }
    pub fn canvas_geometry(&self, actor: &str, input: CanvasGeometry) -> Result<RefItem> {
        if [input.x, input.y, input.w, input.h, input.z]
            .iter()
            .any(|v| !v.is_finite())
            || input.w < 80.
            || input.h < 50.
        {
            return Err(invalid(
                "geometry",
                "Use finite coordinates and a minimum size of 80 × 50",
            ));
        }
        self.write(|c|{
            crate::service::member(c,actor)?;
            let old:RefItem=fetch(c,"ref_items","id",&input.id)?;editable_audit(&old.audit)?;
            let mut epic_id=None;
            if let Some(id)=&input.frame_id {let f:RefFrame=fetch(c,"ref_frames","id",id)?;if f.archived_at.is_some()||f.jam_id!=old.audit.jam_id{return Err(invalid("frameId","Choose an active frame in this project"));}epic_id=f.epic_id;}
            patch_record(c,"ref_items",&input.id,&json!({"x":input.x,"y":input.y,"w":input.w,"h":input.h,"z":input.z,"frameId":input.frame_id,"updatedBy":actor,"updatedAt":now()}))?;
            let updated:RefItem=fetch(c,"ref_items","id",&input.id)?;
            let epic_id=epic_id.or(reference_epic(c,&updated)?).or(reference_epic(c,&old)?);
            v2_event(c,actor,epic_id.as_deref(),"reference.updated",None,json!({"itemId":input.id,"fields":["x","y","w","h","z","frameId"]}))?;
            fetch(c,"ref_items","id",&input.id)
        })
    }
    pub fn canvas_archive(&self, actor: &str, input: CanvasArchive) -> Result<()> {
        self.write(|c| {
            let who = crate::service::member(c, actor)?;
            if !input.archived && who.kind != "human" {
                return Err(Error::Forbidden(
                    "Only humans restore archived canvas records".into(),
                ));
            }
            let table = match input.kind.as_str() {
                "item" => "ref_items",
                "frame" => "ref_frames",
                "edge" => "ref_edges",
                _ => return Err(invalid("kind", "Choose item, frame or edge")),
            };
            let row: serde_json::Value = fetch(c, table, "id", &input.id)?;
            let epic_id = match input.kind.as_str() {
                "item" => reference_epic(c, &fetch(c, "ref_items", "id", &input.id)?)?,
                "edge" => reference_epic(
                    c,
                    &fetch(c, "ref_items", "id", row["fromItem"].as_str().unwrap_or(""))?,
                )?,
                _ => row["epicId"].as_str().map(str::to_owned),
            };
            if row["jamId"] != crate::service::jam(c)?.id {
                return Err(invalid("id", "Choose a record in the active project"));
            }
            c.execute(
                &format!("UPDATE {table} SET archived_at=? WHERE id=?"),
                params![input.archived.then(now), input.id],
            )?;
            v2_event(
                c,
                actor,
                epic_id.as_deref(),
                "reference.updated",
                None,
                json!({"itemId":input.id,"kind":input.kind,"archived":input.archived}),
            )
        })
    }
    pub fn reference_metadata(
        &self,
        actor: &str,
        id: &str,
        metadata: Option<String>,
    ) -> Result<RefItem> {
        if let Some(text) = &metadata
            && (text.len() > 65536
                || !serde_json::from_str::<serde_json::Value>(text)
                    .map_err(|_| invalid("metadata", "Use a JSON object"))?
                    .is_object())
        {
            return Err(invalid("metadata", "Use a JSON object smaller than 64 KiB"));
        }
        self.write(|c| {
            crate::service::member(c, actor)?;
            let row: RefItem = fetch(c, "ref_items", "id", id)?;
            editable_audit(&row.audit)?;
            patch_record(
                c,
                "ref_items",
                id,
                &json!({"metadata":metadata,"updatedBy":actor,"updatedAt":now()}),
            )?;
            v2_event(
                c,
                actor,
                reference_epic(c, &row)?.as_deref(),
                "reference.updated",
                None,
                json!({"itemId":id,"fields":["metadata"]}),
            )?;
            fetch(c, "ref_items", "id", id)
        })
    }
    pub fn update_ref_edge(&self, actor: &str, id: &str, label: &str) -> Result<RefEdge> {
        if label.chars().count() > 240 {
            return Err(invalid("label", "Use at most 240 characters"));
        }
        self.write(|c| {
            crate::service::member(c, actor)?;
            let row: RefEdge = fetch(c, "ref_edges", "id", id)?;
            if row.archived_at.is_some() {
                return Err(Error::Archived(id.into()));
            }
            patch_record(c, "ref_edges", id, &json!({"label":label}))?;
            let from: RefItem = fetch(c, "ref_items", "id", &row.from_item)?;
            v2_event(
                c,
                actor,
                reference_epic(c, &from)?.as_deref(),
                "reference.updated",
                None,
                json!({"edgeId":id,"fields":["label"]}),
            )?;
            fetch(c, "ref_edges", "id", id)
        })
    }
    /// Only registered local files are exposed to the desktop's per-file protocol scope.
    pub fn reference_media_path(&self, id: &str) -> Result<Option<String>> {
        self.read(|c| {
            let a: Asset = fetch(c, "assets", "id", id)?;
            let p = std::path::Path::new(&a.location);
            if !p.is_absolute() || !p.is_file() {
                return Ok(None);
            }
            Ok(Some(p.canonicalize()?.to_string_lossy().into_owned()))
        })
    }
    /// The caller supplies bytes, never a destination path. PNG encoding is performed by
    /// the browser clipboard canvas; the fixed signature and bounded size reject other input.
    pub fn clipboard_reference(
        &self,
        actor: &str,
        bytes: &[u8],
        x: f64,
        y: f64,
    ) -> Result<RefItem> {
        if bytes.len() > 20 * 1024 * 1024
            || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
            || bytes.len() < 24
            || &bytes[12..16] != b"IHDR"
        {
            return Err(invalid(
                "image",
                "Use a PNG clipboard image smaller than 20 MiB",
            ));
        }
        let directory = self
            .path
            .parent()
            .ok_or_else(|| invalid("dataDir", "No data directory"))?
            .join("references");
        std::fs::create_dir_all(&directory)?;
        let root = self
            .path
            .parent()
            .ok_or_else(|| invalid("dataDir", "No data directory"))?
            .canonicalize()?;
        let directory = directory.canonicalize()?;
        if directory != root.join("references") {
            return Err(invalid(
                "image",
                "The references directory must stay inside the data directory",
            ));
        }
        let path = directory.join(format!("clipboard-{}.png", id()));
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        file.write_all(bytes)?;
        drop(file);
        let result = self.add_reference(
            actor,
            AddReference {
                kind: "asset".into(),
                file_path: Some(path.to_string_lossy().into_owned()),
                title: Some("Clipboard image".into()),
                x: Some(x),
                y: Some(y),
                ..Default::default()
            },
        );
        if result.is_err() {
            let _ = std::fs::remove_file(path);
        }
        result
    }
    pub fn store_link_preview(
        &self,
        actor: &str,
        id: &str,
        preview: Option<LinkPreview>,
    ) -> Result<RefItem> {
        self.write(|c|{crate::service::member(c,actor)?;let row:RefItem=fetch(c,"ref_items","id",id)?;editable_audit(&row.audit)?;if row.kind!="link"{return Err(invalid("kind","Only links have page previews"));}
            if preview.as_ref().is_some_and(|p|p.title.len()>2000||p.image.as_ref().is_some_and(|i|i.len()>4096)){return Err(invalid("preview","Page metadata is too large"));}
            patch_record(c,"ref_items",id,&json!({"linkPreview":preview.map(|p|serde_json::to_string(&p)).transpose()?,"updatedBy":actor,"updatedAt":now()}))?;v2_event(c,actor,reference_epic(c,&row)?.as_deref(),"reference.updated",None,json!({"itemId":id,"fields":["linkPreview"]}))?;fetch(c,"ref_items","id",id)
        })
    }
    pub fn canvas_viewport(&self, actor: &str) -> Result<Option<String>> {
        self.setting(&format!("canvas_viewport:{actor}"))
    }
    pub fn set_canvas_viewport(&self, actor: &str, viewport: &str) -> Result<()> {
        let v: serde_json::Value = serde_json::from_str(viewport)?;
        if ["x", "y", "zoom"]
            .iter()
            .any(|k| v[*k].as_f64().is_none_or(|n| !n.is_finite()))
            || v["zoom"].as_f64().is_none_or(|z| !(0.1..=4.).contains(&z))
        {
            return Err(invalid(
                "viewport",
                "Use finite x/y and zoom between 0.1 and 4",
            ));
        }
        self.read(|c| {
            crate::service::member(c, actor)?;
            Ok(())
        })?;
        self.set_setting(&format!("canvas_viewport:{actor}"), viewport)
    }
}

fn decode_html(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .trim()
        .chars()
        .take(2000)
        .collect()
}
fn attribute(tag: &str, name: &str) -> Option<String> {
    let bytes = tag.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        while i < bytes.len() && !bytes[i].is_ascii_alphabetic() {
            i += 1;
        }
        let start = i;
        while i < bytes.len()
            && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'-' || bytes[i] == b':')
        {
            i += 1;
        }
        let key = &tag[start..i];
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'=' {
            continue;
        }
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let quote = bytes[i];
        let quoted = quote == b'\'' || quote == b'"';
        if quoted {
            i += 1;
        }
        let start = i;
        while i < bytes.len()
            && if quoted {
                bytes[i] != quote
            } else {
                !bytes[i].is_ascii_whitespace() && bytes[i] != b'>'
            }
        {
            i += 1;
        }
        if key.eq_ignore_ascii_case(name) {
            return Some(decode_html(&tag[start..i]));
        }
        if quoted {
            i += 1;
        }
    }
    None
}
fn parse_preview(html: &str) -> LinkPreview {
    let lower = html.to_ascii_lowercase();
    let title = lower
        .find("<title")
        .and_then(|start| lower[start..].find('>').map(|n| start + n + 1))
        .and_then(|start| {
            lower[start..]
                .find("</title>")
                .map(|end| decode_html(&html[start..start + end]))
        })
        .unwrap_or_default();
    let image = lower.match_indices("<meta").find_map(|(start, _)| {
        let end = lower[start..].find('>')?;
        let tag = &html[start..start + end];
        if attribute(tag, "property")
            .or_else(|| attribute(tag, "name"))
            .is_some_and(|v| v.eq_ignore_ascii_case("og:image"))
        {
            attribute(tag, "content")
                .filter(|s| s.starts_with("https://") || s.starts_with("http://"))
        } else {
            None
        }
    });
    LinkPreview { title, image }
}
