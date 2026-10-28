use crate::{session::Session, *};
use futures::future::BoxFuture;
use portable_pty::{CommandBuilder, MasterPty, PtySize};
use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

struct TerminalConnector {
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    stop: CancellationToken,
    done: tokio::sync::watch::Receiver<bool>,
    size: tokio::sync::watch::Sender<Option<(u16, u16)>>,
}
impl Connector for TerminalConnector {
    fn prompt(&self, _: Vec<PromptPart>) -> BoxFuture<'_, Result<()>> {
        Box::pin(async { Err(err("Use terminal input for this session")) })
    }
    fn cancel(&self) -> BoxFuture<'_, Result<()>> {
        Box::pin(async { self.write("\u{3}") })
    }
    fn config(&self, _: String, _: String) -> BoxFuture<'_, Result<()>> {
        Box::pin(async {
            Err(err(
                "Terminal sessions do not expose chat configuration options",
            ))
        })
    }
    fn stop(&self) -> BoxFuture<'_, Result<()>> {
        Box::pin(async {
            self.stop.cancel();
            let mut done = self.done.clone();
            if !*done.borrow() {
                let _ = done.wait_for(|v| *v).await;
            }
            Ok(())
        })
    }
    fn write(&self, data: &str) -> Result<()> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| err("Terminal input lock unavailable"))?;
        let writer = writer.as_mut().ok_or_else(|| {
            err(if self.stop.is_cancelled() || *self.done.borrow() {
                "Terminal has stopped"
            } else {
                "Terminal is starting"
            })
        })?;
        writer.write_all(data.as_bytes())?;
        writer.flush()?;
        Ok(())
    }
    fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        if self.stop.is_cancelled() || *self.done.borrow() {
            return Err(err("Terminal has stopped"));
        }
        let master = self
            .master
            .lock()
            .map_err(|_| err("Terminal resize lock unavailable"))?;
        self.size.send_replace(Some((cols, rows)));
        if let Some(master) = master.as_ref() {
            master
                .resize(PtySize {
                    cols,
                    rows,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|_| err("Cannot resize terminal"))?;
        }
        Ok(())
    }
}
pub(crate) async fn start(
    session: Arc<Session>,
    executable: PathBuf,
    preset: Option<&str>,
    args: Vec<String>,
    env: Vec<Env>,
    entries: Vec<McpEntry>,
) -> Result<()> {
    let (command, args) = terminal_command(preset, &executable.to_string_lossy(), &args, &entries)?;
    let (command, args, launcher_env) = crate::launcher::terminal_launcher(command, args)?;
    let requested = Instant::now();
    let (size, mut initial_size) = tokio::sync::watch::channel(None);
    let (done_tx, done) = tokio::sync::watch::channel(false);
    let connector = Arc::new(TerminalConnector {
        master: Arc::new(Mutex::new(None)),
        writer: Arc::new(Mutex::new(None)),
        stop: session.stop.clone(),
        done,
        size,
    });
    *session.connector.lock().expect("connector lock") = Some(connector.clone());
    // This is renderer metadata, never a command line or environment dump.
    session.status(SessionStatus::Starting, Some(renderer_metadata()));
    tokio::spawn(async move {
        // Return the pending session to the dock first. Its first fitted resize
        // is the launch handshake; no child can print into a guessed-size PTY.
        let sized = tokio::select! {
            biased;
            _ = session.stop.cancelled() => false,
            result = initial_size.wait_for(|size| size.is_some()) => result.is_ok(),
        };
        if sized {
            if let Err(error) = start_sized(
                session.clone(),
                connector,
                command,
                args,
                env.into_iter().chain(launcher_env).collect(),
                requested,
            )
            .await
            {
                if session.stop.is_cancelled() {
                    session.status(SessionStatus::Stopped, None);
                } else {
                    session.fail(
                        "Cannot start terminal",
                        Some(session.redact(&error.to_string())),
                    );
                }
            }
        } else {
            session.status(SessionStatus::Stopped, None);
        }
        let _ = done_tx.send(true);
        session.finished.cancel();
    });
    Ok(())
}

fn renderer_metadata() -> String {
    #[cfg(windows)]
    let value = serde_json::json!({ "backend": "conpty", "buildNumber": windows_build_number() });
    #[cfg(not(windows))]
    let value = serde_json::json!({});
    format!("Terminal renderer: {value}")
}

