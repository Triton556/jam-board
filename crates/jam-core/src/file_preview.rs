//! Preview construction is independent of a running desktop or native opener.
use crate::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    io::Read,
    path::{Path, PathBuf},
};

pub const TEXT_PREVIEW_CAP: usize = 2 * 1024 * 1024;
/// Browser media category; models and office documents use metadata in this round.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    /// Browser image preview.
    Image,
    /// Native HTML audio controls.
    Audio,
    /// Native HTML video controls.
    Video,
}
/// Media returns a checked path; the frontend must call Tauri convertFileSrc(path).
/// The command grants only this exact file before returning; it opens nothing.
#[derive(Debug, Clone, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FilePreview {
    Text {
        text: String,
        mime: String,
        truncated: bool,
    },
    Media {
        #[serde(rename = "mediaKind")]
        media_kind: MediaKind,
        path: String,
        mime: String,
    },
    Metadata {
        name: String,
        kind: String,
        #[serde(rename = "byteSize")]
        byte_size: Option<i64>,
        #[serde(rename = "modifiedAt")]
        modified_at: Option<String>,
        path: String,
        #[serde(rename = "storageType")]
        storage_type: String,
    },
    Url {
        url: String,
    },
}
#[derive(Debug, Clone)]
pub struct PreviewMetadata {
    pub byte_size: u64,
    pub modified_at: Option<String>,
    pub is_file: bool,
}
pub trait PreviewFilesystem {
    fn canonicalize(&self, path: &Path) -> std::io::Result<PathBuf>;
    fn metadata(&self, path: &Path) -> std::io::Result<PreviewMetadata>;
    fn read_prefix(&self, path: &Path, limit: usize) -> std::io::Result<Vec<u8>>;
}
pub trait PreviewScope {
    fn allow_file(&self, path: &Path) -> Result<()>;
}
pub struct LocalPreviewFilesystem;
impl PreviewFilesystem for LocalPreviewFilesystem {
    fn canonicalize(&self, path: &Path) -> std::io::Result<PathBuf> {
        path.canonicalize()
    }
    fn metadata(&self, path: &Path) -> std::io::Result<PreviewMetadata> {
        let metadata = std::fs::metadata(path)?;
        let modified_at = metadata.modified().ok().and_then(|t| {
            time::OffsetDateTime::from(t)
                .format(&time::format_description::well_known::Rfc3339)
                .ok()
        });
        Ok(PreviewMetadata {
            byte_size: metadata.len(),
            modified_at,
            is_file: metadata.is_file(),
        })
    }
    fn read_prefix(&self, path: &Path, limit: usize) -> std::io::Result<Vec<u8>> {
        let mut bytes = vec![];
        std::fs::File::open(path)?
            .take(limit as u64)
            .read_to_end(&mut bytes)?;
        Ok(bytes)
    }
}
fn unreadable(error: impl std::fmt::Display) -> Error {
    invalid(
        "assetId",
        &format!("File is missing or unreadable: {error}"),
    )
}
pub fn preview_resolved_file(
    file: &FileAsset,
    filesystem: &impl PreviewFilesystem,
    scope: &impl PreviewScope,
) -> Result<FilePreview> {
    if file.storage_type == "url" {
        let url = file
            .resolution
            .resolved_path
            .as_deref()
            .ok_or_else(|| invalid("assetId", "URL has no validated location"))?;
        crate::file_model::valid_url(url)?;
        return Ok(FilePreview::Url { url: url.into() });
    }
    if file.resolution.status != "available" {
        return Err(invalid(
            "assetId",
            &format!("File is {}", file.resolution.status),
        ));
    }
    let path = file
        .resolution
        .resolved_path
        .as_deref()
        .ok_or_else(|| invalid("assetId", "File has no resolved location"))?;
    let path = filesystem
        .canonicalize(Path::new(path))
        .map_err(unreadable)?;
    let metadata = filesystem.metadata(&path).map_err(unreadable)?;
    if !metadata.is_file {
        return Err(invalid("assetId", "Asset is not a readable file"));
    }
    let name = if file.content_revision > 1 {
        Path::new(&file.original_name)
    } else {
        path.as_path()
    };
    let ext = name
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = file
        .mime_type
        .clone()
        .or_else(|| crate::files_v2::mime_for_path(name))
        .unwrap_or_else(|| "application/octet-stream".into());
    if [
        "md", "markdown", "txt", "json", "csv", "log", "yaml", "yml", "toml",
    ]
    .contains(&ext.as_str())
        && !mime.starts_with("image/")
        && !mime.starts_with("audio/")
        && !mime.starts_with("video/")
    {
        let mut bytes = filesystem
            .read_prefix(&path, TEXT_PREVIEW_CAP + 1)
            .map_err(unreadable)?;
        let truncated =
            bytes.len() > TEXT_PREVIEW_CAP || metadata.byte_size > TEXT_PREVIEW_CAP as u64;
        bytes.truncate(TEXT_PREVIEW_CAP);
        if let Err(error) = std::str::from_utf8(&bytes)
            && error.error_len().is_none()
        {
            bytes.truncate(error.valid_up_to());
        }
        return Ok(FilePreview::Text {
            text: String::from_utf8_lossy(&bytes).into_owned(),
            mime: if mime == "application/octet-stream" {
                "text/plain".into()
            } else {
                mime
            },
            truncated,
        });
    }
    let media_kind = if mime.starts_with("image/") {
        Some(MediaKind::Image)
    } else if mime.starts_with("audio/") || file.asset.kind == "audio" {
        Some(MediaKind::Audio)
    } else if mime.starts_with("video/") || file.asset.kind == "video" {
        Some(MediaKind::Video)
    } else {
        None
    };
    if let Some(media_kind) = media_kind {
        scope.allow_file(&path)?;
        return Ok(FilePreview::Media {
            media_kind,
            path: display_path(&path),
            mime,
        });
    }
    Ok(FilePreview::Metadata {
        name: file.asset.name.clone(),
        kind: file.asset.kind.clone(),
        byte_size: i64::try_from(metadata.byte_size).ok(),
        modified_at: metadata.modified_at,
        path: display_path(&path),
        storage_type: file.storage_type.clone(),
    })
}
impl Store {
    pub fn preview_file_asset(
        &self,
        asset_id: &str,
        filesystem: &impl PreviewFilesystem,
        scope: &impl PreviewScope,
    ) -> Result<FilePreview> {
        let file = self.file_asset_fresh(ResolveFile {
            asset_id: asset_id.into(),
            working_directory: self.get_settings()?.working_directory,
        })?;
        if file.storage_type != "url" && file.resolution.status == "available" {
            let path = file
                .resolution
                .resolved_path
                .as_deref()
                .ok_or_else(|| invalid("assetId", "Missing path"))?;
            crate::file_model::validate_private_source(
                &self.path,
                self.app_data_dir.as_deref(),
                Path::new(path),
            )?;
        }
        preview_resolved_file(&file, filesystem, scope)
    }
}
