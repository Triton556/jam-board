//! Shared domain and SQLite storage. No desktop or MCP dependencies.
mod canvas;
mod canvas_tools;
pub use canvas_tools::*;
mod changes;
mod context;
mod db;
mod desktop;
mod execution;
mod human_planning;
mod m5;
mod migration_v3;
mod model;
mod planning;
mod projects;
mod references;
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
pub use snapshot_v2::PlanningExport;
pub use v2model::*;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
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
pub use file_model::*;
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
