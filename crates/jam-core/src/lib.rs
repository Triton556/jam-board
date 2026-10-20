//! Shared domain and SQLite storage. No desktop or MCP dependencies.
mod db;
mod desktop;
mod m5;
mod model;
mod seed;
mod service;
mod snapshot;
mod table;

pub use db::{ChangeFeed, Store, resolve_db_path};
pub use m5::*;
pub use model::*;
pub use snapshot::*;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("not_found: {0}")]
    NotFound(String),
    #[error("claim_conflict: already held by {holder}")]
    ClaimConflict { holder: String },
    #[error("validation: {field}: {reason}")]
    Validation { field: String, reason: String },
    #[error("archived: {0}")]
    Archived(String),
    #[error("conflict: This task changed since you opened it. Review the latest changes.")]
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
