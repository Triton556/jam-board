use anyhow::{Result, bail};
use reqwest::{Client, Method, Url};
use std::{
    net::{IpAddr, SocketAddr},
    time::Duration,
};

pub const TIMEOUT: Duration = Duration::from_secs(15);
pub const PAGE_LIMIT: usize = 2 * 1024 * 1024;
pub const IMAGE_LIMIT: usize = 15 * 1024 * 1024;

pub fn public_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 0 || b == 168 || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            // Only ordinary global unicast. Reject mapped, NAT64, local, multicast,
            // documentation, Teredo, 6to4 and other special-purpose ranges.
            let s = ip.segments();
            (s[0] & 0xe000) == 0x2000
                && !(s[0] == 0x2001 && (s[1] <= 0x1ff || s[1] == 0xdb8))
                && s[0] != 0x2002
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}

pub fn validate_url(url: &Url) -> Result<()> {
    if !matches!(url.scheme(), "http" | "https") {
        bail!("Only http and https URLs are allowed");
    }
    if url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        bail!("Use a public URL without embedded credentials");
    }
    if let Some(host) = url.host_str()
        && let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>()
        && !public_address(ip)
    {
        bail!("URL must resolve only to public addresses");
    }
    Ok(())
}

pub fn check_addresses(addresses: &[SocketAddr]) -> Result<()> {
    if addresses.is_empty() || addresses.iter().any(|a| !public_address(a.ip())) {
        bail!("URL must resolve only to public addresses");
    }
    Ok(())
}
async fn resolve(url: Url) -> Result<Vec<SocketAddr>> {
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("URL has no host"))?
        .trim_matches(['[', ']']);
    let port = url
        .port_or_known_default()
        .ok_or_else(|| anyhow::anyhow!("URL has no port"))?;
    Ok(match host.parse::<IpAddr>() {
        Ok(ip) => vec![SocketAddr::new(ip, port)],
        Err(_) => tokio::net::lookup_host((host, port))
            .await
            .map_err(|_| anyhow::anyhow!("Cannot resolve the URL host"))?
            .collect(),
    })
}
fn pinned_client(url: &Url, addresses: &[SocketAddr]) -> Result<Client> {
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("URL has no host"))?
        .trim_matches(['[', ']']);
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(TIMEOUT)
        .connect_timeout(TIMEOUT)
        .user_agent(concat!("JamBoard/", env!("CARGO_PKG_VERSION")))
        .resolve_to_addrs(host, addresses)
        .build()
        .map_err(|_| anyhow::anyhow!("Cannot prepare web request"))
}

