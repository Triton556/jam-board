//! Project-pinned brain dock runtimes. No desktop or webview dependency.
mod acp;
mod api;
mod attachments;
mod catalog;
mod launcher;
mod model;
mod process;
mod profiles;
mod session;
mod terminal;
mod wiring;

pub use api::{ApiTool, ToolSource};
pub use attachments::AttachmentMedia;
pub use model::*;
pub use profiles::{CredentialStore, OsCredentials, Profiles};
pub use session::{Connector, SessionManager};
pub use wiring::{BoardContext, McpEntry, choose_cwd, mcp_entries, terminal_command};

pub type Result<T> = std::result::Result<T, AgentError>;

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct AgentError(pub String);

impl From<std::io::Error> for AgentError {
    fn from(e: std::io::Error) -> Self {
        Self(e.to_string())
    }
}
impl From<jam_core::Error> for AgentError {
    fn from(e: jam_core::Error) -> Self {
        Self(e.to_string())
    }
}
impl From<serde_json::Error> for AgentError {
    fn from(e: serde_json::Error) -> Self {
        Self(e.to_string())
    }
}
pub(crate) fn err(message: impl Into<String>) -> AgentError {
    AgentError(message.into())
}

#[cfg(test)]
mod auth_tests;
#[cfg(test)]
mod launcher_tests;
#[cfg(test)]
mod tests;

#[cfg(test)]
mod phase3_tests;