#[cfg(windows)]
fn windows_build_number() -> Option<u32> {
    #[repr(C)]
    struct Version {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform: u32,
        service_pack: [u16; 128],
    }
    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn RtlGetVersion(version: *mut Version) -> i32;
    }
    let mut version = Version {
        size: std::mem::size_of::<Version>() as u32,
        major: 0,
        minor: 0,
        build: 0,
        platform: 0,
        service_pack: [0; 128],
    };
    // SAFETY: initialized OSVERSIONINFOW with its exact size; the API writes
    // only to this live, uniquely borrowed stack value and retains no pointer.
    (unsafe { RtlGetVersion(&mut version) } >= 0).then_some(version.build)
}

async fn start_sized(
    session: Arc<Session>,
    connector: Arc<TerminalConnector>,
    command: String,
    args: Vec<String>,
    env: Vec<Env>,
    requested: Instant,
) -> Result<()> {
    let cwd = session.view().cwd;
    let setup_connector = connector.clone();
    let setup = tokio::task::spawn_blocking(move || {
        // Serialize with resize through spawn so a resize during preparation
        // is applied before the child can emit its first frame.
        let mut master = setup_connector.master.lock().expect("master lock");
        let (cols, rows) =
            (*setup_connector.size.borrow()).ok_or_else(|| err("Terminal size missing"))?;
        if setup_connector.stop.is_cancelled() {
            return Err(err("Terminal stopped before launch"));
        }
        let pair = portable_pty::native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|_| err("Cannot open a pseudo-terminal on this system"))?;
        let mut cmd = CommandBuilder::new(command);
        cmd.args(args);
        cmd.cwd(cwd);
        for e in env {
            cmd.env(e.name, e.value);
        }
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|_| err("Cannot read terminal output"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|_| err("Cannot open terminal input"))?;
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|_| err("Cannot launch terminal executable"))?;
        let spawned = Instant::now();
        // portable-pty enables PSEUDOCONSOLE_INHERIT_CURSOR. Establish the
        // initial origin even when xterm has not attached yet, otherwise a
        // very short command can deadlock ClosePseudoConsole waiting for DSR.
        #[cfg(windows)]
        let writer = {
            let mut writer = writer;
            let _ = writer.write_all(b"\x1b[1;1R");
            let _ = writer.flush();
            writer
        };
        let tree = match child
            .process_id()
            .map(crate::process::ProcessTree::attach)
            .transpose()
        {
            Ok(tree) => tree,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e);
            }
        };
        drop(pair.slave);
        *master = Some(pair.master);
        Ok::<_, AgentError>((child, reader, writer, tree, spawned))
    })
    .await
    .map_err(|_| err("Terminal startup worker failed"))??;
    let (mut child, reader, writer, tree, spawned) = setup;
    let master = connector.master.clone();
    let writer_slot = connector.writer.clone();
    *writer_slot.lock().expect("writer lock") = Some(writer);
    let writer = writer_slot;
    let stop = session.stop.clone();
    session.status(
        SessionStatus::Starting,
        Some(format!(
            "Terminal startup: spawned; request_to_spawn_ms={}",
            spawned.duration_since(requested).as_millis()
        )),
    );
    let ready_session = session.clone();
    let ready_timeout = tokio::spawn(async move {
        ready_after_timeout(&ready_session).await;
    });
    let output_session = session.clone();
    let output = tokio::task::spawn_blocking(move || {
        read_output(&output_session, reader, requested, spawned);
    });
    {
        let pid = child.process_id();
        let result = loop {
            if stop.is_cancelled() {
                if let Some(pid) = pid {
                    let _ = crate::session::kill_tree(pid).await;
                }
                if let Some(tree) = &tree {
                    let _ = tree.terminate();
                }
                let _ = child.kill();
                let _ = child.wait();
                break Ok(None);
            }
            match child.try_wait() {
                Ok(Some(status)) => break Ok(Some(status)),
                Err(e) => break Err(e),
                Ok(None) => {}
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        };
        if let Some(tree) = &tree {
            let _ = tree.terminate();
        }
        let input = writer.lock().expect("writer lock").take();
        let pty = master.lock().expect("master lock").take();
        // ClosePseudoConsole may wait for the output pipe. Never close it on
        // the async executor; keep the pipe reader running concurrently.
        let close = tokio::task::spawn_blocking(move || {
            drop(input);
            drop(pty);
        });
        // Output is drained before final status so a remount sees final scrollback.
        let _ = output.await;
        let _ = close.await;
        ready_timeout.abort();
        match result {
            Ok(Some(status)) if !status.success() => session.fail(
                "Terminal process exited with an error",
                Some(status.to_string()),
            ),
            Err(_) => session.fail("Cannot monitor terminal process", None),
            _ => session.status(SessionStatus::Stopped, None),
        }
    }
    Ok(())
}

