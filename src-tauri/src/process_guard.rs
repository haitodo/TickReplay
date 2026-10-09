//! Windows Job Object による子プロセスのライフサイクル保護
//! 親プロセス（TickReplay）が異常終了・強制終了・クラッシュした場合でも、
//! OS カーネルレベルで子プロセス（TickScope）を確実に道連れ終了させ、ゾンビプロセス化を 100% 防止する。

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use std::ptr;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
    JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub struct ProcessJobGuard {
    #[cfg(windows)]
    job_handle: Option<HANDLE>,
}

// HANDLE はスレッドセーフ（Send + Sync）として扱う
unsafe impl Send for ProcessJobGuard {}
unsafe impl Sync for ProcessJobGuard {}

impl Default for ProcessJobGuard {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessJobGuard {
    pub fn new() -> Self {
        #[cfg(windows)]
        {
            unsafe {
                let job = CreateJobObjectW(ptr::null(), ptr::null());
                if job.is_null() {
                    eprintln!("[process_guard] CreateJobObjectW failed");
                    return Self { job_handle: None };
                }

                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                let res = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );

                if res == 0 {
                    eprintln!("[process_guard] SetInformationJobObject failed");
                    CloseHandle(job);
                    return Self { job_handle: None };
                }

                println!("[process_guard] Windows Job Object 初期化成功 (KILL_ON_JOB_CLOSE 有効)");
                Self { job_handle: Some(job) }
            }
        }
        #[cfg(not(windows))]
        {
            Self {}
        }
    }

    /// 子プロセスを Job Object に割り当てる
    pub fn assign_child(&self, child: &std::process::Child) -> bool {
        #[cfg(windows)]
        {
            if let Some(job) = self.job_handle {
                let raw_handle = child.as_raw_handle() as HANDLE;
                unsafe {
                    let res = AssignProcessToJobObject(job, raw_handle);
                    if res == 0 {
                        eprintln!("[process_guard] AssignProcessToJobObject failed");
                        return false;
                    }
                    println!("[process_guard] 子プロセス (PID: {}) を Job Object に登録完了", child.id());
                    return true;
                }
            }
            false
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            true
        }
    }
}

impl Drop for ProcessJobGuard {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            if let Some(job) = self.job_handle.take() {
                unsafe {
                    CloseHandle(job);
                }
            }
        }
    }
}
