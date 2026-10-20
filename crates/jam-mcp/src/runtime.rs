//! In-process runtime control and authenticated loopback-only stdio call notifications.
use crate::{HttpServer, RecentCall, RecentCalls, start_http, token};
use jam_core::Store;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
type Failure = Box<dyn std::error::Error + Send + Sync>;
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub http_enabled: bool,
    pub running: bool,
    pub port: Option<u16>,
    pub token_tail: String,
    pub sidecar_path: String,
    pub data_dir: String,
    pub recent_calls: Vec<RecentCall>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSnippets {
    pub codex_stdio: String,
    pub codex_http: String,
    pub claude_stdio: String,
    pub claude_http: String,
}
pub struct McpRuntime {
    pub store: Arc<Store>,
    pub recent: RecentCalls,
    pub data_dir: PathBuf,
    pub sidecar_path: PathBuf,
    server: tokio::sync::Mutex<Option<HttpServer>>,
}
impl McpRuntime {
    pub fn new(store: Arc<Store>, sidecar_path: PathBuf) -> Result<Arc<Self>, Failure> {
        let data_dir = std::path::absolute(store.path.parent().ok_or("Missing data directory")?)?;
        token(&data_dir)?;
        Ok(Arc::new(Self {
            store,
            recent: Arc::new(Mutex::new(Default::default())),
            data_dir,
            sidecar_path,
            server: tokio::sync::Mutex::new(None),
        }))
    }
    pub async fn status(&self) -> Result<McpStatus, Failure> {
        let server = self.server.lock().await;
        let token = token(&self.data_dir)?;
        Ok(McpStatus {
            http_enabled: self.store.setting("mcp_http_enabled")?.as_deref() != Some("false"),
            running: server.is_some(),
            port: server.as_ref().map(|s| s.port).or(self
                .store
                .setting("mcp_http_port")?
                .and_then(|s| s.parse().ok())),
            token_tail: token[token.len() - 4..].into(),
            sidecar_path: self.sidecar_path.to_string_lossy().into(),
            data_dir: self.data_dir.to_string_lossy().into(),
            recent_calls: self
                .recent
                .lock()
                .map_err(|_| "Call log unavailable")?
                .iter()
                .cloned()
                .collect(),
        })
    }
    pub async fn set_enabled(&self, enabled: bool) -> Result<(), Failure> {
        let mut server = self.server.lock().await;
        if !enabled {
            server.take();
        } else if server.is_none() {
            *server = Some(
                start_http(
                    self.store.clone(),
                    token(&self.data_dir)?,
                    self.recent.clone(),
                )
                .await?,
            );
        }
        self.store
            .set_setting("mcp_http_enabled", if enabled { "true" } else { "false" })?;
        Ok(())
    }
    pub async fn regenerate(&self) -> Result<(), Failure> {
        use base64::Engine;
        let mut server = self.server.lock().await;
        let enabled = self.store.setting("mcp_http_enabled")?.as_deref() != Some("false");
        server.take();
        let bytes: [u8; 32] = rand::random();
        let bearer = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
        std::fs::write(self.data_dir.join("mcp-token"), &bearer)?;
        if enabled {
            *server = Some(start_http(self.store.clone(), bearer, self.recent.clone()).await?);
        }
        Ok(())
    }
    pub fn reveal(&self) -> Result<String, Failure> {
        Ok(token(&self.data_dir)?)
    }
    pub async fn snippets(&self) -> Result<ConfigSnippets, Failure> {
        let status = self.status().await?;
        Ok(config_snippets(
            &status.sidecar_path,
            &status.data_dir,
            status.port.unwrap_or(47321),
            &self.reveal()?,
        ))
    }
    pub async fn listen_stdio(self: &Arc<Self>) -> Result<(), Failure> {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
        self.store.set_setting(
            "mcp_recent_port",
            &listener.local_addr()?.port().to_string(),
        )?;
        let this = self.clone();
        tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            while let Ok((stream, peer)) = listener.accept().await {
                if !peer.ip().is_loopback() {
                    continue;
                }
                let this = this.clone();
                tokio::spawn(async move {
                    let mut bytes = Vec::new();
                    let mut stream = stream.take(8193);
                    let read = stream.read_to_end(&mut bytes);
                    if !matches!(
                        tokio::time::timeout(std::time::Duration::from_secs(1), read).await,
                        Ok(Ok(_))
                    ) || bytes.len() > 8192
                    {
                        return;
                    }
                    let Ok(packet) = serde_json::from_slice::<CallPacket>(&bytes) else {
                        return;
                    };
                    let Ok(bearer) = token(&this.data_dir) else {
                        return;
                    };
                    if !crate::http::constant_eq(bearer.as_bytes(), packet.bearer.as_bytes()) {
                        return;
                    }
                    if let Ok(mut calls) = this.recent.lock() {
                        calls.push_front(packet.call);
                        calls.truncate(20);
                    }
                });
            }
        });
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
struct CallPacket {
    bearer: String,
    call: RecentCall,
}
pub(crate) fn report_stdio(store: &Store, call: &RecentCall) {
    let send = || -> Result<(), Failure> {
        let Some(port) = store
            .setting("mcp_recent_port")?
            .and_then(|s| s.parse::<u16>().ok())
        else {
            return Ok(());
        };
        let bearer = token(store.path.parent().ok_or("Missing directory")?)?;
        let bytes = serde_json::to_vec(&CallPacket {
            bearer,
            call: call.clone(),
        })?;
        use std::io::Write;
        let mut socket = std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, port)),
            std::time::Duration::from_millis(50),
        )?;
        socket.set_write_timeout(Some(std::time::Duration::from_millis(100)))?;
        socket.write_all(&bytes)?;
        Ok(())
    };
    let _ = send();
}
pub fn config_snippets(sidecar: &str, data_dir: &str, port: u16, bearer: &str) -> ConfigSnippets {
    let quoted = |s: &str| serde_json::to_string(s).expect("string encoding");
    let shell_quote = |s: &str| format!("'{}'", s.replace('\'', "''"));
    ConfigSnippets {
        codex_stdio: format!(
            "[mcp_servers.jam-board]\ncommand = {}\nenv = {{ JAM_AGENT_NAME = \"Codex\", JAM_BOARD_DATA_DIR = {} }}",
            quoted(sidecar),
            quoted(data_dir)
        ),
        codex_http: format!(
            "# Set JAM_BOARD_TOKEN to {bearer} in your environment.\n[mcp_servers.jam-board-http]\nurl = \"http://127.0.0.1:{port}/mcp\"\nbearer_token_env_var = \"JAM_BOARD_TOKEN\""
        ),
        claude_stdio: format!(
            "claude mcp add jam-board --env JAM_AGENT_NAME=Claude --env JAM_BOARD_DATA_DIR={} -- {}",
            shell_quote(data_dir),
            shell_quote(sidecar)
        ),
        claude_http: format!(
            "claude mcp add --transport http jam-board http://127.0.0.1:{port}/mcp --header \"Authorization: Bearer {bearer}\" --header \"X-Jam-Agent: Claude\""
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn stdio_metadata_is_authenticated_in_memory_and_bounded() {
        let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data/tests");
        std::fs::create_dir_all(&base).unwrap();
        let d = tempfile::tempdir_in(base).unwrap();
        let store = Arc::new(Store::open(d.path().join("jam.db")).unwrap());
        let runtime = McpRuntime::new(store.clone(), "sidecar.exe".into()).unwrap();
        runtime.listen_stdio().await.unwrap();
        let call = RecentCall {
            at: jam_core::now(),
            agent: "Codex".into(),
            tool: "get_board".into(),
            ok: true,
            error: None,
        };
        let port = store
            .setting("mcp_recent_port")
            .unwrap()
            .unwrap()
            .parse::<u16>()
            .unwrap();
        use std::io::Write;
        let mut socket =
            std::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)).unwrap();
        socket
            .write_all(
                &serde_json::to_vec(&CallPacket {
                    bearer: "wrong".into(),
                    call: call.clone(),
                })
                .unwrap(),
            )
            .unwrap();
        drop(socket);
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        assert!(runtime.recent.lock().unwrap().is_empty());
        for _ in 0..25 {
            report_stdio(&store, &call);
        }
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                if runtime.recent.lock().unwrap().len() == 20 {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let status = runtime.status().await.unwrap();
        assert_eq!(status.recent_calls.len(), 20);
        assert_eq!(store.latest_seq().unwrap(), 0);
        assert!(
            !serde_json::to_string(&status)
                .unwrap()
                .contains(&runtime.reveal().unwrap())
        );
    }
}
