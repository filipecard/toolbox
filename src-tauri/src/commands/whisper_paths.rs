use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// Shared store.json keys for whisper.cpp's binary + model paths — used by
/// both the auto-download flow (whisper_setup.rs) and the manual/advanced
/// path fields (transcribe.rs), so both agree on where to look.
const MODEL_PATH_KEY: &str = "whisperModelPath";
const BINARY_PATH_KEY: &str = "whisperBinaryPath";

pub fn get_model_path(app: &AppHandle) -> Option<String> {
    app.store("store.json")
        .ok()?
        .get(MODEL_PATH_KEY)?
        .as_str()
        .map(str::to_string)
}

pub fn set_model_path(app: &AppHandle, path: &str) -> Result<(), String> {
    let store = app.store("store.json").map_err(|e| e.to_string())?;
    store.set(MODEL_PATH_KEY, serde_json::json!(path));
    store.save().map_err(|e| e.to_string())
}

pub fn get_binary_path(app: &AppHandle) -> Option<String> {
    app.store("store.json")
        .ok()?
        .get(BINARY_PATH_KEY)?
        .as_str()
        .map(str::to_string)
}

pub fn set_binary_path(app: &AppHandle, path: &str) -> Result<(), String> {
    let store = app.store("store.json").map_err(|e| e.to_string())?;
    store.set(BINARY_PATH_KEY, serde_json::json!(path));
    store.save().map_err(|e| e.to_string())
}
