use crate::*;
use reqwest::header::{CONTENT_RANGE, ETAG, IF_RANGE, RANGE};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

#[derive(Clone)]
pub(crate) struct Sources {
    pub release: String,
    pub models: String,
}
impl Default for Sources {
    fn default() -> Self {
        Self {
            release: format!("{}/{}", whisper::RELEASE_API, WHISPER_RELEASE.0),
            models: whisper::MODEL_URL.into(),
        }
    }
}
#[derive(Deserialize)]
struct Release {
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct PartialMetadata {
    url: String,
    validator: Option<String>,
    digest: Option<String>,
}

pub(crate) fn sha256(value: &str) -> Option<String> {
    let value = value
        .trim_matches('"')
        .strip_prefix("sha256:")
        .unwrap_or(value.trim_matches('"'));
    (value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()))
        .then(|| value.to_ascii_lowercase())
}
fn matches_asset(name: &str, gpu: bool) -> bool {
    if !gpu {
        return name == WHISPER_RELEASE.1;
    }
    let (start, end) = WHISPER_RELEASE.2.split_once('*').unwrap();
    name.starts_with(start) && name.ends_with(end)
}

impl LocalWhisper {
    pub(crate) async fn install_files(&self, model: VoiceModel, device: VoiceDevice) -> Result<()> {
        let device = device.effective(self.inner.gpu);
        let gpu = device == VoiceDevice::Gpu;
        if gpu && !self.inner.gpu {
            return Err(err("An NVIDIA driver is required for GPU voice input"));
        }
        let runtime = self.runtime_dir(device);
        if find_server(&runtime).is_none() {
            let response = self
                .cancelable(self.inner.client.get(&self.inner.sources.release).send())
                .await??
                .error_for_status()?;
            let release: Release = self.cancelable(response.json()).await??;
            self.check_cancel()?;
            let asset = release
                .assets
                .into_iter()
                .filter(|a| matches_asset(&a.name, gpu))
                .min_by(|a, b| a.name.cmp(&b.name))
                .ok_or_else(|| err("Pinned whisper.cpp runtime asset was not found"))?;
            let archive = self.inner.root.join(if gpu {
                "runtime-gpu.zip"
            } else {
                "runtime-cpu.zip"
            });
            self.download(
                &asset.browser_download_url,
                &archive,
                asset.digest.as_deref().and_then(sha256),
                InstallPhase::Runtime,
            )
            .await?;
            let staging = runtime.with_file_name(format!(
                "{}.staging",
                runtime.file_name().unwrap().to_string_lossy()
            ));
            let archive_copy = archive.clone();
            let staging_copy = staging.clone();
            tokio::task::spawn_blocking(move || extract(&archive_copy, &staging_copy)).await??;
            self.check_cancel()?;
            if find_server(&staging).is_none() {
                return Err(err("Runtime archive does not contain whisper-server"));
            }
            if runtime.exists() {
                std::fs::remove_dir_all(&runtime)?;
            }
            std::fs::create_dir_all(runtime.parent().unwrap())?;
            std::fs::rename(&staging, &runtime)?;
            std::fs::remove_file(archive)?;
        }
        let path = self.model_path(model);
        if !path.is_file() {
            let url = format!("{}/{}", self.inner.sources.models, model.file());
            // HF puts X-Linked-Etag on the redirect, before the CDN response.
            let head_client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(30))
                .user_agent("JamBoard-Voice")
                .build()?;
            let head = self.cancelable(head_client.head(&url).send()).await??;
            let digest = head
                .headers()
                .get("x-linked-etag")
                .and_then(|h| h.to_str().ok())
                .and_then(sha256);
            self.download(&url, &path, digest, InstallPhase::Model)
                .await?;
        }
        Ok(())
    }

    pub(crate) fn check_cancel(&self) -> Result<()> {
        if self.inner.cancel.load(Ordering::SeqCst) || self.inner.closed.load(Ordering::SeqCst) {
            Err(err("Voice installation cancelled"))
        } else {
            Ok(())
        }
    }
    async fn cancelable<F: std::future::Future>(&self, future: F) -> Result<F::Output> {
        // Register before checking the flag to avoid losing a notification.
        let notified = self.inner.cancel_notify.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        self.check_cancel()?;
        tokio::select! {
            result = future => Ok(result),
            _ = notified => Err(err("Voice installation cancelled")),
        }
    }
    pub(crate) async fn download(
        &self,
        url: &str,
        target: &Path,
        digest: Option<String>,
        phase: InstallPhase,
    ) -> Result<()> {
        let part = target.with_extension("part");
        let metadata = target.with_extension("part.json");
        std::fs::create_dir_all(target.parent().unwrap())?;
        let old: PartialMetadata = std::fs::read(&metadata)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let mut offset = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        if old.url != url || old.digest != digest || (old.validator.is_none() && digest.is_none()) {
            offset = 0;
        }
        let mut request = self.inner.client.get(url);
        if offset > 0 {
            request = request.header(RANGE, format!("bytes={offset}-"));
            if let Some(value) = &old.validator {
                request = request.header(IF_RANGE, value);
            }
        }
        let mut response = self.cancelable(request.send()).await??;
        // A complete partial file or a changed upstream resource: retry from zero.
        if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            offset = 0;
            response = self.cancelable(self.inner.client.get(url).send()).await??;
        }
        let response = response.error_for_status()?;
        let mut response = response;
        let total = if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            let header = response
                .headers()
                .get(CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| err("Missing Content-Range in resumed download"))?;
            let (range, total) = header
                .strip_prefix("bytes ")
                .and_then(|s| s.split_once('/'))
                .ok_or_else(|| err("Invalid Content-Range"))?;
            let (start, end) = range
                .split_once('-')
                .ok_or_else(|| err("Invalid Content-Range"))?;
            let start: u64 = start.parse()?;
            let end: u64 = end.parse()?;
            let total: u64 = total.parse()?;
            if start != offset
                || end < start
                || end >= total
                || response
                    .content_length()
                    .is_some_and(|n| n != end - start + 1)
            {
                return Err(err("Server returned an inconsistent download range"));
            }
            Some(total)
        } else {
            offset = 0;
            response.content_length()
        };
        let validator = response
            .headers()
            .get(ETAG)
            .or_else(|| response.headers().get("last-modified"))
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.starts_with("W/"))
            .map(str::to_owned);
        let effective_digest = digest.clone().or_else(|| {
            response
                .headers()
                .get("x-linked-etag")
                .and_then(|h| h.to_str().ok())
                .and_then(sha256)
        });
        std::fs::write(
            &metadata,
            serde_json::to_vec(&PartialMetadata {
                url: url.into(),
                validator,
                digest,
            })?,
        )?;
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(offset == 0)
            .append(offset > 0)
            .open(&part)
            .await?;
        let mut received = offset;
        (self.inner.progress)(VoiceInstallProgress {
            phase: phase.clone(),
            received,
            total,
        });
        let transfer: Result<()> = async {
            while let Some(chunk) = self.cancelable(response.chunk()).await?? {
                file.write_all(&chunk).await?;
                received += chunk.len() as u64;
                (self.inner.progress)(VoiceInstallProgress {
                    phase: phase.clone(),
                    received,
                    total,
                });
            }
            Ok(())
        }
        .await;
        // Drain pending Tokio file writes even on explicit cancellation before a
        // subsequent install reads the partial file's length for HTTP Range.
        let flushed = file.flush().await;
        if transfer.is_ok() {
            flushed?;
            file.sync_all().await?;
        }
        drop(file);
        transfer?;
        self.check_cancel()?;
        if received == 0 || total.is_some_and(|t| received != t) {
            return Err(err("Incomplete voice download"));
        }
        if let Some(expected) = effective_digest {
            let path = part.clone();
            let actual = tokio::task::spawn_blocking(move || -> Result<String> {
                use std::io::Read;
                let mut file = std::fs::File::open(path)?;
                let mut hasher = Sha256::new();
                let mut buffer = [0u8; 65_536];
                loop {
                    let n = file.read(&mut buffer)?;
                    if n == 0 {
                        break;
                    }
                    hasher.update(&buffer[..n]);
                }
                Ok(format!("{:x}", hasher.finalize()))
            })
            .await??;
            if actual != expected {
                std::fs::remove_file(&part)?;
                let _ = std::fs::remove_file(&metadata);
                return Err(err("SHA-256 mismatch in voice download"));
            }
        }
        self.check_cancel()?;
        std::fs::rename(&part, target)?;
        let _ = std::fs::remove_file(metadata);
        Ok(())
    }
}

