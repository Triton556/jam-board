//! Shared domain and SQLite storage. No desktop or MCP dependencies.
mod agent_avatar;
mod asset_io;
pub use agent_avatar::AgentAvatarInput;
mod canvas;
mod canvas_tools;
pub use canvas_tools::*;
mod changes;
mod compact;
mod context;
pub use compact::*;
mod db;
mod desktop;
mod execution;
mod external_refs;
pub use external_refs::{EpicListInput, FindInput, RecordVersion};
mod human_planning;
mod import;
pub use import::*;
mod input_enums;
pub use input_enums::*;
mod inbox_events;
pub use inbox_events::*;
mod m5;
mod migration_v3;
mod model;
mod moodboard;
mod moodboard_batch;
mod moves;
pub use moodboard_batch::*;
mod moodboard_ops;
pub use moodboard_ops::*;
pub use moves::{MoveStoryInput, MoveTaskToStoryInput};
mod path_display;
mod planning;
pub use path_display::display_path;
mod projects;
mod receipts;
mod references;
pub use receipts::{Receipted, compact_mutation};
mod seed;
mod service;
mod snapshot;
mod snapshot_v2;
mod table;
mod v2model;
mod workflow;

pub use changes::ACTIVITY_ACTIONS;
pub use context::TaskWriteContext;
pub use db::{ChangeFeed, Store, resolve_db_path};
pub use execution::*;
pub use m5::*;
pub use model::*;
pub use planning::activity_sentence;
pub use projects::ProjectSummary;
pub use snapshot::*;
pub use snapshot_v2::{PlanningExport, ScopeFile};
pub use v2model::*;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("already_undone: Import batch {0} was already undone")]
    AlreadyUndone(String),
    #[error("in_use: Asset is used in {} places; inspect usage before forcing deletion", .usage.count())]
    InUse { usage: Box<AssetUsage> },
    #[error("idempotency_conflict: {0}")]
    IdempotencyConflict(String),
    #[error("execution_required: {0}")]
    ExecutionRequired(String),
    #[error("not_ready: {0}")]
    NotReady(String),
    #[error("wrong_status: {0}")]
    WrongStatus(String),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("not_found: {0}")]
    NotFound(String),
    #[error("claim_conflict: already held by {holder}")]
    ClaimConflict { holder: String },
    #[error("validation: {field}: {reason}")]
    Validation { field: String, reason: String },
    #[error("archived: {0}")]
    Archived(String),
    #[error(
        "stale_claim: This task lifecycle changed. Read the current claim and reconcile your work; do not replay the old payload with a fresh token."
    )]
    StaleClaim,
    #[error("conflict: This item changed since you opened it. Review the latest changes.")]
    Conflict,
    #[error("storage: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("migration: {0}")]
    Migration(#[from] rusqlite_migration::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("data: {0}")]
    Json(#[from] serde_json::Error),
}
impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::AlreadyUndone(_) => "already_undone",
            Self::InUse { .. } => "in_use",
            Self::IdempotencyConflict(_) => "idempotency_conflict",
            Self::ExecutionRequired(_) => "execution_required",
            Self::NotReady(_) => "not_ready",
            Self::WrongStatus(_) => "wrong_status",
            Self::Forbidden(_) => "forbidden",
            Self::NotFound(_) => "not_found",
            Self::ClaimConflict { .. } => "claim_conflict",
            Self::Validation { .. } => "validation",
            Self::Archived(_) => "archived",
            Self::StaleClaim => "stale_claim",
            Self::Conflict => "conflict",
            Self::Storage(_) => "storage",
            Self::Migration(_) => "migration",
            Self::Io(_) => "io",
            Self::Json(_) => "data",
        }
    }
    /// Protocol text includes its typed prefix exactly once, including wrapped errors.
    pub fn protocol_message(&self) -> String {
        let text = self.to_string();
        let prefix = format!("{}:", self.code());
        let mut reason = text.as_str();
        while let Some(tail) = reason.strip_prefix(&prefix) {
            reason = tail.trim_start();
        }
        format!("{}: {reason}", self.code())
    }
}

pub(crate) fn invalid(field: &str, reason: &str) -> Error {
    Error::Validation {
        field: field.into(),
        reason: reason.into(),
    }
}

pub fn now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .expect("UTC timestamp")
}

pub(crate) fn id() -> String {
    ulid::Ulid::generate().to_string()
}

mod file_model;
mod file_preview;
pub use file_preview::*;
mod files_v2;
pub use file_model::*;
pub use files_v2::*;
mod project_folders;
pub use project_folders::*;
mod project_registry;
pub use project_registry::*;
mod project_move;
pub use project_move::*;
mod board_snapshot;
pub use board_snapshot::*;
mod storage_io;

mod folder_contract;
pub use folder_contract::*;
