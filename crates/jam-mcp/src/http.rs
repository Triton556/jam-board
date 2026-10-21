use crate::{JamServer, RecentCalls};
use axum::{
    Router,
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::Response,
};
use base64::Engine;
use jam_core::Store;
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use std::{path::Path, sync::Arc};

pub fn token(data_dir: &Path) -> std::io::Result<String> {
    std::fs::create_dir_all(data_dir)?;
    let path = data_dir.join("mcp-token");
    match std::fs::read_to_string(&path) {
        Ok(t)
            if base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(t.trim())
                .is_ok_and(|v| v.len() == 32) =>
        {
            Ok(t.trim().into())
        }
        Ok(_) => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "mcp-token must contain 32 base64url-encoded bytes",
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            use std::io::Write;
            let bytes: [u8; 32] = rand::random();
            let t = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
            let mut opts = std::fs::OpenOptions::new();
            opts.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            match opts.open(&path) {
                Ok(mut file) => {
                    file.write_all(t.as_bytes())?;
                    file.sync_all()?;
                    Ok(t)
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => token(data_dir),
                Err(e) => Err(e),
            }
        }
        Err(e) => Err(e),
    }
}
#[derive(Clone)]
struct Auth {
    bearer: Arc<String>,
}
async fn authorize(State(auth): State<Auth>, request: Request, next: Next) -> Response {
    let valid = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|v| constant_eq(v.as_bytes(), auth.bearer.as_bytes()));
    if !valid {
        return Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .body(Body::empty())
            .expect("response");
    }
    if let Some(origin) = request.headers().get("origin")
        && !origin.to_str().ok().is_some_and(valid_origin)
    {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Body::empty())
            .expect("response");
    }
    next.run(request).await
}
pub(crate) fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}
fn valid_origin(origin: &str) -> bool {
    let Some(rest) = origin.strip_prefix("http://") else {
        return false;
    };
    let Some((host, port)) = rest.split_once(':') else {
        return false;
    };
    ["127.0.0.1", "localhost"].contains(&host)
        && !port.is_empty()
        && port.bytes().all(|b| b.is_ascii_digit())
        && port.parse::<u16>().is_ok()
}

pub struct HttpServer {
    pub port: u16,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<()>,
    cancellation: tokio_util::sync::CancellationToken,
}
impl HttpServer {
    pub async fn stop(mut self) {
        self.cancellation.cancel();
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        let _ = (&mut self.task).await;
    }
}
impl Drop for HttpServer {
    fn drop(&mut self) {
        self.cancellation.cancel();
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        self.task.abort();
    }
}
pub async fn start_http(
    store: Arc<Store>,
    bearer: String,
    recent: RecentCalls,
) -> Result<HttpServer, Box<dyn std::error::Error + Send + Sync>> {
    let preferred = store
        .setting("mcp_http_port")?
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|p| (47321..=47330).contains(p))
        .unwrap_or(47321);
    let ports = std::iter::once(preferred).chain((47321..=47330).filter(|p| *p != preferred));
    for port in ports {
        match tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await {
            Ok(listener) => {
                let s = store.clone();
                let cancellation = tokio_util::sync::CancellationToken::new();
                let service = StreamableHttpService::new(
                    move || Ok(JamServer::new(s.clone(), None, recent.clone())),
                    Arc::new(LocalSessionManager::default()),
                    StreamableHttpServerConfig::default()
                        .with_cancellation_token(cancellation.clone()),
                );
                let app = Router::new().nest_service("/mcp", service).layer(
                    middleware::from_fn_with_state(
                        Auth {
                            bearer: Arc::new(bearer),
                        },
                        authorize,
                    ),
                );
                store.set_setting("mcp_http_port", &port.to_string())?;
                let (tx, rx) = tokio::sync::oneshot::channel();
                let task = tokio::spawn(async move {
                    if let Err(e) = axum::serve(listener, app)
                        .with_graceful_shutdown(async {
                            let _ = rx.await;
                        })
                        .await
                    {
                        tracing::error!(%e,"MCP HTTP server stopped");
                    }
                });
                return Ok(HttpServer {
                    port,
                    shutdown: Some(tx),
                    task,
                    cancellation,
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AddrInUse,
        "MCP ports 47321–47330 are occupied",
    )
    .into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origins() {
        for s in ["http://127.0.0.1:47321", "http://localhost:3000"] {
            assert!(valid_origin(s));
        }
        for s in [
            "null",
            "https://localhost:12",
            "http://localhost.evil:12",
            "http://127.0.0.1:12/evil",
            "http://user@localhost:12",
            "http://localhost:",
            "http://localhost:65536",
        ] {
            assert!(!valid_origin(s), "{s}");
        }
    }
}
