fn main() {
    println!(
        "{}",
        serde_json::to_string_pretty(&jam_mcp::tool_catalog()).expect("MCP schemas")
    );
}