pub fn redirect_url(current: &Url, location: &str, followed: usize) -> Result<Url> {
    if followed >= 3 {
        bail!("Too many redirects (maximum 3)");
    }
    let url = current
        .join(location)
        .map_err(|_| anyhow::anyhow!("Invalid redirect URL"))?;
    validate_url(&url)?;
    Ok(url)
}
pub struct Response {
    pub url: Url,
    pub mime: String,
    pub bytes: Vec<u8>,
}
pub enum BodyKind {
    Text,
    Image,
    Json,
}
pub fn validate_mime(mime: &str, kind: &BodyKind) -> Result<()> {
    let valid = match kind {
        BodyKind::Text => mime.starts_with("text/") || mime == "application/xhtml+xml",
        BodyKind::Image => mime.starts_with("image/"),
        BodyKind::Json => mime == "application/json",
    };
    if !valid {
        bail!("The URL returned an unsupported content type");
    }
    Ok(())
}
pub fn append_capped(bytes: &mut Vec<u8>, chunk: &[u8], limit: usize) -> Result<()> {
    if chunk.len() > limit.saturating_sub(bytes.len()) {
        bail!("Response exceeds the size limit");
    }
    bytes.extend_from_slice(chunk);
    Ok(())
}
pub async fn fetch(url: Url, kind: BodyKind, limit: usize) -> Result<Response> {
    tokio::time::timeout(TIMEOUT, request(url, kind, limit, None))
        .await
        .map_err(|_| anyhow::anyhow!("Web request timed out after 15 seconds"))?
}
pub async fn provider_request(
    url: Url,
    key: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value> {
    let response = tokio::time::timeout(
        TIMEOUT,
        request(url, BodyKind::Json, PAGE_LIMIT, Some((key, body))),
    )
    .await
    .map_err(|_| anyhow::anyhow!("Web search timed out after 15 seconds"))??;
    serde_json::from_slice(&response.bytes)
        .map_err(|_| anyhow::anyhow!("Search provider returned an invalid response"))
}
async fn request(
    url: Url,
    kind: BodyKind,
    limit: usize,
    provider: Option<(&str, Option<serde_json::Value>)>,
) -> Result<Response> {
    request_using(
        url,
        kind,
        limit,
        provider.is_some(),
        resolve,
        |url, addresses| send(url, addresses, &provider),
    )
    .await
}
async fn send(
    url: Url,
    addresses: Vec<SocketAddr>,
    provider: &Option<(&str, Option<serde_json::Value>)>,
) -> Result<reqwest::Response> {
    let client = pinned_client(&url, &addresses)?;
    let mut req = client
        .request(
            if provider.as_ref().is_some_and(|(_, body)| body.is_some()) {
                Method::POST
            } else {
                Method::GET
            },
            url,
        )
        .header("Accept-Encoding", "identity");
    if let Some((key, body)) = provider {
        if let Some(body) = body {
            req = req.json(body).bearer_auth(key);
        } else {
            req = req.header("X-Subscription-Token", *key);
        }
    }
    req.send().await.map_err(|e| {
        if e.is_timeout() {
            anyhow::anyhow!("Web request timed out after 15 seconds")
        } else {
            anyhow::anyhow!("Cannot reach the web server")
        }
    })
}
async fn request_using<R, RF, S, SF>(
    mut url: Url,
    kind: BodyKind,
    limit: usize,
    is_provider: bool,
    mut resolve: R,
    mut send: S,
) -> Result<Response>
where
    R: FnMut(Url) -> RF,
    RF: std::future::Future<Output = Result<Vec<SocketAddr>>>,
    S: FnMut(Url, Vec<SocketAddr>) -> SF,
    SF: std::future::Future<Output = Result<reqwest::Response>>,
{
    for hop in 0..=3 {
        validate_url(&url)?;
        let addresses = resolve(url.clone()).await?;
        check_addresses(&addresses)?;
        let mut response = send(url.clone(), addresses).await?;
        if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            if is_provider {
                bail!("Search provider returned an unexpected redirect");
            }
            let location = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| anyhow::anyhow!("Redirect has no valid destination"))?;
            url = redirect_url(&url, location, hop)?;
            continue;
        }
        match response.status().as_u16() {
            200..=299 => {}
            401 | 403 if is_provider => bail!("Check the web search API key"),
            429 => bail!("Web server rate limit reached; try again later"),
            _ => bail!("Web server returned HTTP {}", response.status().as_u16()),
        }
        let mime = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        validate_mime(&mime, &kind)?;
        let declared_length = response
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        if declared_length.is_some_and(|n| n > limit as u64)
            || response.content_length().is_some_and(|n| n > limit as u64)
        {
            bail!("Response exceeds the size limit");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| anyhow::anyhow!("Cannot read the web response"))?
        {
            append_capped(&mut bytes, &chunk, limit)?;
        }
        return Ok(Response { url, mime, bytes });
    }
    bail!("Too many redirects (maximum 3)")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn response(
        status: u16,
        location: Option<&str>,
        mime: &str,
        bytes: Vec<u8>,
    ) -> reqwest::Response {
        let mut response = ::http::Response::builder()
            .status(status)
            .header("content-type", mime);
        if let Some(location) = location {
            response = response.header("location", location);
        }
        response.body(bytes).unwrap().into()
    }
    #[tokio::test]
    async fn w7_redirect_resolves_every_hop_and_blocks_private_dns_before_send() {
        for private in ["10.0.0.1:80", "[fd00::1]:80", "[::1]:80", "100.64.0.1:80"] {
            let dns = Arc::new(Mutex::new(Vec::new()));
            let sends = Arc::new(Mutex::new(Vec::new()));
            let error = request_using(
                Url::parse("https://example.com/start").unwrap(),
                BodyKind::Text,
                PAGE_LIMIT,
                false,
                {
                    let dns = dns.clone();
                    move |url| {
                        dns.lock().unwrap().push(url.to_string());
                        let private = private.to_owned();
                        async move {
                            Ok(vec![if url.path() == "/start" {
                                "8.8.8.8:443".parse().unwrap()
                            } else {
                                private.parse().unwrap()
                            }])
                        }
                    }
                },
                {
                    let sends = sends.clone();
                    move |url, _| {
                        sends.lock().unwrap().push(url.to_string());
                        async {
                            Ok(response(
                                302,
                                Some("https://redirect.example/image"),
                                "text/plain",
                                vec![],
                            ))
                        }
                    }
                },
            )
            .await
            .err()
            .unwrap();
            assert!(error.to_string().contains("public addresses"));
            assert_eq!(dns.lock().unwrap().len(), 2);
            assert_eq!(sends.lock().unwrap().len(), 1);
        }
    }
    #[tokio::test]
    async fn w7_three_redirects_succeed_four_fail_and_final_body_is_capped() {
        for redirects in [3usize, 4] {
            let dns_calls = Arc::new(Mutex::new(0));
            let sends = Arc::new(Mutex::new(0));
            let result = request_using(
                Url::parse("https://example.com/0").unwrap(),
                BodyKind::Text,
                4,
                false,
                {
                    let dns = dns_calls.clone();
                    move |_| {
                        *dns.lock().unwrap() += 1;
                        async { Ok(vec!["8.8.8.8:443".parse().unwrap()]) }
                    }
                },
                {
                    let sends = sends.clone();
                    move |_, _| {
                        let n = {
                            let mut n = sends.lock().unwrap();
                            *n += 1;
                            *n
                        };
                        async move {
                            if n <= redirects {
                                Ok(response(302, Some(&format!("/{n}")), "text/plain", vec![]))
                            } else {
                                Ok(response(200, None, "text/plain", b"done".to_vec()))
                            }
                        }
                    }
                },
            )
            .await;
            if redirects == 3 {
                assert_eq!(result.unwrap().bytes, b"done");
            } else {
                assert!(result.err().unwrap().to_string().contains("maximum 3"));
            }
            assert_eq!(*dns_calls.lock().unwrap(), 4);
            assert_eq!(*sends.lock().unwrap(), 4);
        }
        let result = request_using(
            Url::parse("https://example.com").unwrap(),
            BodyKind::Text,
            4,
            false,
            |_| async { Ok(vec!["8.8.8.8:443".parse().unwrap()]) },
            |_, _| async { Ok(response(200, None, "text/plain", b"12345".to_vec())) },
        )
        .await;
        assert!(result.err().unwrap().to_string().contains("size limit"));
    }
    #[tokio::test]
    async fn w7_provider_auth_errors_and_redirect_do_not_expose_keys() {
        for (status, expected) in [
            (401, "Check the web search API key"),
            (403, "Check the web search API key"),
            (429, "Web server rate limit"),
            (302, "unexpected redirect"),
        ] {
            let result = request_using(
                Url::parse("https://example.com").unwrap(),
                BodyKind::Json,
                PAGE_LIMIT,
                true,
                |_| async { Ok(vec!["8.8.8.8:443".parse().unwrap()]) },
                |_, _| async move {
                    Ok(response(
                        status,
                        Some("https://other.example/"),
                        "application/json",
                        b"key=do-not-expose".to_vec(),
                    ))
                },
            )
            .await;
            let error = result.err().unwrap().to_string();
            assert!(error.contains(expected));
            assert!(!error.contains("do-not-expose"));
        }
    }
    #[tokio::test]
    async fn w7_http_rejects_wrong_type_and_oversized_content_length() {
        for (kind, mime, length, expected) in [
            (BodyKind::Image, "text/html", 1u64, "content type"),
            (
                BodyKind::Text,
                "application/octet-stream",
                1,
                "content type",
            ),
            (
                BodyKind::Image,
                "image/png",
                IMAGE_LIMIT as u64 + 1,
                "size limit",
            ),
            (
                BodyKind::Text,
                "text/plain",
                PAGE_LIMIT as u64 + 1,
                "size limit",
            ),
        ] {
            let limit = if matches!(kind, BodyKind::Image) {
                IMAGE_LIMIT
            } else {
                PAGE_LIMIT
            };
            let result = request_using(
                Url::parse("https://example.com").unwrap(),
                kind,
                limit,
                false,
                |_| async { Ok(vec!["8.8.8.8:443".parse().unwrap()]) },
                |_, _| async move {
                    Ok(::http::Response::builder()
                        .status(200)
                        .header("content-type", mime)
                        .header("content-length", length)
                        .body(Vec::<u8>::new())
                        .unwrap()
                        .into())
                },
            )
            .await;
            assert!(result.err().unwrap().to_string().contains(expected));
        }
    }
}
