use crate::{session::Session, *};
use futures::future::BoxFuture;
use portable_pty::{CommandBuilder, MasterPty, PtySize};
use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

struct TerminalConnector {
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    stop: CancellationToken,
    done: tokio::sync::watch::Receiver<bool>,
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
        let writer = writer.as_mut().ok_or_else(|| err("Terminal has stopped"))?;
        writer.write_all(data.as_bytes())?;
        writer.flush()?;
        Ok(())
    }
    fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.master
            .lock()
            .map_err(|_| err("Terminal resize lock unavailable"))?
            .as_ref()
            .ok_or_else(|| err("Terminal has stopped"))?
            .resize(PtySize {
                cols,
                rows,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|_| err("Cannot resize terminal"))
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
    let cwd = session.view().cwd;
    let setup = tokio::task::spawn_blocking(move || {
        let pair = portable_pty::native_pty_system()
            .openpty(PtySize {
                rows: 30,
                cols: 100,
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
        for e in launcher_env {
            cmd.env(e.name, e.value);
        }
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|_| err("Cannot read terminal output"))?;
        let mut writer = pair
            .master
            .take_writer()
            .map_err(|_| err("Cannot open terminal input"))?;
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|_| err("Cannot launch terminal executable"))?;
        // portable-pty enables PSEUDOCONSOLE_INHERIT_CURSOR. Establish the
        // initial origin even when xterm has not attached yet, otherwise a
        // very short command can deadlock ClosePseudoConsole waiting for DSR.
        #[cfg(windows)]
        {
            let _ = writer.write_all(b"\x1b[1;1R");
            let _ = writer.flush();
        }
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
        Ok::<_, AgentError>((pair.master, child, reader, writer, tree))
    })
    .await
    .map_err(|_| err("Terminal startup worker failed"))??;
    let (master, mut child, mut reader, writer, tree) = setup;
    let master = Arc::new(Mutex::new(Some(master)));
    let writer = Arc::new(Mutex::new(Some(writer)));
    let stop = session.stop.clone();
    let (done_tx, done) = tokio::sync::watch::channel(false);
    *session.connector.lock().expect("connector lock") = Some(Arc::new(TerminalConnector {
        master: master.clone(),
        writer: writer.clone(),
        stop: stop.clone(),
        done,
    }));
    session.status(SessionStatus::Ready, None);
    let output_session = session.clone();
    let output = tokio::task::spawn_blocking(move || {
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 8192];
        let mut pending = String::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
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
                        output_session.terminal_output(data);
                    }
                }
            }
        }
        pending.push_str(&String::from_utf8_lossy(&bytes));
        if !pending.is_empty() {
            output_session.terminal_output(pending);
        }
    });
    tokio::spawn(async move {
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
        match result {
            Ok(Some(status)) if !status.success() => session.fail(
                "Terminal process exited with an error",
                Some(status.to_string()),
            ),
            Err(_) => session.fail("Cannot monitor terminal process", None),
            _ => session.status(SessionStatus::Stopped, None),
        }
        let _ = done_tx.send(true);
        session.finished.cancel();
    });
    Ok(())
}