fn tar() -> std::process::Command {
    #[cfg(windows)]
    let exe = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
        .join("System32/tar.exe");
    #[cfg(not(windows))]
    let exe = PathBuf::from("tar");
    let mut cmd = std::process::Command::new(exe);
    hide(&mut cmd);
    cmd
}
fn extract(archive: &Path, staging: &Path) -> Result<()> {
    // Never allow absolute paths, traversal or links from a downloaded archive.
    let names = tar().arg("-tf").arg(archive).output()?;
    let details = tar().arg("-tvf").arg(archive).output()?;
    if !names.status.success() || !details.status.success() {
        return Err(err("Cannot inspect whisper.cpp archive"));
    }
    for name in String::from_utf8(names.stdout)?.lines() {
        if name.starts_with(['/', '\\'])
            || name.contains(':')
            || name.split(['/', '\\']).any(|p| p == "..")
        {
            return Err(err("Unsafe path in whisper.cpp archive"));
        }
    }
    if String::from_utf8_lossy(&details.stdout)
        .lines()
        .any(|line| !line.starts_with(['-', 'd']))
    {
        return Err(err("Links are not allowed in whisper.cpp archive"));
    }
    if staging.exists() {
        std::fs::remove_dir_all(staging)?;
    }
    std::fs::create_dir_all(staging)?;
    if !tar()
        .arg("-xf")
        .arg(archive)
        .arg("-C")
        .arg(staging)
        .status()?
        .success()
    {
        return Err(err("Cannot extract whisper.cpp runtime"));
    }
    Ok(())
}
