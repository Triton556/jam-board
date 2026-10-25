//! Provider metadata only. Neither response errors nor HTTP URLs escape this boundary.
use crate::profiles::Profile;
use crate::*;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

fn cache_path(dir: &Path, profile: &Profile) -> PathBuf {
    let id = &profile.id;
    let key = id
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    use std::hash::{Hash, Hasher};
    let mut fingerprint = std::collections::hash_map::DefaultHasher::new();
    profile.base_url.hash(&mut fingerprint);
    profile.preset.hash(&mut fingerprint);
    dir.join("agent-model-catalog")
        .join(format!("{key}-{:016x}.json", fingerprint.finish()))
}
pub(crate) fn fresh(c: &ModelCatalog) -> bool {
    c.fetched_at
        .as_deref()
        .and_then(|v| {
            time::OffsetDateTime::parse(v, &time::format_description::well_known::Rfc3339).ok()
        })
        .is_some_and(|t| {
            let age = time::OffsetDateTime::now_utc() - t;
            age >= time::Duration::ZERO && age < time::Duration::hours(24)
        })
}
pub(crate) fn cached(dir: &Path, profile: &Profile) -> Option<ModelCatalog> {
    serde_json::from_slice(&std::fs::read(cache_path(dir, profile)).ok()?).ok()
}
pub(crate) fn fallback_model(id: &str) -> ModelInfo {
    ModelInfo {
        id: id.into(),
        name: id.into(),
        context_length: None,
        input_image: false,
        reasoning: false,
        tools: true,
        prompt_price_per_m: None,
        completion_price_per_m: None,
    }
}
pub(crate) fn parse(v: Value, openrouter: bool) -> Result<Vec<ModelInfo>> {
    let rows = v["data"]
        .as_array()
        .ok_or_else(|| err("Invalid model catalog"))?;
    let models = rows
        .iter()
        .filter_map(|v| {
            let id = v["id"].as_str()?;
            let has = |key: &str, item: &str| {
                v[key]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(item)))
            };
            let price = |key: &str| {
                v["pricing"][key]
                    .as_str()
                    .and_then(|s| s.parse::<f64>().ok())
                    .filter(|n| n.is_finite() && *n >= 0.0)
                    .map(|n| (n * 1_000_000.0).to_string())
            };
            Some(ModelInfo {
                id: id.into(),
                name: v["name"].as_str().unwrap_or(id).into(),
                context_length: v["context_length"]
                    .as_u64()
                    .or_else(|| v["contextLength"].as_u64()),
                input_image: v["architecture"]["input_modalities"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|v| v == "image"))
                    || v["inputImage"] == true,
                reasoning: has("supported_parameters", "reasoning")
                    || has("supported_parameters", "reasoning_effort")
                    || v["reasoning"] == true,
                tools: if openrouter {
                    has("supported_parameters", "tools")
                } else {
                    v["tools"].as_bool().unwrap_or(true)
                },
                prompt_price_per_m: price("prompt"),
                completion_price_per_m: price("completion"),
            })
        })
        .collect::<Vec<_>>();
    if models.is_empty() {
        return Err(err("Empty model catalog"));
    }
    Ok(models)
}
pub(crate) async fn load(
    profiles: &Profiles,
    dir: &Path,
    input: AgentModelCatalogInput,
) -> Result<ModelCatalog> {
    let profile = profiles.get(&input.profile_id)?;
    let previous = cached(dir, &profile);
    if !input.refresh.unwrap_or(false)
        && let Some(c) = previous.as_ref().filter(|c| fresh(c))
    {
        return Ok(c.clone());
    }
    let key = profiles.api_key(&profile.id)?;
    use tracing::instrument::WithSubscriber;
    let result = fetch(&profile, key.as_deref())
        .with_subscriber(tracing::subscriber::NoSubscriber::default())
        .await;
    let mut catalog = match result {
        Ok(models) => ModelCatalog {
            models,
            source: CatalogSource::Provider,
            fetched_at: Some(crate::session::now()),
            error: None,
        },
        Err(()) => {
            let zai = profile.preset.as_deref() == Some("api-zai");
            let mut models = if zai {
                vec![fallback_model("glm-4.6"), fallback_model("glm-4.5")]
            } else {
                vec![]
            };
            if zai {
                for m in &mut models {
                    m.reasoning = true;
                }
            }
            if let Some(id) = &profile.model
                && !models.iter().any(|m| &m.id == id)
            {
                models.push(fallback_model(id));
            }
            for id in recents(dir, &profile.id) {
                if !models.iter().any(|m| m.id == id) {
                    models.push(fallback_model(&id));
                }
            }
            if let Some(c) = previous {
                for m in c.models {
                    if !models.iter().any(|v| v.id == m.id) {
                        models.push(m);
                    }
                }
            }
            ModelCatalog {
                models,
                source: if zai {
                    CatalogSource::Static
                } else {
                    CatalogSource::Profile
                },
                fetched_at: None,
                error: Some("Cannot load provider models; showing saved models".into()),
            }
        }
    };
    // Provider-controlled strings can echo a credential. Redact before returning or caching.
    if let Some(key) = key.filter(|s| !s.is_empty()) {
        let mut json = serde_json::to_value(&catalog)?;
        redact(&mut json, &key);
        catalog = serde_json::from_value(json)?;
    }
    if catalog.error.is_none() {
        let path = cache_path(dir, &profile);
        std::fs::create_dir_all(path.parent().expect("cache parent"))?;
        std::fs::write(path, serde_json::to_vec(&catalog)?)?;
    }
    Ok(catalog)
}
async fn fetch(p: &Profile, key: Option<&str>) -> std::result::Result<Vec<ModelInfo>, ()> {
    let key = key.filter(|s| !s.is_empty());
    if p.preset.as_deref() != Some("api-openrouter") && key.is_none() {
        return Err(());
    }
    let base = p.base_url.as_deref().ok_or(())?;
    let url =
        reqwest::Url::parse(&format!("{}/models", base.trim_end_matches('/'))).map_err(|_| ())?;
    if !["http", "https"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| ())?;
    let mut request = client.get(url);
    if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| ())?
        .error_for_status()
        .map_err(|_| ())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
            return Err(());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| ())?;
    let mut models =
        parse(value.clone(), p.preset.as_deref() == Some("api-openrouter")).map_err(|_| ())?;
    // z.ai's basic /models response can omit capabilities. Keep the same short
    // known-model metadata as the offline fallback; explicit provider flags win.
    if p.preset.as_deref() == Some("api-zai") {
        for model in &mut models {
            let row = value["data"]
                .as_array()
                .and_then(|rows| rows.iter().find(|row| row["id"] == model.id));
            if ["glm-4.6", "glm-4.5"].contains(&model.id.as_str())
                && row.is_some_and(|v| {
                    v.get("reasoning").is_none() && v.get("supported_parameters").is_none()
                })
            {
                model.reasoning = true;
            }
        }
    }
    Ok(models)
}

fn redact(v: &mut Value, key: &str) {
    match v {
        Value::String(s) => *s = s.replace(key, "[REDACTED]"),
        Value::Array(a) => {
            for v in a {
                redact(v, key);
            }
        }
        Value::Object(o) => {
            for v in o.values_mut() {
                redact(v, key);
            }
        }
        _ => {}
    }
}

fn recents_path(dir: &Path, id: &str) -> PathBuf {
    let id = id
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    dir.join("agent-model-catalog")
        .join(format!("{id}-recent.json"))
}
fn recents(dir: &Path, id: &str) -> Vec<String> {
    std::fs::read(recents_path(dir, id))
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or_default()
}
pub(crate) fn remember(dir: &Path, id: &str, model: &str) -> Result<()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = LOCK
        .lock()
        .map_err(|_| err("Model history lock unavailable"))?;
    let mut models = recents(dir, id);
    models.retain(|m| m != model);
    models.insert(0, model.into());
    models.truncate(16);
    let path = recents_path(dir, id);
    std::fs::create_dir_all(path.parent().expect("model history parent"))?;
    std::fs::write(path, serde_json::to_vec(&models)?)?;
    Ok(())
}
