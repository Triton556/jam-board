use jam_core::*;
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
    path::{Path, PathBuf},
};

struct FakeFilesystem {
    bytes: Vec<u8>,
    path: PathBuf,
    missing: bool,
    is_file: bool,
    reads: Cell<usize>,
    limit: Cell<usize>,
}
impl FakeFilesystem {
    fn new(name: &str, bytes: Vec<u8>) -> Self {
        Self {
            bytes,
            path: Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests")
                .join(name),
            missing: false,
            is_file: true,
            reads: Cell::new(0),
            limit: Cell::new(0),
        }
    }
}
impl PreviewFilesystem for FakeFilesystem {
    fn canonicalize(&self, _path: &Path) -> std::io::Result<PathBuf> {
        Ok(self.path.clone())
    }
    fn metadata(&self, path: &Path) -> std::io::Result<PreviewMetadata> {
        assert_eq!(path, self.path);
        if self.missing {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Fixture missing",
            ));
        }
        Ok(PreviewMetadata {
            byte_size: self.bytes.len() as u64,
            modified_at: Some("2026-10-31T00:00:00Z".into()),
            is_file: self.is_file,
        })
    }
    fn read_prefix(&self, path: &Path, limit: usize) -> std::io::Result<Vec<u8>> {
        assert_eq!(path, self.path);
        self.reads.set(self.reads.get() + 1);
        self.limit.set(limit);
        Ok(self.bytes.iter().take(limit).copied().collect())
    }
}
#[derive(Default)]
struct FakeScope {
    allowed: RefCell<Vec<PathBuf>>,
}
impl PreviewScope for FakeScope {
    fn allow_file(&self, path: &Path) -> Result<()> {
        self.allowed.borrow_mut().push(path.into());
        Ok(())
    }
}
fn asset(fs: &FakeFilesystem, kind: &str) -> FileAsset {
    FileAsset {
        modified_at: None,
        usage_count: 0,
        asset: Asset {
            archived_at: None,
            archived_by: None,
            id: "fixture-asset".into(),
            jam_id: "fixture-project".into(),
            kind: kind.into(),
            name: fs.path.file_name().unwrap().to_string_lossy().into(),
            location: display_path(&fs.path),
            notes: None,
            created_by: "fixture-human".into(),
            created_at: "2026-10-31T00:00:00Z".into(),
            role: "asset".into(),
        },
        storage_type: "board_file".into(),
        path_base: "board".into(),
        stored_path: format!("files/{}", fs.path.file_name().unwrap().to_string_lossy()),
        original_name: fs.path.file_name().unwrap().to_string_lossy().into(),
        mime_type: None,
        byte_size: Some(fs.bytes.len() as i64),
        content_hash: None,
        content_revision: 1,
        metadata: BTreeMap::new(),
        resolution: FileResolution {
            storage_type: "board_file".into(),
            path_base: "board".into(),
            stored_path: "files/fixture".into(),
            resolved_path: Some(display_path(&fs.path)),
            worktree_root: None,
            resolution_basis: "board_anchor".into(),
            status: "available".into(),
            checked_at: "2026-10-31T00:00:00Z".into(),
        },
    }
}

#[test]
fn markdown_is_text_without_any_asset_protocol_grant() {
    let fs = FakeFilesystem::new("virtual-plan.md", "# План\n\nКамни — 🪨".as_bytes().into());
    let scope = FakeScope::default();
    let preview = preview_resolved_file(&asset(&fs, "document"), &fs, &scope).unwrap();
    assert!(
        matches!(preview,FilePreview::Text{ref text,ref mime,truncated:false} if text=="# План\n\nКамни — 🪨" && mime=="text/markdown")
    );
    assert!(scope.allowed.borrow().is_empty());
    assert_eq!(fs.limit.get(), TEXT_PREVIEW_CAP + 1);
}

#[test]
fn large_text_reads_only_cap_plus_one_and_truncates_at_two_mib() {
    let fs = FakeFilesystem::new("virtual-large.txt", vec![b'a'; TEXT_PREVIEW_CAP + 100]);
    let scope = FakeScope::default();
    let preview = preview_resolved_file(&asset(&fs, "document"), &fs, &scope).unwrap();
    assert!(
        matches!(preview,FilePreview::Text{ref text,truncated:true,..} if text.len()==TEXT_PREVIEW_CAP)
    );
    assert_eq!(fs.reads.get(), 1);
    assert_eq!(fs.limit.get(), TEXT_PREVIEW_CAP + 1);
    assert!(scope.allowed.borrow().is_empty());
}

