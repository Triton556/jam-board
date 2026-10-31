//! MCP adapters for the shared Jam Board domain.
mod http;
mod logging;
mod server;
pub use http::{HttpServer, start_http, start_http_with_manager, token};
pub use logging::init_logging;
pub use server::{JamServer, RecentCall, RecentCalls, tool_catalog};

mod runtime;
pub use runtime::{
    ConfigSnippets, McpRuntime, McpStatus, config_snippets, folder_config_snippets,
    project_config_snippets,
};

#[cfg(test)]
mod canvas_tests;
mod v2;
