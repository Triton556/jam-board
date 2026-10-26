use jam_web_mcp::{config::*, http::*, providers::*, *};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    net::IpAddr,
    sync::{Arc, Mutex},
};

struct Probe;
#[async_trait::async_trait]
impl SearchProvider for Probe {
    async fn search(
        &self,
        query: &str,
        kind: SearchKind,
        count: u8,
    ) -> anyhow::Result<Vec<SearchResult>> {
        assert_eq!(query, "Jam Board");
        assert!(matches!(kind, SearchKind::Web));
        assert_eq!(count, 1);
        Ok(Vec::new())
    }
}
#[tokio::test]
async fn w7_settings_test_is_one_tiny_web_query() {
    test_connection(&Probe).await.unwrap();
}

#[test]
fn w7_schema_and_annotations() {
    let value = serde_json::to_value(tools()).unwrap();
    let tools = value.as_array().unwrap();
    assert_eq!(tools.len(), 3);
    assert_eq!(
        tools
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["web_search", "read_page", "download_image"]
    );
    for (i, tool) in tools.iter().enumerate() {
        assert_eq!(tool["annotations"]["readOnlyHint"], i < 2);
        assert_eq!(tool["annotations"]["openWorldHint"], true);
        assert_eq!(tool["inputSchema"]["additionalProperties"], false);
    }
    assert_eq!(
        tools[0]["inputSchema"]["properties"]["count"]["maximum"],
        20
    );
    assert_eq!(tools[0]["inputSchema"]["properties"]["count"]["minimum"], 1);
    assert_eq!(
        tools[1]["inputSchema"]["properties"]["maxChars"]["maximum"],
        50000
    );
}
#[test]
fn w7_fixture_brave_web_and_images() {
    let web: Value = serde_json::from_str(include_str!("fixtures/brave-web.json")).unwrap();
    let r = parse_brave(&web, SearchKind::Web, 1).unwrap();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].title, "Example page");
    assert_eq!(r[0].snippet.as_deref(), Some("A public page"));
    assert_eq!(r[0].source, "brave");
    let images = serde_json::from_str(include_str!("fixtures/brave-images.json")).unwrap();
    let r = parse_brave(&images, SearchKind::Images, 20).unwrap();
    assert_eq!(r[0].url, "https://example.com/gallery");
    assert_eq!(
        r[0].image_url.as_deref(),
        Some("https://example.com/full.png")
    );
    assert_eq!(r[0].width, Some(1200));
    assert_eq!(r[0].height, Some(800));
    assert_eq!(
        r[0].thumbnail_url.as_deref(),
        Some("https://example.com/thumb.jpg")
    );
}
#[test]
fn w7_fixture_tavily_web_and_images() {
    let web = serde_json::from_str(include_str!("fixtures/tavily-web.json")).unwrap();
    let r = parse_tavily(&web, SearchKind::Web, 1).unwrap();
    assert_eq!(r[0].snippet.as_deref(), Some("A public page"));
    assert_eq!(r[0].source, "tavily");
    let images = serde_json::from_str(include_str!("fixtures/tavily-images.json")).unwrap();
    let r = parse_tavily(&images, SearchKind::Images, 20).unwrap();
    assert_eq!(r.len(), 2);
    assert_eq!(r[0].title, "Landscape");
    assert_eq!(
        r[1].image_url.as_deref(),
        Some("https://example.org/legacy.jpg")
    );
}
#[test]
fn w7_provider_malformed_empty_and_unsafe_results() {
    assert!(parse_brave(&json!({}), SearchKind::Web, 1).is_err());
    assert!(parse_tavily(&json!({"results":{}}), SearchKind::Web, 1).is_err());
    assert!(
        parse_brave(&json!({"query":{}}), SearchKind::Web, 1)
            .unwrap()
            .is_empty()
    );
    let r = parse_tavily(
        &json!({"images":[{"url":"file:///etc/passwd"},{"url":"http://127.0.0.1/a"}]}),
        SearchKind::Images,
        20,
    )
    .unwrap();
    assert!(r.is_empty());
}
#[test]
fn w7_public_address_ipv4_and_ipv6() {
    for ip in [
        "0.1.2.3",
        "10.0.0.1",
        "127.0.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "172.31.255.255",
        "192.168.1.1",
        "100.64.0.1",
        "100.127.255.255",
        "224.0.0.1",
        "255.255.255.255",
        "198.18.0.1",
        "192.0.2.1",
        "198.51.100.1",
        "203.0.113.1",
        "::",
        "::1",
        "::ffff:8.8.8.8",
        "::ffff:127.0.0.1",
        "fc00::1",
        "fd00::1",
        "fe80::1",
        "ff02::1",
        "64:ff9b::7f00:1",
        "2001:db8::1",
        "2001::1",
        "2002:7f00:1::1",
        "3fff::1",
    ] {
        assert!(!public_address(ip.parse::<IpAddr>().unwrap()), "{ip}");
    }
    for ip in [
        "8.8.8.8",
        "1.1.1.1",
        "100.128.0.1",
        "172.32.0.1",
        "2001:4860:4860::8888",
        "2606:4700:4700::1111",
    ] {
        assert!(public_address(ip.parse().unwrap()), "{ip}");
    }
}
#[test]
fn w7_dns_rejects_empty_or_mixed_public_private_answers() {
    assert!(check_addresses(&[]).is_err());
    assert!(
        check_addresses(&[
            "8.8.8.8:443".parse().unwrap(),
            "10.0.0.1:443".parse().unwrap()
        ])
        .is_err()
    );
    assert!(
        check_addresses(&[
            "[2606:4700:4700::1111]:443".parse().unwrap(),
            "[::1]:443".parse().unwrap()
        ])
        .is_err()
    );
    assert!(check_addresses(&["8.8.8.8:443".parse().unwrap()]).is_ok());
}
#[test]
fn w7_redirect_schemes_private_ipv6_and_limit() {
    let base = reqwest::Url::parse("https://example.com/page").unwrap();
    for location in [
        "http://127.0.0.1/",
        "http://10.0.0.1/",
        "http://[::1]/",
        "http://[fd00::1]/",
        "file:///tmp/a",
        "ftp://example.com/a",
        "http://user:secret@example.com/",
    ] {
        assert!(redirect_url(&base, location, 0).is_err(), "{location}");
    }
    assert_eq!(
        redirect_url(&base, "../image", 2).unwrap().as_str(),
        "https://example.com/image"
    );
    assert!(redirect_url(&base, "/fourth", 3).is_err());
}
#[tokio::test]
async fn w7_fetch_blocks_local_hosts_before_connecting() {
    for url in ["http://127.0.0.1/", "http://[::1]/", "file:///tmp/a"] {
        let error = fetch(
            reqwest::Url::parse(url).unwrap(),
            BodyKind::Text,
            PAGE_LIMIT,
        )
        .await
        .err()
        .unwrap();
        assert!(!error.to_string().contains("Cannot reach"));
    }
}
#[test]
fn w7_size_and_content_type_caps() {
    assert_eq!(TIMEOUT.as_secs(), 15);
    assert_eq!(PAGE_LIMIT, 2 * 1024 * 1024);
    assert_eq!(IMAGE_LIMIT, 15 * 1024 * 1024);
    let mut bytes = vec![1; PAGE_LIMIT - 1];
    append_capped(&mut bytes, &[2], PAGE_LIMIT).unwrap();
    assert!(append_capped(&mut bytes, &[3], PAGE_LIMIT).is_err());
    assert_eq!(bytes.len(), PAGE_LIMIT);
    assert!(validate_mime("text/html", &BodyKind::Image).is_err());
    assert!(validate_mime("application/octet-stream", &BodyKind::Text).is_err());
    assert!(validate_mime("image/svg+xml", &BodyKind::Image).is_ok());
    assert!(image::signature(b"<svg/>").is_err());
}
fn png() -> Vec<u8> {
    let mut b = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    b.extend(2u32.to_be_bytes());
    b.extend(3u32.to_be_bytes());
    b
}
fn response(bytes: Vec<u8>, mime: &str) -> http::Response {
    http::Response {
        url: reqwest::Url::parse("https://example.com/image").unwrap(),
        mime: mime.into(),
        bytes,
    }
}
#[test]
fn w7_image_signatures_and_mime_mismatch() {
    for (bytes, mime) in [
        (png(), "image/png"),
        (b"\xff\xd8\xff\xe0".to_vec(), "image/jpeg"),
        (b"GIF89a\x01\0\x02\0".to_vec(), "image/gif"),
        (b"RIFF\x08\0\0\0WEBPVP8 ".to_vec(), "image/webp"),
        (b"\0\0\0\x18ftypmif1\0\0\0\0avifmif1".to_vec(), "image/avif"),
    ] {
        assert_eq!(image::signature(&bytes).unwrap().0, mime);
    }
    for bytes in [
        b"hello".as_slice(),
        b"\x89PNG",
        b"RIFF\0\0\0\0WAVE",
        b"\0\0\0\x18ftypheic\0\0\0\0heicmif1",
    ] {
        assert!(image::signature(bytes).is_err());
    }
    let dir = tempfile::tempdir().unwrap();
    assert!(
        image::save(
            dir.path(),
            response(png(), "image/jpeg"),
            None,
            "https://example.com/image"
        )
        .is_err()
    );
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    let oversized = response(vec![0; IMAGE_LIMIT + 1], "image/png");
    assert!(
        image::save(dir.path(), oversized, None, "https://example.com/image")
            .unwrap_err()
            .to_string()
            .contains("15 MB")
    );
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}
#[test]
fn w7_filename_safety_unique_atomic_download() {
    let dir = tempfile::tempdir().unwrap();
    for name in [
        "../CON.exe",
        "..\\..\\NUL.png",
        "C:\\a:b\\file.jpg",
        "/tmp/.hidden",
        "😀",
        "a\n\0b",
        "...",
    ] {
        let a = image::save(
            dir.path(),
            response(png(), "image/png"),
            Some(name),
            "https://example.com/image",
        )
        .unwrap();
        let b = image::save(
            dir.path(),
            response(png(), "image/png"),
            Some(name),
            "https://example.com/image",
        )
        .unwrap();
        assert_ne!(a.path, b.path);
        let path = std::path::Path::new(&a.path);
        assert_eq!(
            path.parent().unwrap(),
            std::fs::canonicalize(dir.path()).unwrap()
        );
        let filename = path.file_name().unwrap().to_str().unwrap();
        assert!(filename.starts_with("web-"));
        assert!(filename.ends_with(".png"));
        assert!(
            filename
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        );
        assert_eq!(std::fs::read(path).unwrap(), png());
        assert_eq!(a.width, Some(2));
        assert_eq!(a.height, Some(3));
    }
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 14);
}
#[test]
fn w7_page_reading_text_title_og_image_and_unicode_cap() {
    let url = reqwest::Url::parse("https://example.com/path/page").unwrap();
    let page = page::extract(b"<!doctype html><title> A &amp; B </title><script>secret()</script><style>hidden</style><meta content='../image.png?a=1&amp;b=2' property='og:image'><h1>Hello</h1><p>World &#x1f600;</p>","text/html",&url,50000).unwrap();
    assert_eq!(page.title.as_deref(), Some("A & B"));
    assert_eq!(
        page.image_url.as_deref(),
        Some("https://example.com/image.png?a=1&b=2")
    );
    assert_eq!(page.text, "Hello World 😀");
    assert_eq!(
        page::extract("😀abc".as_bytes(), "text/plain", &url, 2)
            .unwrap()
            .text,
        "😀a"
    );
    assert!(page::extract(b"binary\0data", "text/plain", &url, 50000).is_err());
    assert!(
        page::extract(
            b"<meta property=og:image content='file:///secret'>",
            "text/html",
            &url,
            50000
        )
        .unwrap()
        .image_url
        .is_none()
    );
}

