// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
#[link(name = "winmm")]
extern "system" {
    fn timeBeginPeriod(uPeriod: u32) -> u32;
    fn timeEndPeriod(uPeriod: u32) -> u32;
}

fn main() {
    #[cfg(windows)]
    unsafe {
        // Windows の標準タイマー分解能 (15.6ms) を 1ms に引き上げ、
        // Core スケジューラーの 2ms ループおよび Tokio タイマーを高精度化
        timeBeginPeriod(1);
    }

    tick_replay_lib::run();

    #[cfg(windows)]
    unsafe {
        timeEndPeriod(1);
    }
}
