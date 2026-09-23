use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

use crate::state::AppState;

/// Local-only placeholder for the real (server-enforced) paywall — same
/// approach as the OCR tool's daily counter (see commands/ocr.rs): trimming
/// history to this length client-side is trivially bypassable, but genuine
/// enforcement needs the online licensing backend from the monetization
/// plan, which is separate, larger work than this tool itself. Paid tier
/// is meant to keep unlimited history.
const FREE_HISTORY_LIMIT: usize = 10;
const HISTORY_KEY: &str = "clipboardHistory";
const POLL_INTERVAL: Duration = Duration::from_millis(700);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardEntry {
    pub id: String,
    pub text: String,
    pub created_at: u64,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn load_history(app: &AppHandle) -> Vec<ClipboardEntry> {
    app.store("store.json")
        .ok()
        .and_then(|store| store.get(HISTORY_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn persist_history(app: &AppHandle, history: &[ClipboardEntry]) {
    if let Ok(store) = app.store("store.json") {
        store.set(HISTORY_KEY, serde_json::json!(history));
        let _ = store.save();
    }
}

/// Starts the background thread that watches the system clipboard for text
/// changes and appends them to history — independent of whether the
/// Clipboard tool window is open, which is the whole point of a clipboard
/// *manager* rather than a one-shot paste tool. Polling (rather than an OS
/// clipboard-changed notification) keeps this simple and portable; there's
/// no cheap native "clipboard changed" event to hook on Windows anyway.
/// Runs for the entire app lifetime.
pub fn start_watcher(app: AppHandle) {
    // Seeds in-memory state from disk before the loop starts, so the first
    // poll compares against the last known entry instead of re-adding it.
    let initial = load_history(&app);
    let mut last_seen = initial.first().map(|e| e.text.clone());
    *app.state::<AppState>().clipboard_history.lock().unwrap() = initial;

    std::thread::spawn(move || {
        let mut clipboard = match arboard::Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("clipboard watcher: failed to open system clipboard: {e}");
                return;
            }
        };

        loop {
            std::thread::sleep(POLL_INTERVAL);
            let Ok(text) = clipboard.get_text() else {
                continue; // Non-text clipboard content (image, files...) — out of scope for now.
            };
            let text = text.trim().to_string();
            if text.is_empty() || Some(&text) == last_seen.as_ref() {
                continue;
            }
            last_seen = Some(text.clone());

            let entry = ClipboardEntry {
                id: Uuid::new_v4().to_string(),
                text,
                created_at: now_millis(),
            };

            let state = app.state::<AppState>();
            let mut history = state.clipboard_history.lock().unwrap();
            // Re-copying something already in history (e.g. clicking an
            // older entry to copy it back) moves it to the top with a fresh
            // timestamp instead of creating a duplicate row.
            history.retain(|e| e.text != entry.text);
            history.insert(0, entry);
            history.truncate(FREE_HISTORY_LIMIT);
            persist_history(&app, &history);
            let snapshot = history.clone();
            drop(history);

            let _ = app.emit("clipboard-history-changed", snapshot);
        }
    });
}

#[tauri::command]
pub fn list_clipboard_history(app: AppHandle) -> Vec<ClipboardEntry> {
    app.state::<AppState>().clipboard_history.lock().unwrap().clone()
}

#[tauri::command]
pub fn clear_clipboard_history(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.clipboard_history.lock().unwrap().clear();
    persist_history(&app, &[]);
    let _ = app.emit("clipboard-history-changed", Vec::<ClipboardEntry>::new());
    Ok(())
}

#[tauri::command]
pub fn remove_clipboard_entry(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut history = state.clipboard_history.lock().unwrap();
    history.retain(|e| e.id != id);
    persist_history(&app, &history);
    let snapshot = history.clone();
    drop(history);
    let _ = app.emit("clipboard-history-changed", snapshot);
    Ok(())
}
