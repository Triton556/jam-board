//! A bounded, non-rendering HTML text extractor; no scripts or subresources run.
use anyhow::{Result, bail};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub url: String,
    pub text: String,
    pub title: Option<String>,
    pub image_url: Option<String>,
}

pub fn extract(bytes: &[u8], mime: &str, url: &reqwest::Url, max_chars: usize) -> Result<Page> {
    let input = String::from_utf8_lossy(bytes);
    if input
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        bail!("The URL did not return readable text");
    }
    let (text, title, image) = if mime == "text/html" || mime == "application/xhtml+xml" {
        html(&input)
    } else {
        (input.into_owned(), None, None)
    };
    let text = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect();
    let image_url = image
        .and_then(|s| url.join(&s).ok())
        .filter(|u| crate::http::validate_url(u).is_ok())
        .map(|u| u.to_string());
    Ok(Page {
        url: url.to_string(),
        text,
        title,
        image_url,
    })
}
fn html(input: &str) -> (String, Option<String>, Option<String>) {
    let mut text = String::new();
    let mut title = String::new();
    let mut in_title = false;
    let mut hidden: Option<String> = None;
    let mut image = None;
    let mut rest = input;
    while !rest.is_empty() {
        if rest.starts_with("<!--") {
            rest = rest.find("-->").map(|n| &rest[n + 3..]).unwrap_or("");
            continue;
        }
        if rest.starts_with('<') {
            let mut quote = None;
            let mut end = None;
            for (i, c) in rest.char_indices().skip(1) {
                if matches!(c, '\'' | '"') {
                    if quote == Some(c) {
                        quote = None;
                    } else if quote.is_none() {
                        quote = Some(c);
                    }
                }
                if c == '>' && quote.is_none() {
                    end = Some(i);
                    break;
                }
            }
            let Some(end) = end else {
                break;
            };
            let tag = &rest[1..end];
            rest = &rest[end + 1..];
            let close = tag.trim_start().starts_with('/');
            let name = tag
                .trim()
                .trim_start_matches('/')
                .split(|c: char| c.is_whitespace() || c == '/')
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            if let Some(ref h) = hidden {
                if close && &name == h {
                    hidden = None;
                }
                continue;
            }
            if !close && matches!(name.as_str(), "script" | "style" | "noscript" | "template") {
                hidden = Some(name);
                continue;
            }
            if name == "title" {
                in_title = !close;
            }
            if !close && name == "meta" {
                let attrs = attributes(tag);
                let get = |key: &str| {
                    attrs
                        .iter()
                        .find(|(k, _)| k == key)
                        .map(|(_, v)| v.as_str())
                };
                if get("property")
                    .or_else(|| get("name"))
                    .is_some_and(|v| v.eq_ignore_ascii_case("og:image"))
                {
                    image = get("content").map(entities);
                }
            }
            text.push(' ');
            continue;
        }
        let end = rest.find('<').unwrap_or(rest.len());
        if hidden.is_none() {
            if in_title {
                title.push_str(&entities(&rest[..end]));
            } else {
                text.push_str(&entities(&rest[..end]));
            }
        }
        rest = &rest[end..];
    }
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    (text, (!title.is_empty()).then_some(title), image)
}
fn attributes(tag: &str) -> Vec<(String, String)> {
    let mut rest = tag.trim_start();
    rest = &rest[rest.find(char::is_whitespace).unwrap_or(rest.len())..];
    let mut attrs = Vec::new();
    loop {
        rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '/');
        if rest.is_empty() {
            break;
        }
        let n = rest
            .find(|c: char| c.is_whitespace() || c == '=')
            .unwrap_or(rest.len());
        let key = rest[..n].to_ascii_lowercase();
        rest = rest[n..].trim_start();
        if !rest.starts_with('=') {
            continue;
        }
        rest = rest[1..].trim_start();
        let value;
        if let Some(q @ ('\'' | '"')) = rest.chars().next() {
            rest = &rest[1..];
            let n = rest.find(q).unwrap_or(rest.len());
            value = rest[..n].to_string();
            rest = rest.get(n + 1..).unwrap_or("");
        } else {
            let n = rest.find(char::is_whitespace).unwrap_or(rest.len());
            value = rest[..n].trim_end_matches('/').into();
            rest = &rest[n..];
        }
        attrs.push((key, value));
    }
    attrs
}
fn entities(input: &str) -> String {
    let mut out = String::new();
    let mut rest = input;
    while let Some(n) = rest.find('&') {
        out.push_str(&rest[..n]);
        rest = &rest[n + 1..];
        let decoded = rest.find(';').filter(|n| *n <= 16).and_then(|n| {
            let entity = &rest[..n];
            let c = match entity {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" | "#39" => Some('\''),
                "nbsp" => Some(' '),
                _ => {
                    if let Some(s) = entity
                        .strip_prefix("#x")
                        .or_else(|| entity.strip_prefix("#X"))
                    {
                        u32::from_str_radix(s, 16).ok().and_then(char::from_u32)
                    } else {
                        entity
                            .strip_prefix('#')
                            .and_then(|s| s.parse().ok())
                            .and_then(char::from_u32)
                    }
                }
            };
            c.map(|c| (n, c))
        });
        if let Some((n, c)) = decoded {
            out.push(c);
            rest = &rest[n + 1..];
        } else {
            out.push('&');
        }
    }
    out.push_str(rest);
    out
}
