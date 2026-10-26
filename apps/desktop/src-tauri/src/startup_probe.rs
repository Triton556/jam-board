//! Opt-in local startup measurement. Never reads or writes a normal installation.
use std::{
    fs::OpenOptions,
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::Manager;

pub struct StartupProbe {
    started: Instant,
    epoch_ms: f64,
    output: PathBuf,
    exit: bool,
    window_ms: Mutex<Option<f64>>,
    written: Mutex<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Sample<'a> {
    process_to_window_ms: f64,
    process_to_first_paint_ms: f64,
    route: &'a str,
    version: &'a str,
}

impl StartupProbe {
    pub fn from_env() -> Option<Self> {
        Self::from_lookup(|key| std::env::var_os(key))
    }

    fn from_lookup(mut lookup: impl FnMut(&str) -> Option<std::ffi::OsString>) -> Option<Self> {
        if lookup("JAM_BOARD_STARTUP_PROBE").as_deref() != Some(std::ffi::OsStr::new("1")) {
            return None;
        }
        let started = Instant::now();
        let epoch_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_secs_f64()
            * 1000.0;
        Some(Self {
            started,
            epoch_ms,
            output: lookup("JAM_BOARD_STARTUP_OUT")?.into(),
            exit: lookup("JAM_BOARD_STARTUP_EXIT").as_deref() == Some(std::ffi::OsStr::new("1")),
            window_ms: Mutex::new(None),
            written: Mutex::new(false),
        })
    }

    pub fn window_created(&self) {
        *self.window_ms.lock().expect("startup window lock") =
            Some(self.started.elapsed().as_secs_f64() * 1000.0);
    }

    fn write(&self, route: &str, paint_epoch_ms: f64, version: &str) -> Result<(), String> {
        let mut written = self.written.lock().map_err(|e| e.to_string())?;
        if *written {
            return Ok(());
        }
        let window_ms = self
            .window_ms
            .lock()
            .map_err(|e| e.to_string())?
            .ok_or("Window not created")?;
        let paint_ms = paint_epoch_ms - self.epoch_ms;
        if !matches!(route, "/board" | "/welcome" | "/plan")
            || !paint_ms.is_finite()
            || paint_ms < window_ms
        {
            return Err("Invalid startup paint receipt".into());
        }
        let sample = Sample {
            process_to_window_ms: window_ms,
            process_to_first_paint_ms: paint_ms,
            route,
            version,
        };
        let mut line = serde_json::to_vec(&sample).map_err(|e| e.to_string())?;
        line.push(b'\n');
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.output)
            .and_then(|mut file| file.write_all(&line))
            .map_err(|e| e.to_string())?;
        *written = true;
        Ok(())
    }
}

#[tauri::command]
pub fn startup_first_paint(
    app: tauri::AppHandle,
    route: String,
    paint_epoch_ms: f64,
) -> Result<(), String> {
    let Some(probe) = app.try_state::<StartupProbe>() else {
        return Ok(());
    };
    probe.write(
        &route,
        paint_epoch_ms,
        &app.package_info().version.to_string(),
    )?;
    if probe.exit {
        app.exit(0);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_probe_does_not_even_read_output_or_exit_configuration() {
        for value in [None, Some("0"), Some("true")] {
            let mut reads = Vec::new();
            let probe = StartupProbe::from_lookup(|key| {
                reads.push(key.to_owned());
                assert_eq!(key, "JAM_BOARD_STARTUP_PROBE");
                value.map(std::ffi::OsString::from)
            });
            assert!(probe.is_none());
            assert_eq!(reads, ["JAM_BOARD_STARTUP_PROBE"]);
        }
    }

    #[test]
    fn receipt_is_one_json_line_with_expected_shape() {
        let directory =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../test-visuals/round6/w6");
        std::fs::create_dir_all(&directory).unwrap();
        let output = directory.join(format!("jam-startup-{}.jsonl", std::process::id()));
        let probe = StartupProbe {
            started: Instant::now(),
            epoch_ms: 1000.0,
            output: output.clone(),
            exit: false,
            window_ms: Mutex::new(Some(12.0)),
            written: Mutex::new(false),
        };
        let _ = std::fs::remove_file(&output);
        assert!(probe.write("/board", 1010.0, "test").is_err());
        assert!(!output.exists());
        probe.write("/board", 1042.0, "test").unwrap();
        probe.write("/welcome", 1099.0, "test").unwrap();
        let data = std::fs::read_to_string(&output).unwrap();
        assert_eq!(data.lines().count(), 1);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&data).unwrap(),
            serde_json::json!({"processToWindowMs":12.0,"processToFirstPaintMs":42.0,"route":"/board","version":"test"})
        );
        std::fs::remove_file(output).unwrap();
    }
}