#[derive(Default)]
struct MemoryKeys(Mutex<HashMap<String, String>>);
impl Credentials for MemoryKeys {
    fn get(&self, p: Provider) -> anyhow::Result<Option<String>> {
        Ok(self.0.lock().unwrap().get(p.name()).cloned())
    }
    fn set(&self, p: Provider, key: &str) -> anyhow::Result<()> {
        self.0.lock().unwrap().insert(p.name().into(), key.into());
        Ok(())
    }
    fn clear(&self, p: Provider) -> anyhow::Result<()> {
        self.0.lock().unwrap().remove(p.name());
        Ok(())
    }
}
#[test]
fn w7_settings_key_commands_and_project_environment() {
    let dir = tempfile::tempdir().unwrap();
    let keys = Arc::new(MemoryKeys::default());
    let config = WebConfig::with_credentials(dir.path(), keys.clone());
    assert!(config.settings().unwrap().provider.is_none());
    assert!(!config.settings().unwrap().key_set);
    assert!(config.search_provider().is_err());
    config
        .save(WebSearchSettingsInput {
            provider: Some(Provider::Brave),
        })
        .unwrap();
    assert!(config.search_provider().is_err());
    assert!(config.set_key(Provider::Brave, "  ").is_err());
    assert!(config.set_key(Provider::Brave, "key\nvalue").is_err());
    config.set_key(Provider::Brave, " secret-fixture ").unwrap();
    config.set_key(Provider::Tavily, "unused-key").unwrap();
    assert!(config.settings().unwrap().key_set);
    assert!(config.search_provider().is_ok());
    let env: HashMap<_, _> = config
        .sidecar_env("project-01")
        .unwrap()
        .into_iter()
        .collect();
    assert_eq!(env["JAM_WEB_PROVIDER"], "brave");
    assert_eq!(env["BRAVE_API_KEY"], "secret-fixture");
    assert_eq!(env["TAVILY_API_KEY"], "");
    assert!(
        std::path::Path::new(&env["JAM_WEB_DOWNLOAD_DIR"]).ends_with("web-downloads/project-01")
    );
    let disk = std::fs::read_to_string(dir.path().join("web/settings.json")).unwrap();
    assert!(!disk.contains("secret"));
    assert_eq!(
        serde_json::from_str::<Value>(&disk).unwrap(),
        json!({"provider":"brave"})
    );
    let view = serde_json::to_string(&config.settings().unwrap()).unwrap();
    assert_eq!(view, "{\"provider\":\"brave\",\"keySet\":true}");
    config.clear_key(Provider::Brave).unwrap();
    config.clear_key(Provider::Brave).unwrap();
    assert!(!config.settings().unwrap().key_set);
    config
        .save(WebSearchSettingsInput { provider: None })
        .unwrap();
    assert_eq!(config.sidecar_env("p").unwrap()[0].1, "");
    assert!(config.sidecar_env("../escape").is_err());
    assert!(config.sidecar_env("..").is_err());
    assert!(config.sidecar_env("").is_err());
    assert!(
        WebConfig::with_credentials(dir.path(), keys)
            .settings()
            .unwrap()
            .provider
            .is_none()
    );
}
#[tokio::test]
async fn w7_plain_errors_and_validation_without_provider() {
    let server = WebServer::new(None, None);
    for args in [
        json!({"query":"","kind":"web"}),
        json!({"query":"hi","kind":"web","count":0}),
        json!({"query":"hi","kind":"web","count":21}),
        json!({"query":"hi","kind":"unknown"}),
    ] {
        assert!(server.execute("web_search", args).await.is_err());
    }
    assert!(
        server
            .execute("web_search", json!({"query":"hi","kind":"web"}))
            .await
            .unwrap_err()
            .to_string()
            .contains("Choose a web search provider")
    );
    assert!(
        server
            .execute("read_page", json!({"url":"http://127.0.0.1"}))
            .await
            .unwrap_err()
            .to_string()
            .contains("public addresses")
    );
    assert!(
        server
            .execute(
                "read_page",
                json!({"url":"https://example.com","maxChars":50001})
            )
            .await
            .is_err()
    );
    assert!(
        server
            .execute("download_image", json!({"url":"https://example.com/a"}))
            .await
            .unwrap_err()
            .to_string()
            .contains("JAM_WEB_DOWNLOAD_DIR")
    );
    let error = serde_json::to_value(tool_response(Err(anyhow::anyhow!("A plain error")))).unwrap();
    assert_eq!(error["isError"], true);
    assert_eq!(error["content"][0]["text"], "A plain error");
}
