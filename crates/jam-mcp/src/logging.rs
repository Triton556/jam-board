use std::{
    fs::OpenOptions,
    io::{self, Write},
    path::Path,
    sync::{Arc, Mutex},
};
#[derive(Clone)]
struct LogWriter(Arc<Mutex<std::fs::File>>);
impl Write for LogWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        io::stderr().write_all(buf)?;
        self.0
            .lock()
            .map_err(|_| io::Error::other("log lock poisoned"))?
            .write_all(buf)?;
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        io::stderr().flush()?;
        self.0
            .lock()
            .map_err(|_| io::Error::other("log lock poisoned"))?
            .flush()
    }
}
pub fn init_logging(data_dir: &Path, name: &str) -> io::Result<()> {
    std::fs::create_dir_all(data_dir.join("logs"))?;
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("logs").join(format!("{name}.log")))?;
    let writer = LogWriter(Arc::new(Mutex::new(file)));
    tracing_subscriber::fmt()
        .with_ansi(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with_writer(move || writer.clone())
        .try_init()
        .map_err(io::Error::other)
}
