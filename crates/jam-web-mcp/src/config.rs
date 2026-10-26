//! Non-secret settings on disk; keys are read only for the selected child.
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Brave,
    Tavily,
}
impl Provider {
    pub fn name(self) -> &'static str {
        match self {
            Self::Brave => "brave",
            Self::Tavily => "tavily",
        }
    }
    pub fn key_env(self) -> &'static str {
        match self {
            Self::Brave => "BRAVE_API_KEY",
            Self::Tavily => "TAVILY_API_KEY",
        }
    }
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "brave" => Ok(Self::Brave),
            "tavily" => Ok(Self::Tavily),
            _ => bail!("Choose Brave or Tavily as the web search provider"),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebSearchSettingsInput {
    pub provider: Option<Provider>,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchSettings {
    pub provider: Option<Provider>,
    pub key_set: bool,
}

pub trait Credentials: Send + Sync {
    fn get(&self, provider: Provider) -> Result<Option<String>>;
    fn set(&self, provider: Provider, key: &str) -> Result<()>;
    fn clear(&self, provider: Provider) -> Result<()>;
}
pub struct OsCredentials;
fn entry(provider: Provider) -> Result<keyring::Entry> {
    keyring::Entry::new(
        "dev.triton556.jamboard",
        &format!("web:{}:API_KEY", provider.name()),
    )
    .map_err(|_| anyhow::anyhow!("OS credential store is unavailable"))
}
impl Credentials for OsCredentials {
    fn get(&self, provider: Provider) -> Result<Option<String>> {
        match entry(provider)?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => bail!("Cannot read web search key from the OS credential store"),
        }
    }
    fn set(&self, provider: Provider, key: &str) -> Result<()> {
        entry(provider)?
            .set_password(key)
            .map_err(|_| anyhow::anyhow!("Cannot save web search key in the OS credential store"))
    }
    fn clear(&self, provider: Provider) -> Result<()> {
        match entry(provider)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => bail!("Cannot clear web search key from the OS credential store"),
        }
    }
}

pub struct WebConfig {
    data_dir: PathBuf,
    credentials: Arc<dyn Credentials>,
    lock: Mutex<()>,
}
impl WebConfig {
    pub fn new(data_dir: &Path) -> Self {
        Self::with_credentials(data_dir, Arc::new(OsCredentials))
    }
    pub fn with_credentials(data_dir: &Path, credentials: Arc<dyn Credentials>) -> Self {
        Self {
            data_dir: data_dir.into(),
            credentials,
            lock: Mutex::new(()),
        }
    }
    fn load(&self) -> Result<WebSearchSettingsInput> {
        match std::fs::read(self.data_dir.join("web/settings.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|_| anyhow::anyhow!("Web search settings could not be read")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Default::default()),
            Err(_) => bail!("Web search settings could not be read"),
        }
    }
    pub fn settings(&self) -> Result<WebSearchSettings> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Web search settings are busy"))?;
        self.view(self.load()?.provider)
    }
    fn view(&self, provider: Option<Provider>) -> Result<WebSearchSettings> {
        let key_set = match provider {
            Some(p) => self
                .credentials
                .get(p)?
                .is_some_and(|k| !k.trim().is_empty()),
            None => false,
        };
        Ok(WebSearchSettings { provider, key_set })
    }
    pub fn save(&self, input: WebSearchSettingsInput) -> Result<WebSearchSettings> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Web search settings are busy"))?;
        let view = self.view(input.provider)?;
        let dir = self.data_dir.join("web");
        std::fs::create_dir_all(&dir)
            .map_err(|_| anyhow::anyhow!("Cannot create web search settings directory"))?;
        let mut file = tempfile::NamedTempFile::new_in(&dir)?;
        file.write_all(&serde_json::to_vec_pretty(&input)?)?;
        file.as_file().sync_all()?;
        file.persist(dir.join("settings.json"))
            .map_err(|_| anyhow::anyhow!("Cannot save web search settings"))?;
        Ok(view)
    }
    pub fn set_key(&self, provider: Provider, key: &str) -> Result<()> {
        let key = key.trim();
        if key.is_empty() {
            bail!("Enter a web search API key");
        }
        if key.len() > 8192 || key.chars().any(char::is_control) {
            bail!("Web search API key contains invalid characters");
        }
        self.credentials.set(provider, key)
    }
    pub fn clear_key(&self, provider: Provider) -> Result<()> {
        self.credentials.clear(provider)
    }
    pub fn search_provider(&self) -> Result<Arc<dyn crate::providers::SearchProvider>> {
        let provider = self
            .load()?
            .provider
            .ok_or_else(|| anyhow::anyhow!("Choose a web search provider in Settings"))?;
        let key = self
            .credentials
            .get(provider)?
            .filter(|k| !k.trim().is_empty())
            .ok_or_else(|| anyhow::anyhow!("Set the web search API key in Settings"))?;
        Ok(crate::providers::provider(provider, key))
    }
    pub fn sidecar_env(&self, project_id: &str) -> Result<Vec<(String, String)>> {
        if project_id.is_empty()
            || project_id.len() > 128
            || !project_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            bail!("Invalid project ID for web downloads");
        }
        let _guard = self
            .lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Web search settings are busy"))?;
        let provider = self.load()?.provider;
        // Clear inherited provider secrets as well as supplying the selected key.
        let mut env = vec![
            (
                "JAM_WEB_PROVIDER".into(),
                provider.map(|p| p.name()).unwrap_or("").into(),
            ),
            ("BRAVE_API_KEY".into(), String::new()),
            ("TAVILY_API_KEY".into(), String::new()),
            (
                "JAM_WEB_DOWNLOAD_DIR".into(),
                std::path::absolute(self.data_dir.join("web-downloads").join(project_id))?
                    .to_str()
                    .ok_or_else(|| anyhow::anyhow!("Web download path is not valid Unicode"))?
                    .into(),
            ),
        ];
        if let Some(provider) = provider {
            let key = self.credentials.get(provider)?.unwrap_or_default();
            env.iter_mut()
                .find(|(k, _)| k == provider.key_env())
                .unwrap()
                .1 = key;
        }
        Ok(env)
    }
}
pub fn sidecar_env(data_dir: &Path, project_id: &str) -> Result<Vec<(String, String)>> {
    WebConfig::new(data_dir).sidecar_env(project_id)
}