async fn ready_after_timeout(session: &Session) {
    tokio::time::sleep(Duration::from_secs(15)).await;
    terminal_ready(session, "Terminal startup: no output after 15 s".into());
}

fn read_output(
    output_session: &Session,
    mut reader: impl Read,
    requested: Instant,
    spawned: Instant,
) {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 8192];
    let mut pending = String::new();
    let mut first_byte = true;
    let mut first_printable = true;
    let mut visible = PrintableOutput::default();
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if first_byte {
                    first_byte = false;
                    let message = format!(
                        "Terminal startup: first_byte; request_to_first_byte_ms={}; spawn_to_first_byte_ms={}",
                        requested.elapsed().as_millis(),
                        spawned.elapsed().as_millis()
                    );
                    // Log even if the no-output timeout already made it Ready.
                    tracing::debug!(session_id = %output_session.view().id, "{message}");
                }
                bytes.extend_from_slice(&buffer[..n]);
                // Preserve a partial UTF-8 code point until the next PTY read.
                let valid = match std::str::from_utf8(&bytes) {
                    Ok(_) => bytes.len(),
                    Err(e) if e.error_len().is_none() => e.valid_up_to(),
                    Err(_) => bytes.len(),
                };
                pending.push_str(&String::from_utf8_lossy(&bytes[..valid]));
                bytes.drain(..valid);
                let data = output_session.take_safe_text(&mut pending, false);
                if !data.is_empty() {
                    if first_printable && visible.feed(&data) {
                        first_printable = false;
                        record_ready(
                            output_session,
                            format!(
                                "Terminal startup: first_printable; request_to_first_printable_ms={}; spawn_to_first_printable_ms={}",
                                requested.elapsed().as_millis(),
                                spawned.elapsed().as_millis()
                            ),
                            true,
                        );
                    }
                    output_session.terminal_output(data);
                }
            }
        }
    }
    pending.push_str(&String::from_utf8_lossy(&bytes));
    if !pending.is_empty() {
        output_session.terminal_output(pending);
    }
}

#[derive(Default)]
enum EscapeState {
    #[default]
    Ground,
    Escape,
    Intermediate,
    Csi,
    String,
    StringEscape,
}

/// Track ECMA-48 sequences across PTY chunks. Cursor reports, modes and OSC
/// titles are startup traffic, not visible output. Decode UTF-8 before feeding.
#[derive(Default)]
struct PrintableOutput(EscapeState);

impl PrintableOutput {
    fn feed(&mut self, text: &str) -> bool {
        let mut printable = false;
        for ch in text.chars() {
            if matches!(ch, '\u{18}' | '\u{1a}') {
                self.0 = EscapeState::Ground;
                continue;
            }
            self.0 = match self.0 {
                EscapeState::Ground => match ch {
                    '\u{1b}' => EscapeState::Escape,
                    '\u{9b}' => EscapeState::Csi,
                    '\u{90}' | '\u{98}' | '\u{9d}' | '\u{9e}' | '\u{9f}' => EscapeState::String,
                    _ => {
                        printable |= !ch.is_control()
                            && !ch.is_whitespace()
                            && !matches!(ch, '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}');
                        EscapeState::Ground
                    }
                },
                EscapeState::Escape => match ch {
                    '[' => EscapeState::Csi,
                    ']' | 'P' | 'X' | '^' | '_' => EscapeState::String,
                    ' '..='/' => EscapeState::Intermediate,
                    '\u{1b}' => EscapeState::Escape,
                    _ => EscapeState::Ground,
                },
                EscapeState::Intermediate => match ch {
                    '\u{1b}' => EscapeState::Escape,
                    '0'..='~' => EscapeState::Ground,
                    _ => EscapeState::Intermediate,
                },
                EscapeState::Csi => match ch {
                    '\u{1b}' => EscapeState::Escape,
                    '@'..='~' => EscapeState::Ground,
                    _ => EscapeState::Csi,
                },
                EscapeState::String => match ch {
                    '\u{7}' | '\u{9c}' => EscapeState::Ground,
                    '\u{1b}' => EscapeState::StringEscape,
                    _ => EscapeState::String,
                },
                EscapeState::StringEscape => match ch {
                    '\\' | '\u{9c}' | '\u{7}' => EscapeState::Ground,
                    '\u{1b}' => EscapeState::StringEscape,
                    _ => EscapeState::String,
                },
            };
        }
        printable
    }
}