#[test]
fn truncated_utf8_never_creates_a_partial_emoji() {
    let mut bytes = vec![b'a'; TEXT_PREVIEW_CAP - 1];
    bytes.extend_from_slice("🪨 tail".as_bytes());
    let fs = FakeFilesystem::new("virtual-unicode.md", bytes);
    let scope = FakeScope::default();
    let preview = preview_resolved_file(&asset(&fs, "document"), &fs, &scope).unwrap();
    assert!(
        matches!(preview,FilePreview::Text{ref text,truncated:true,..} if text.len()==TEXT_PREVIEW_CAP-1 && !text.contains('�'))
    );
}

#[test]
fn each_media_kind_grants_exactly_one_exact_file_and_returns_a_convert_file_src_path() {
    for (name, kind, expected) in [
        ("virtual-image.png", "sprite", "image"),
        ("virtual-audio.wav", "audio", "audio"),
        ("virtual-video.webm", "video", "video"),
    ] {
        let fs = FakeFilesystem::new(name, vec![1, 2, 3]);
        let scope = FakeScope::default();
        let preview = preview_resolved_file(&asset(&fs, kind), &fs, &scope).unwrap();
        let value = serde_json::to_value(preview).unwrap();
        assert_eq!(value["type"], "media");
        assert_eq!(value["mediaKind"], expected);
        assert_eq!(value["path"], display_path(&fs.path));
        assert_eq!(
            scope.allowed.borrow().as_slice(),
            std::slice::from_ref(&fs.path)
        );
        assert_eq!(fs.reads.get(), 0);
    }
}

#[test]
fn missing_and_non_file_sources_return_typed_errors_without_scope_calls() {
    let mut fs = FakeFilesystem::new("virtual-missing.png", vec![]);
    fs.missing = true;
    let scope = FakeScope::default();
    assert!(
        matches!(preview_resolved_file(&asset(&fs,"sprite"),&fs,&scope),Err(Error::Validation{ref field,..}) if field=="assetId")
    );
    fs.missing = false;
    fs.is_file = false;
    assert!(preview_resolved_file(&asset(&fs, "sprite"), &fs, &scope).is_err());
    assert!(scope.allowed.borrow().is_empty());
    assert_eq!(fs.reads.get(), 0);
}

#[test]
fn urls_and_unsupported_formats_do_not_receive_asset_protocol_grants() {
    let fs = FakeFilesystem::new("virtual-model.blend", vec![1, 2, 3]);
    let scope = FakeScope::default();
    let mut file = asset(&fs, "model");
    assert!(
        matches!(preview_resolved_file(&file,&fs,&scope).unwrap(),FilePreview::Metadata{ref kind,byte_size:Some(3),..} if kind=="model")
    );
    file.storage_type = "url".into();
    file.resolution.resolved_path = Some("https://example.test/plan".into());
    assert!(
        matches!(preview_resolved_file(&file,&fs,&scope).unwrap(),FilePreview::Url{ref url} if url=="https://example.test/plan")
    );
    assert!(scope.allowed.borrow().is_empty());
    assert_eq!(fs.reads.get(), 0);
}

#[test]
fn store_preview_rejects_private_legacy_paths_before_read_or_scope_grant() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("fictional.db")).unwrap();
    let (_, human) = store
        .create_jam("Preview", None, None, None, "UTC", "Human")
        .unwrap();
    let source = dir.path().join("mcp-token");
    std::fs::write(&source, b"fictional private marker").unwrap();
    let asset = store
        .create_asset(
            &human.id,
            "sprite",
            "Legacy private fixture",
            &display_path(&source),
            None,
        )
        .unwrap();
    let fs = FakeFilesystem::new("never-read.png", vec![]);
    let scope = FakeScope::default();
    assert!(matches!(
        store.preview_file_asset(&asset.id, &fs, &scope),
        Err(Error::Validation { .. })
    ));
    assert!(scope.allowed.borrow().is_empty());
    assert_eq!(fs.reads.get(), 0);
}
