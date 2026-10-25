use crate::session::{Session, SessionInner};
use crate::*;
use serde_json::{Value, json};
use std::io::Read;
/// The desktop grants individual registered files, never a directory scope.
pub trait AttachmentMedia: Send + Sync {
    fn grant(&self, path: &std::path::Path) -> Result<String>;
    fn revoke(&self, path: &std::path::Path) -> Result<()>;
}
pub(crate) fn preview_url(
    session: &Session,
    inner: &SessionInner,
    attachment_id: &str,
) -> Result<Option<String>> {
    let (view, _) = inner
        .attachments
        .get(attachment_id)
        .ok_or_else(|| err("Attachment not found in this session"))?;
    let session_id = &inner.view.id;
    if !view.is_image {
        return Ok(None);
    }
    let data_dir = std::fs::canonicalize(&session.board.data_dir)?;
    let root = std::fs::canonicalize(data_dir.join("agent-attachments"))?;
    let folder = std::fs::canonicalize(root.join(session_id))?;
    let path = std::fs::canonicalize(&view.path)?;
    if root != data_dir.join("agent-attachments")
        || folder != root.join(session_id)
        || root.parent() != Some(data_dir.as_path())
        || folder.parent() != Some(root.as_path())
        || path.parent() != Some(folder.as_path())
        || !path.is_file()
    {
        return Err(err(
            "Attachment preview is outside this session's attachments folder",
        ));
    }
    session
        .attachment_media
        .as_ref()
        .map(|media| media.grant(&path))
        .transpose()
}
pub(crate) const FILE_LIMIT: u64 = 20 * 1024 * 1024;
const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
pub(crate) fn encode(bytes: &[u8]) -> String {
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = ((c[0] as u32) << 16)
            | ((c.get(1).copied().unwrap_or(0) as u32) << 8)
            | c.get(2).copied().unwrap_or(0) as u32;
        for shift in [18, 12, 6, 0] {
            out.push(ALPHABET[((n >> shift) & 63) as usize] as char);
        }
        if c.len() < 3 {
            out.pop();
            out.push('=');
        }
        if c.len() < 2 {
            out.pop();
            out.pop();
            out.push_str("==");
        }
    }
    out
}
fn decode(s: &str) -> Result<Vec<u8>> {
    if s.len() > ((FILE_LIMIT as usize).div_ceil(3)) * 4 {
        return Err(err("Files must be 20 MB or smaller"));
    }
    if !s.len().is_multiple_of(4) {
        return Err(err("Invalid base64 attachment"));
    }
    let mut out = Vec::new();
    let chunks = s.as_bytes().chunks(4);
    let count = chunks.len();
    for (i, c) in chunks.enumerate() {
        let pad = if c[2] == b'=' {
            2
        } else if c[3] == b'=' {
            1
        } else {
            0
        };
        if pad > 0 && (i + 1 != count || c[3] != b'=') {
            return Err(err("Invalid base64 attachment"));
        }
        let mut n = 0u32;
        for (j, b) in c.iter().enumerate() {
            let v = if j >= 4 - pad {
                0
            } else {
                ALPHABET
                    .iter()
                    .position(|v| v == b)
                    .ok_or_else(|| err("Invalid base64 attachment"))? as u32
            };
            n = (n << 6) | v;
        }
        if (pad == 2 && n & 0xffff != 0) || (pad == 1 && n & 0xff != 0) {
            return Err(err("Invalid base64 attachment"));
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Ok(out)
}
fn mime(name: &str) -> &'static str {
    match name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "txt" | "md" | "rs" | "js" | "ts" | "tsx" | "py" | "csv" | "log" | "toml" | "yaml"
        | "yml" | "html" | "css" => "text/plain",
        "json" => "application/json",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}
pub(crate) fn text_like(mime: &str) -> bool {
    mime.starts_with("text/")
        || [
            "application/json",
            "application/xml",
            "application/javascript",
            "application/yaml",
        ]
        .contains(&mime)
}
pub(crate) fn add(session: &Session, source: AttachmentSource) -> Result<AttachmentView> {
    let (name, mime_type, bytes) = match source {
        AttachmentSource::Path { path } => {
            let path = std::path::PathBuf::from(path);
            let file = std::fs::File::open(&path).map_err(|_| err("Cannot read attachment"))?;
            let meta = file.metadata()?;
            if !meta.is_file() {
                return Err(err("Choose a file"));
            }
            if meta.len() > FILE_LIMIT {
                return Err(err("Files must be 20 MB or smaller"));
            }
            let name = path
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("file")
                .to_owned();
            let mut bytes = Vec::new();
            file.take(FILE_LIMIT + 1).read_to_end(&mut bytes)?;
            (name.clone(), mime(&name).into(), bytes)
        }
        AttachmentSource::Bytes {
            name,
            mime_type,
            data,
        } => (name, mime_type, decode(&data)?),
    };
    if bytes.len() as u64 > FILE_LIMIT {
        return Err(err("Files must be 20 MB or smaller"));
    }
    let name = name
        .rsplit(['/', '\\'])
        .next()
        .filter(|s| !s.is_empty() && ![".", ".."].contains(s))
        .unwrap_or("file")
        .to_owned();
    let id = ulid::Ulid::generate().to_string();
    let dir = session
        .board
        .data_dir
        .join("agent-attachments")
        .join(&session.view().id);
    std::fs::create_dir_all(&dir)?;
    let extension = std::path::Path::new(&name)
        .extension()
        .and_then(|s| s.to_str())
        .filter(|s| s.len() <= 16 && s.bytes().all(|b| b.is_ascii_alphanumeric()));
    let path = dir.join(
        extension
            .map(|ext| format!("{id}.{ext}"))
            .unwrap_or_else(|| id.clone()),
    );
    std::fs::write(&path, &bytes)?;
    let is_image =
        ["image/png", "image/jpeg", "image/gif", "image/webp"].contains(&mime_type.as_str());
    let thumbnail = if is_image && bytes.len().div_ceil(3) * 4 + mime_type.len() + 13 <= 64 * 1024 {
        Some(format!("data:{mime_type};base64,{}", encode(&bytes)))
    } else {
        None
    };
    let mut view = AttachmentView {
        id: id.clone(),
        name,
        mime_type,
        size: bytes.len() as u64,
        path: std::fs::canonicalize(path)?.to_string_lossy().into_owned(),
        is_image,
        thumbnail,
        preview_url: None,
    };
    let mut inner = session.inner.lock().expect("session lock");
    inner.attachments.insert(id.clone(), (view.clone(), false));
    match preview_url(session, &inner, &id) {
        Ok(url) => view.preview_url = url,
        Err(error) => {
            inner.attachments.remove(&id);
            let _ = std::fs::remove_file(&view.path);
            return Err(error);
        }
    }
    inner
        .attachments
        .get_mut(&id)
        .expect("registered attachment")
        .0
        .preview_url = view.preview_url.clone();
    Ok(view)
}
pub(crate) fn remove(session: &Session, id: &str) -> Result<()> {
    let mut inner = session.inner.lock().expect("session lock");
    let (view, sent) = inner
        .attachments
        .get(id)
        .ok_or_else(|| err("Attachment not found"))?;
    if *sent {
        return Err(err("Sent attachments are retained with the transcript"));
    }
    if view.preview_url.is_some()
        && let Some(media) = &session.attachment_media
    {
        media.revoke(std::path::Path::new(&view.path))?;
    }
    std::fs::remove_file(&view.path)?;
    inner.attachments.remove(id);
    Ok(())
}
pub(crate) fn validate(inner: &SessionInner, content: &[PromptPart]) -> Result<()> {
    let mut count = 0;
    let mut size = 0;
    for p in content {
        match p {
            PromptPart::Attachment { attachment_id } => {
                let (a, _) = inner
                    .attachments
                    .get(attachment_id)
                    .ok_or_else(|| err("Attachment not found in this session"))?;
                if a.size > FILE_LIMIT {
                    return Err(err("Files must be 20 MB or smaller"));
                }
                let metadata =
                    std::fs::metadata(&a.path).map_err(|_| err("Cannot read attachment"))?;
                if !metadata.is_file() || metadata.len() != a.size {
                    return Err(err("Attachment changed — remove it and attach it again"));
                }
                count += 1;
                size += a.size;
            }
            PromptPart::Image { data, .. } => {
                let bytes = decode(data)?;
                if bytes.len() as u64 > FILE_LIMIT {
                    return Err(err("Files must be 20 MB or smaller"));
                }
                count += 1;
                size += bytes.len() as u64;
            }
            _ => {}
        }
    }
    if count > 10 {
        return Err(err("Attach at most 10 files per message"));
    }
    if size > 50 * 1024 * 1024 {
        return Err(err("Attachments must total 50 MB or less per message"));
    }
    Ok(())
}
pub(crate) fn block(inner: &SessionInner, id: &str) -> Result<Value> {
    let (a, _) = inner
        .attachments
        .get(id)
        .ok_or_else(|| err("Attachment not found in this session"))?;
    let read = || {
        let file = std::fs::File::open(&a.path).map_err(|_| err("Cannot read attachment"))?;
        let mut bytes = Vec::new();
        file.take(FILE_LIMIT + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 != a.size || bytes.len() as u64 > FILE_LIMIT {
            return Err(err("Attachment changed — remove it and attach it again"));
        }
        Ok(bytes)
    };
    if inner.view.kind == RuntimeKind::Api {
        if a.is_image {
            if !inner.view.capabilities.images {
                return Err(err("This model can't see images — pick a vision model"));
            }
            return Ok(json!({"type":"image","mimeType":a.mime_type,"data":encode(&read()?)}));
        }
        if text_like(&a.mime_type) && a.size <= 256 * 1024 {
            let text =
                String::from_utf8(read()?).map_err(|_| err("Text attachment must be UTF-8"))?;
            return Ok(json!({"type":"text","text":format!("{}\n\n~~~~\n{text}\n~~~~",a.name)}));
        }
        return Err(err("Not supported in API chat — use an agent connection"));
    }
    if a.is_image && inner.view.capabilities.images {
        return Ok(json!({"type":"image","mimeType":a.mime_type,"data":encode(&read()?)}));
    }
    let uri = reqwest::Url::from_file_path(&a.path)
        .map_err(|_| err("Invalid attachment path"))?
        .to_string();
    if text_like(&a.mime_type)
        && a.size <= 256 * 1024
        && inner.view.capabilities.embedded_context
        && let Ok(text) = String::from_utf8(read()?)
    {
        return Ok(
            json!({"type":"resource","resource":{"uri":uri,"mimeType":a.mime_type,"text":text}}),
        );
    }
    Ok(json!({"type":"resource_link","uri":uri,"name":a.name,"mimeType":a.mime_type,"size":a.size}))
}

pub(crate) fn cleanup(session: &Session) -> Result<()> {
    let inner = session
        .inner
        .lock()
        .map_err(|_| err("Session lock unavailable"))?;
    let id = &inner.view.id;
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err(err("Invalid attachment session directory"));
    }
    let root = std::path::absolute(session.board.data_dir.join("agent-attachments"))?;
    let dir = root.join(id);
    if dir.parent() != Some(root.as_path()) {
        return Err(err("Invalid attachment session directory"));
    }
    if let Some(media) = &session.attachment_media {
        for (view, _) in inner.attachments.values() {
            if view.preview_url.is_some() {
                media.revoke(std::path::Path::new(&view.path))?;
            }
        }
    }
    if dir.exists() {
        std::fs::remove_dir_all(dir)?;
    }
    Ok(())
}
