//! Windows Job ownership ties the sidecar and its descendants to the app.
//! No shell or additional dependency is needed.
use crate::{Result, err};

#[cfg(windows)]
mod windows {
    use super::*;
    use std::ffi::c_void;
    type Handle = *mut c_void;
    #[repr(C)]
    #[derive(Default)]
    struct BasicLimits {
        process_time: i64,
        job_time: i64,
        flags: u32,
        minimum_working_set: usize,
        maximum_working_set: usize,
        active_processes: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimits {
        basic: BasicLimits,
        io: [u64; 6],
        process_memory: usize,
        job_memory: usize,
        peak_process_memory: usize,
        peak_job_memory: usize,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: i32, info: *const c_void, size: u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
        fn TerminateJobObject(job: Handle, exit_code: u32) -> i32;
    }
    pub(crate) struct ProcessTree(usize);
    impl ProcessTree {
        pub fn attach(pid: u32) -> Result<Self> {
            // SAFETY: ABI layouts above match JOBOBJECT_EXTENDED_LIMIT_INFORMATION;
            // handles are private, non-inheritable and closed on every branch.
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Err(err("Cannot create voice process job"));
                }
                let mut limits = ExtendedLimits::default();
                limits.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE
                if SetInformationJobObject(
                    job,
                    9,
                    &limits as *const _ as *const c_void,
                    std::mem::size_of::<ExtendedLimits>() as u32,
                ) == 0
                {
                    CloseHandle(job);
                    return Err(err("Cannot configure voice process job"));
                }
                let process = OpenProcess(0x0100 | 0x0001, 0, pid); // SET_QUOTA | TERMINATE
                if process.is_null() {
                    CloseHandle(job);
                    return Err(err("Cannot access voice process for job ownership"));
                }
                let assigned = AssignProcessToJobObject(job, process);
                CloseHandle(process);
                if assigned == 0 {
                    CloseHandle(job);
                    return Err(err("Cannot assign voice process tree to voice job"));
                }
                Ok(Self(job as usize))
            }
        }
        pub fn terminate(&self) -> Result<()> {
            // SAFETY: this handle is owned until Drop and has not been closed.
            if unsafe { TerminateJobObject(self.0 as Handle, 1) } == 0 {
                return Err(err("Cannot stop voice process job"));
            }
            Ok(())
        }
    }
    impl Drop for ProcessTree {
        fn drop(&mut self) {
            // SAFETY: exactly one owner closes the job; KILL_ON_JOB_CLOSE cleans
            // descendants even if the transport task unwinds or is cancelled.
            unsafe {
                CloseHandle(self.0 as Handle);
            }
        }
    }
}
#[cfg(windows)]
pub(crate) use windows::ProcessTree;
#[cfg(not(windows))]
pub(crate) struct ProcessTree;
#[cfg(not(windows))]
impl ProcessTree {
    pub fn attach(_: u32) -> Result<Self> {
        Ok(Self)
    }
    pub fn terminate(&self) -> Result<()> {
        Ok(())
    }
}

use crate::{VoiceDevice, whisper};
use std::{
    path::Path,
    process::{Child, Command, Stdio},
};

pub(crate) fn hide(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = command;
}
pub(crate) fn gpu_available() -> bool {
    #[cfg(windows)]
    if std::path::PathBuf::from(
        std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
    )
    .join("System32/nvcuda.dll")
    .is_file()
    {
        return true;
    }
    let mut command = Command::new("nvidia-smi");
    hide(&mut command);
    command
        .arg("-L")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

pub(crate) fn physical_cores() -> usize {
    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetLogicalProcessorInformationEx(
                relationship: u32,
                buffer: *mut std::ffi::c_void,
                length: *mut u32,
            ) -> i32;
        }
        let mut bytes = 0u32;
        // SAFETY: the first call obtains the required length. The second uses
        // an aligned buffer of that size; each variable-length record is bounded.
        unsafe {
            GetLogicalProcessorInformationEx(0, std::ptr::null_mut(), &mut bytes);
            if bytes > 0 {
                let mut buffer =
                    vec![0usize; (bytes as usize).div_ceil(std::mem::size_of::<usize>())];
                if GetLogicalProcessorInformationEx(0, buffer.as_mut_ptr().cast(), &mut bytes) != 0
                {
                    let data =
                        std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), bytes as usize);
                    return count_physical_cores(data).unwrap_or(1);
                }
            }
        }
    }
    // Conservatively avoid treating SMT logical processors as physical cores.
    1
}
#[cfg(any(windows, test))]
pub(crate) fn count_physical_cores(data: &[u8]) -> Option<usize> {
    let mut offset = 0;
    let mut count = 0;
    while offset < data.len() {
        let header = data.get(offset..offset + 8)?;
        let relation = u32::from_le_bytes(header[..4].try_into().ok()?);
        let length = u32::from_le_bytes(header[4..].try_into().ok()?) as usize;
        if length < 8 || length > data.len() - offset {
            return None;
        }
        if relation == 0 {
            count += 1;
        }
        offset += length;
    }
    (count > 0).then_some(count)
}
pub(crate) struct Server {
    pub(crate) child: Child,
    tree: ProcessTree,
    pub(crate) port: u16,
}
impl Server {
    pub fn spawn(
        executable: &Path,
        model: &Path,
        device: VoiceDevice,
        physical_cores: usize,
        #[cfg(test)] fixture: bool,
    ) -> Result<Self> {
        let listener = std::net::TcpListener::bind((whisper::HOST, 0))?;
        let port = listener.local_addr()?.port();
        let mut command = Command::new(executable);
        #[cfg(test)]
        if fixture {
            command = Command::new(std::env::current_exe()?);
            command
                .args([
                    "--exact",
                    "tests::sidecar_fixture",
                    "--ignored",
                    "--nocapture",
                ])
                .env("JAM_VOICE_TEST_PORT", port.to_string());
        }
        #[cfg(test)]
        let real = !fixture;
        #[cfg(not(test))]
        let real = true;
        if real {
            command.args(whisper::server_arguments(
                model,
                port,
                device,
                physical_cores,
            ));
        }
        command
            .current_dir(executable.parent().unwrap())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide(&mut command);
        drop(listener);
        let mut child = command.spawn()?;
        match ProcessTree::attach(child.id()) {
            Ok(tree) => Ok(Self { child, tree, port }),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(error)
            }
        }
    }
    pub fn alive(&mut self) -> Result<bool> {
        Ok(self.child.try_wait()?.is_none())
    }
    pub fn url(&self) -> String {
        format!("http://{}:{}", whisper::HOST, self.port)
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.tree.terminate();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
