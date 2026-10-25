//! Best-effort upstream compatibility settings. QA can correct release assets,
//! executable names, server flags and HTTP protocol fields together here.
pub const WHISPER_RELEASE: (&str, &str, &str) = (
    "v1.9.2",
    "whisper-bin-x64.zip",
    "whisper-cublas-12*-bin-x64.zip",
);
pub(crate) const RELEASE_API: &str =
    "https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags";
pub(crate) const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
pub(crate) const EXECUTABLES: &[&str] = &["whisper-server.exe", "whisper-server"];
pub(crate) const HOST: &str = "127.0.0.1";
pub(crate) const MODEL_FLAG: &str = "--model";
pub(crate) const HOST_FLAG: &str = "--host";
pub(crate) const PORT_FLAG: &str = "--port";
pub(crate) const CPU_FLAG: &str = "--no-gpu";
pub(crate) const THREADS_FLAG: &str = "-t";
pub(crate) const FLASH_FLAG: &str = "-fa";
pub(crate) const HEALTH_ENDPOINT: &str = "/health";
pub(crate) const INFERENCE_ENDPOINT: &str = "/inference";
pub(crate) const LANGUAGE_FIELD: &str = "language";
pub(crate) const PROMPT_FIELD: &str = "prompt";
pub(crate) const FORMAT_FIELD: &str = "response_format";
pub(crate) const AUDIO_FIELD: &str = "file";

pub(crate) fn server_arguments(
    model: &std::path::Path,
    port: u16,
    device: crate::VoiceDevice,
    physical_cores: usize,
) -> Vec<std::ffi::OsString> {
    let gpu = device == crate::VoiceDevice::Gpu;
    let threads = if gpu { 4 } else { physical_cores.clamp(1, 8) };
    let mut args = vec![
        MODEL_FLAG.into(),
        model.as_os_str().to_owned(),
        HOST_FLAG.into(),
        HOST.into(),
        PORT_FLAG.into(),
        port.to_string().into(),
        THREADS_FLAG.into(),
        threads.to_string().into(),
        FLASH_FLAG.into(),
    ];
    if !gpu {
        args.push(CPU_FLAG.into());
    }
    args
}
