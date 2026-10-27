//! Settings → Ferramentas: removing a tool from this computer.
//!
//! Whether a tool is installed lives in the settings (quick-menu item
//! `installed`, see windows.rs `tool_installed`), written by the frontend.
//! This side cleans up what the tool left on disk: its open window and the
//! components it downloaded (Tesseract, whisper.cpp + model), which are the
//! only heavy parts — the tools' own code is a few KB inside the app. The
//! user's data (notes, clipboard history, reminders) is kept, so installing
//! the tool again brings it back.

use tauri::{AppHandle, Manager};

use super::whisper_paths::{clear_paths, get_binary_path, get_model_path};
use super::whisper_setup::whisper_dir;

#[tauri::command]
pub fn remove_tool_components(app: AppHandle, tool_id: String) -> Result<(), String> {
    let window = if tool_id == "notes" { "notes-bar".to_string() } else { format!("tool-{tool_id}") };
    if let Some(win) = app.get_webview_window(&window) {
        let _ = win.destroy();
    }

    match tool_id.as_str() {
        "ocr" => {
            if let Some(dir) = crate::account::dependencies::deps_dir(&app, "tesseract") {
                remove_dir(&dir)?;
            }
        }
        "transcribe" => {
            let dir = whisper_dir(&app)?;
            // Paths typed in "Avançado" point at the user's own install:
            // those are forgotten only if they were inside our folder.
            let ours = |p: Option<String>| p.is_some_and(|p| std::path::Path::new(&p).starts_with(&dir));
            if ours(get_binary_path(&app)) || ours(get_model_path(&app)) {
                clear_paths(&app);
            }
            remove_dir(&dir)?;
            if let Some(deps) = crate::account::dependencies::deps_dir(&app, "whisper") {
                remove_dir(&deps)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn remove_dir(dir: &std::path::Path) -> Result<(), String> {
    match std::fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Não foi possível apagar os arquivos da ferramenta. Feche-a e tente de novo.".into()),
    }
}
