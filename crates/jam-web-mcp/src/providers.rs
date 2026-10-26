use crate::{config::Provider, http};
use anyhow::{Result, bail};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SearchKind {
    Web,
    Images,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u64>,
    pub source: String,
}
pub fn validate_search(query: &str, count: u8) -> Result<()> {
    if query.trim().is_empty() || query.len() > 4096 {
        bail!("Enter a search query of 1 to 4096 bytes");
    }
    if !(1..=20).contains(&count) {
        bail!("Search count must be between 1 and 20");
    }
    Ok(())
}
#[async_trait]
pub trait SearchProvider: Send + Sync {
    async fn search(&self, query: &str, kind: SearchKind, count: u8) -> Result<Vec<SearchResult>>;
}
/// A settings probe spends one basic web query and never downloads a result.
pub async fn test_connection(provider: &dyn SearchProvider) -> Result<()> {
    provider.search("Jam Board", SearchKind::Web, 1).await?;
    Ok(())
}
struct Brave {
    key: String,
}
struct Tavily {
    key: String,
}
pub fn provider(provider: Provider, key: String) -> Arc<dyn SearchProvider> {
    match provider {
        Provider::Brave => Arc::new(Brave { key }),
        Provider::Tavily => Arc::new(Tavily { key }),
    }
}
#[async_trait]
impl SearchProvider for Brave {
    async fn search(&self, query: &str, kind: SearchKind, count: u8) -> Result<Vec<SearchResult>> {
        validate_search(query, count)?;
        let mut url = reqwest::Url::parse(match kind {
            SearchKind::Web => "https://api.search.brave.com/res/v1/web/search",
            SearchKind::Images => "https://api.search.brave.com/res/v1/images/search",
        })?;
        url.query_pairs_mut()
            .append_pair("q", query)
            .append_pair("count", &count.to_string());
        parse_brave(
            &http::provider_request(url, &self.key, None).await?,
            kind,
            count,
        )
    }
}
#[async_trait]
impl SearchProvider for Tavily {
    async fn search(&self, query: &str, kind: SearchKind, count: u8) -> Result<Vec<SearchResult>> {
        validate_search(query, count)?;
        let images = matches!(kind, SearchKind::Images);
        let body = serde_json::json!({"query":query,"max_results":count,"search_depth":"basic","include_images":images,"include_image_descriptions":images,"include_answer":false,"include_raw_content":false});
        parse_tavily(
            &http::provider_request(
                reqwest::Url::parse("https://api.tavily.com/search")?,
                &self.key,
                Some(body),
            )
            .await?,
            kind,
            count,
        )
    }
}
fn field(v: &Value, key: &str) -> Option<String> {
    v.get(key)?.as_str().map(str::to_owned)
}
fn web_url(s: Option<String>) -> Option<String> {
    s.filter(|s| reqwest::Url::parse(s).is_ok_and(|u| http::validate_url(&u).is_ok()))
}
pub fn parse_brave(value: &Value, kind: SearchKind, count: u8) -> Result<Vec<SearchResult>> {
    let images = matches!(kind, SearchKind::Images);
    let rows = if images {
        value.get("results")
    } else {
        value.pointer("/web/results")
    };
    // Brave omits web when there are no matching results.
    let Some(rows) = rows else {
        if !images && value.get("query").is_some() {
            return Ok(Vec::new());
        }
        bail!("Brave returned an invalid search response");
    };
    let rows = rows
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("Brave returned an invalid search response"))?;
    Ok(rows
        .iter()
        .filter_map(|v| {
            let url = web_url(field(v, "url"))?;
            Some(SearchResult {
                title: field(v, "title").unwrap_or_else(|| url.clone()),
                url,
                snippet: field(v, "description"),
                image_url: if images {
                    web_url(
                        v.pointer("/properties/url")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                    )
                } else {
                    None
                },
                thumbnail_url: if images {
                    web_url(
                        v.pointer("/thumbnail/src")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                    )
                } else {
                    None
                },
                width: if images {
                    v.pointer("/properties/width").and_then(Value::as_u64)
                } else {
                    None
                },
                height: if images {
                    v.pointer("/properties/height").and_then(Value::as_u64)
                } else {
                    None
                },
                source: "brave".into(),
            })
        })
        .take(count as usize)
        .collect())
}
pub fn parse_tavily(value: &Value, kind: SearchKind, count: u8) -> Result<Vec<SearchResult>> {
    let images = matches!(kind, SearchKind::Images);
    let rows = value
        .get(if images { "images" } else { "results" })
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("Tavily returned an invalid search response"))?;
    Ok(rows
        .iter()
        .filter_map(|v| {
            let url = web_url(if v.is_string() {
                v.as_str().map(str::to_owned)
            } else {
                field(v, "url")
            })?;
            let title = field(v, "title")
                .or_else(|| field(v, "description"))
                .unwrap_or_else(|| url.clone());
            Some(SearchResult {
                title,
                url: url.clone(),
                snippet: field(v, if images { "description" } else { "content" }),
                image_url: images.then_some(url),
                thumbnail_url: None,
                width: None,
                height: None,
                source: "tavily".into(),
            })
        })
        .take(count as usize)
        .collect())
}