fn terminal_ready(session: &Session, message: String) {
    record_ready(session, message, false);
}

fn record_ready(session: &Session, message: String, record_if_ready: bool) {
    let mut inner = session.inner.lock().expect("session lock");
    if inner.view.status == SessionStatus::Starting
        || (record_if_ready && inner.view.status == SessionStatus::Ready)
    {
        inner.view.status = SessionStatus::Ready;
        session.push_locked(
            &mut inner,
            AgentEventKind::Status {
                status: SessionStatus::Ready,
                message: Some(message),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{events, session};

    #[tokio::test]
    async fn bc03_stop_before_size_does_not_spawn() {
        let s = session(SessionStatus::Starting);
        start(
            s.clone(),
            PathBuf::from("fictional-never-launched"),
            None,
            vec![],
            vec![],
            vec![],
        )
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(s.view().status, SessionStatus::Starting);
        assert!(s.inner.lock().unwrap().scrollback.is_empty());
        tokio::time::timeout(Duration::from_secs(1), s.connector().unwrap().stop())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(s.view().status, SessionStatus::Stopped);
        assert!(s.connector().unwrap().resize(40, 10).is_err());
    }

    #[test]
    fn bc03_first_printable_sets_ready_and_preserves_split_cyrillic() {
        struct SplitOutput {
            session: Arc<Session>,
            chunks: std::collections::VecDeque<Vec<u8>>,
            reads: usize,
        }
        impl Read for SplitOutput {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                assert_eq!(
                    self.session.view().status,
                    if self.reads < 2 {
                        SessionStatus::Starting
                    } else {
                        SessionStatus::Ready
                    }
                );
                self.reads += 1;
                let Some(chunk) = self.chunks.pop_front() else {
                    return Ok(0);
                };
                buffer[..chunk.len()].copy_from_slice(&chunk);
                Ok(chunk.len())
            }
        }
        let s = session(SessionStatus::Starting);
        let text = "Противоречие Unity 6.3\r\nЧто Си Ос на";
        let bytes = text.as_bytes();
        let reader = SplitOutput {
            session: s.clone(),
            reads: 0,
            chunks: [
                bytes[..1].to_vec(),
                bytes[1..7].to_vec(),
                bytes[7..].to_vec(),
            ]
            .into(),
        };
        read_output(&s, reader, Instant::now(), Instant::now());
        assert_eq!(s.inner.lock().unwrap().scrollback, text);
        let ready: Vec<_> = events(&s)
            .into_iter()
            .filter(|event| {
                matches!(
                    &event.event,
                    AgentEventKind::Status {
                        status: SessionStatus::Ready,
                        ..
                    }
                )
            })
            .collect();
        assert_eq!(ready.len(), 1);
        assert!(
            matches!(&ready[0].event, AgentEventKind::Status { message: Some(message), .. }
            if message.contains("request_to_first_printable_ms=") && message.contains("spawn_to_first_printable_ms="))
        );
    }

    #[test]
    fn bc03_delayed_readiness_never_revives_terminal_states() {
        for status in [
            SessionStatus::Ready,
            SessionStatus::Stopped,
            SessionStatus::Failed,
        ] {
            let s = session(status);
            terminal_ready(&s, "late first byte".into());
            assert_eq!(s.view().status, status);
            assert!(events(&s).is_empty());
        }
    }

    #[test]
    fn bc03_first_byte_after_timeout_still_records_timings() {
        let s = session(SessionStatus::Ready);
        read_output(
            &s,
            std::io::Cursor::new(b"late output"),
            Instant::now(),
            Instant::now(),
        );
        assert_eq!(s.view().status, SessionStatus::Ready);
        assert!(events(&s).iter().any(|event| matches!(&event.event,
            AgentEventKind::Status { message: Some(message), .. } if message.contains("first_printable"))));
    }

    #[test]
    fn bc03_control_strings_and_split_sequences_are_not_printable() {
        let controls = "\x1b[?25l\x1b[6n\x1b[1;1H\x1b[0m\x1b]0;Title is not output\x07\x1b]2;Another title\x1b\\\x1bPignored payload\x1b\\\x1b(B\r\n\t \u{200b}\u{feff}";
        for split in controls
            .char_indices()
            .map(|(i, _)| i)
            .chain([controls.len()])
        {
            let mut detector = PrintableOutput::default();
            assert!(!detector.feed(&controls[..split]), "split={split}");
            assert!(!detector.feed(&controls[split..]), "split={split}");
            assert!(detector.feed("Привет Unity 6.3"));
        }
    }

    #[tokio::test]
    async fn bc03_native_control_preamble_waits_two_seconds_for_printable_output() {
        let s = session(SessionStatus::Starting);
        let script = "process.stdout.write('\\x1b[?25l\\x1b]0;control-only marker\\x07\\x1b[2J\\x1b[H');setTimeout(()=>process.stdout.write('Привет after 2 s\\r\\n'),2000);setInterval(()=>{},1000)";
        let began = Instant::now();
        start(
            s.clone(),
            which::which("node").unwrap(),
            None,
            vec!["-e".into(), script.into()],
            vec![],
            vec![],
        )
        .await
        .unwrap();
        s.connector().unwrap().resize(47, 9).unwrap();
        let observed = tokio::time::timeout(Duration::from_secs(6), async {
            while !s
                .inner
                .lock()
                .unwrap()
                .scrollback
                .contains("control-only marker")
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            assert_eq!(s.view().status, SessionStatus::Starting);
            tokio::time::sleep(Duration::from_millis(500)).await;
            assert_eq!(s.view().status, SessionStatus::Starting);
            while s.view().status == SessionStatus::Starting {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            assert_eq!(s.view().status, SessionStatus::Ready);
            assert!(began.elapsed() >= Duration::from_secs(2));
        })
        .await;
        s.connector().unwrap().stop().await.unwrap();
        observed.expect("Delayed printable output was not observed");
        for event in events(&s) {
            if let AgentEventKind::Status {
                message: Some(message),
                ..
            } = event.event
                && message.contains("first_printable")
            {
                println!("two-second fixture: {message}");
            }
        }
    }

    #[tokio::test]
    async fn bc03_no_output_becomes_ready_after_fifteen_seconds() {
        let s = session(SessionStatus::Starting);
        let started = Instant::now();
        ready_after_timeout(&s).await;
        assert!(started.elapsed() >= Duration::from_secs(15));
        assert_eq!(s.view().status, SessionStatus::Ready);
    }

    #[tokio::test]
    async fn bc03_scripted_pty_uses_fitted_size_before_first_frame() {
        for delay_ms in [250, 0] {
            let s = session(SessionStatus::Starting);
            let script = format!(
                "setTimeout(()=>process.stdout.write('SIZE='+process.stdout.columns+'x'+process.stdout.rows+' Противоречие Unity 6.3\\r\\n'),{delay_ms});setInterval(()=>{{}},1000)"
            );
            start(
                s.clone(),
                which::which("node").expect("Node is a CI prerequisite"),
                None,
                vec!["-e".into(), script],
                vec![],
                vec![],
            )
            .await
            .unwrap();
            assert_eq!(s.view().status, SessionStatus::Starting);
            s.connector().unwrap().resize(47, 9).unwrap();
            let observed = tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    if s.inner.lock().unwrap().scrollback.contains("SIZE=47x9") {
                        break;
                    }
                    if matches!(
                        s.view().status,
                        SessionStatus::Failed | SessionStatus::Stopped
                    ) {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await;
            s.connector().unwrap().stop().await.unwrap();
            observed.expect("Scripted PTY did not print its fitted size");
            assert!(s.inner.lock().unwrap().scrollback.contains("SIZE=47x9"));
            for event in events(&s) {
                if let AgentEventKind::Status {
                    message: Some(message),
                    ..
                } = event.event
                    && message.starts_with("Terminal startup:")
                {
                    println!("scripted delay_ms={delay_ms}: {message}");
                }
            }
        }
    }
}
