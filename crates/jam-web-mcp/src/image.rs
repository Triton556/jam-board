use anyhow::{Result, bail};
use serde::Serialize;
use std::{io::Write, path::Path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    pub path: String,
    pub mime_type: String,
    pub bytes: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub source_url: String,
}
pub fn signature(bytes: &[u8]) -> Result<(&'static str, &'static str)> {
    if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") && &bytes[12..16] == b"IHDR" {
        return Ok(("image/png", "png"));
    }
    if bytes.len() >= 4 && bytes.starts_with(b"\xff\xd8\xff") {
        return Ok(("image/jpeg", "jpg"));
    }
    if bytes.len() >= 10 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return Ok(("image/gif", "gif"));
    }
    if bytes.len() >= 16
        && &bytes[..4] == b"RIFF"
        && &bytes[8..12] == b"WEBP"
        && matches!(&bytes[12..16], b"VP8 " | b"VP8L" | b"VP8X")
    {
        return Ok(("image/webp", "webp"));
    }
    if bytes.len() >= 16 && &bytes[4..8] == b"ftyp" {
        let len = u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize;
        if (16..=bytes.len()).contains(&len)
            && (&bytes[8..12] == b"avif"
                || &bytes[8..12] == b"avis"
                || bytes[16..len]
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .any(|b| b == b"avif" || b == b"avis"))
        {
            return Ok(("image/avif", "avif"));
        }
    }
    bail!("The response is not a recognised PNG, JPEG, WebP, GIF or AVIF image")
}
pub fn safe_filename(requested: Option<&str>, extension: &str) -> String {
    let stem: String = requested
        .unwrap_or("image")
        .split(['/', '\\'])
        .next_back()
        .unwrap_or("image")
        .split('.')
        .next()
        .unwrap_or("image")
        .chars()
        .take(64)
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let stem = if stem.is_empty() { "image" } else { &stem };
    // Prefix defeats Windows device names; generated suffix prevents overwrites.
    format!("web-{stem}-{}.{extension}", ulid::Ulid::generate())
}
pub fn save(
    dir: &Path,
    response: crate::http::Response,
    requested: Option<&str>,
    source_url: &str,
) -> Result<Download> {
    if response.bytes.len() > crate::http::IMAGE_LIMIT {
        bail!("Image exceeds the 15 MB size limit");
    }
    let (mime, extension) = signature(&response.bytes)?;
    if response.mime != mime {
        bail!("Image content type does not match its signature");
    }
    let filename = safe_filename(requested, extension);
    std::fs::create_dir_all(dir)
        .map_err(|_| anyhow::anyhow!("Cannot create web download directory"))?;
    let dir = std::fs::canonicalize(dir)
        .map_err(|_| anyhow::anyhow!("Cannot open web download directory"))?;
    let path = dir.join(filename);
    let path_text = path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Web download path is not valid Unicode"))?
        .to_owned();
    let mut file = tempfile::NamedTempFile::new_in(&dir)
        .map_err(|_| anyhow::anyhow!("Cannot create image download"))?;
    file.write_all(&response.bytes)
        .map_err(|_| anyhow::anyhow!("Cannot write image download"))?;
    file.as_file()
        .sync_all()
        .map_err(|_| anyhow::anyhow!("Cannot finish image download"))?;
    file.persist_noclobber(&path)
        .map_err(|_| anyhow::anyhow!("Cannot save image download"))?;
    let (width, height) = match extension {
        "png" => (
            Some(u32::from_be_bytes(
                response.bytes[16..20].try_into().unwrap(),
            )),
            Some(u32::from_be_bytes(
                response.bytes[20..24].try_into().unwrap(),
            )),
        ),
        "gif" => (
            Some(u16::from_le_bytes(response.bytes[6..8].try_into().unwrap()) as u32),
            Some(u16::from_le_bytes(response.bytes[8..10].try_into().unwrap()) as u32),
        ),
        _ => (None, None),
    };
    Ok(Download {
        path: path_text,
        mime_type: mime.into(),
        bytes: response.bytes.len(),
        width,
        height,
        source_url: source_url.into(),
    })
}
