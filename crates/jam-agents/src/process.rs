//! Windows job ownership complements taskkill: descendants still belong to the
//! dock after an npx wrapper exits. No shell or additional dependency is needed.
use crate::*;

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
                    return Err(err("Cannot create agent process job"));
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
                    return Err(err("Cannot configure agent process job"));
                }
                let process = OpenProcess(0x0100 | 0x0001, 0, pid); // SET_QUOTA | TERMINATE
                if process.is_null() {
                    CloseHandle(job);
                    return Err(err("Cannot access agent process for job ownership"));
                }
                let assigned = AssignProcessToJobObject(job, process);
                CloseHandle(process);
                if assigned == 0 {
                    CloseHandle(job);
                    return Err(err("Cannot assign agent process tree to dock job"));
                }
                Ok(Self(job as usize))
            }
        }
        pub fn terminate(&self) -> Result<()> {
            // SAFETY: this handle is owned until Drop and has not been closed.
            if unsafe { TerminateJobObject(self.0 as Handle, 1) } == 0 {
                return Err(err("Cannot stop agent process job"));
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
