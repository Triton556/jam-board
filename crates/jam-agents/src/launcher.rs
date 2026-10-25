//! A batch launcher has two cmd parsing passes: invocation and the npm shim's
//! `%*` forwarding. Preserve C-runtime argv quoting through both passes.
use crate::*;

#[cfg(windows)]
pub(crate) fn terminal_launcher(
    command: String,
    args: Vec<String>,
) -> Result<(String, Vec<String>, Vec<Env>)> {
    let batch = std::path::Path::new(&command)
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("cmd") || s.eq_ignore_ascii_case("bat"));
    if !batch {
        return Ok((command, args, vec![]));
    }
    if std::iter::once(&command)
        .chain(&args)
        .any(|s| s.contains(['\0', '\r', '\n']))
    {
        return Err(err(
            "Batch launcher arguments cannot contain NUL or newlines",
        ));
    }
    let raw = std::iter::once(&command)
        .chain(&args)
        .map(|arg| windows_arg(arg))
        .collect::<Vec<_>>()
        .join(" ");
    let mut quoted = false;
    let mut escaped = String::new();
    for ch in raw.chars() {
        if ch == '"' {
            quoted = !quoted;
        }
        if !quoted && "&|<>^()".contains(ch) {
            escaped.push_str("^^^");
        }
        escaped.push(ch);
    }
    // Expanding a single env token avoids portable-pty re-quoting the full cmd
    // expression. Percent sequences in the expanded value are not recursively
    // expanded. /v:off also preserves literal exclamation marks.
    let cmd = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
    Ok((
        cmd,
        vec![
            "/d".into(),
            "/s".into(),
            "/v:off".into(),
            "/c".into(),
            "%JAM_DOCK_BATCH_COMMAND%".into(),
        ],
        vec![Env {
            name: "JAM_DOCK_BATCH_COMMAND".into(),
            value: escaped,
        }],
    ))
}
#[cfg(not(windows))]
pub(crate) fn terminal_launcher(
    command: String,
    args: Vec<String>,
) -> Result<(String, Vec<String>, Vec<Env>)> {
    Ok((command, args, vec![]))
}

#[cfg(windows)]
fn windows_arg(arg: &str) -> String {
    let mut out = String::from("\"");
    let mut slashes = 0;
    for ch in arg.chars() {
        if ch == '\\' {
            slashes += 1;
            continue;
        }
        if ch == '"' {
            out.push_str(&"\\".repeat(slashes * 2 + 1));
        } else {
            out.push_str(&"\\".repeat(slashes));
        }
        slashes = 0;
        out.push(ch);
    }
    out.push_str(&"\\".repeat(slashes * 2));
    out.push('"');
    out
}
