//! MCP adapters for the shared Jam Board domain.
mod http;
mod logging;
mod server;
pub use http::{HttpServer, start_http, token};
pub use logging::init_logging;
pub use server::{JamServer, RecentCall, RecentCalls};

mod runtime;
pub use runtime::{
    ConfigSnippets, McpRuntime, McpStatus, config_snippets, project_config_snippets,
};

mod v2;
