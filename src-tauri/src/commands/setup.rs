//! What the installer asked (see src-tauri/installer/installer.nsi) and the
//! "Iniciar com o Windows" switch.
//!
//! The installer writes %APPDATA%\<bundle id>\installer-setup.json with the
//! chosen tools, theme and autostart. The launcher bubble takes it once on
//! the first start (applies it to the settings) and the file is deleted.

use std::os::windows::process::CommandExt;
use std::process::Command;
use tauri::{AppHandle, Manager};

const SETUP_FILE: &str = "installer-setup.json";
/// Same value the installer writes and the uninstaller removes.
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "ToolBox";
/// No console window flashing when running reg.exe.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The installer's choices, once. `null` when there are none (updates,
/// silent installs, or already applied).
#[tauri::command]
pub fn take_installer_setup(app: AppHandle) -> Option<serde_json::Value> {
    let path = app.path().app_data_dir().ok()?.join(SETUP_FILE);
    let text = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    let setup: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    // The tools picked here win over the ones chosen on the website.
    if setup.get("tools").is_some_and(|t| t.is_array()) {
        crate::account::mark_tools_chosen_by_installer(&app);
    }
    Some(setup)
}

fn reg(args: &[&str]) -> std::io::Result<std::process::Output> {
    Command::new("reg").args(args).creation_flags(CREATE_NO_WINDOW).output()
}

#[tauri::command]
pub fn autostart_enabled() -> bool {
    reg(&["query", RUN_KEY, "/v", RUN_VALUE]).is_ok_and(|o| o.status.success())
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<bool, String> {
    let result = if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let data = format!("\"{}\" --autostart", exe.display());
        reg(&["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", &data, "/f"])
    } else {
        if !autostart_enabled() {
            return Ok(false);
        }
        reg(&["delete", RUN_KEY, "/v", RUN_VALUE, "/f"])
    };
    match result {
        Ok(o) if o.status.success() => Ok(autostart_enabled()),
        _ => Err("Não foi possível alterar a inicialização com o Windows.".into()),
    }
}
