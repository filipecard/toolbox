use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

const REMINDERS_KEY: &str = "reminders";
const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// A single "thing with a due time" — both one-off reminders and the
/// pomodoro/countdown timer are stored as the same shape, distinguished
/// only by `kind` (a plain frontend-level tag: "reminder" | "timer"). Both
/// get the same background notification handling for free this way; the
/// frontend just filters by `kind` for display (see RemindersWindow.tsx).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReminderItem {
    pub id: String,
    pub kind: String,
    pub message: String,
    pub due_at: u64,
    pub created_at: u64,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn load_reminders(app: &AppHandle) -> Vec<ReminderItem> {
    app.store("store.json")
        .ok()
        .and_then(|store| store.get(REMINDERS_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn save_reminders(app: &AppHandle, items: &[ReminderItem]) {
    if let Ok(store) = app.store("store.json") {
        store.set(REMINDERS_KEY, serde_json::json!(items));
        let _ = store.save();
    }
    let _ = app.emit("reminders-changed", items);
}

#[tauri::command]
pub fn list_reminders(app: AppHandle) -> Vec<ReminderItem> {
    load_reminders(&app)
}

#[tauri::command]
pub fn add_reminder(app: AppHandle, kind: String, message: String, due_at: u64) -> ReminderItem {
    let item = ReminderItem {
        id: Uuid::new_v4().to_string(),
        kind,
        message,
        due_at,
        created_at: now_millis(),
    };
    let mut items = load_reminders(&app);
    items.push(item.clone());
    save_reminders(&app, &items);
    item
}

#[tauri::command]
pub fn remove_reminder(app: AppHandle, id: String) {
    let mut items = load_reminders(&app);
    items.retain(|i| i.id != id);
    save_reminders(&app, &items);
}

/// Background thread: every few seconds, fires a native OS notification for
/// any reminder/timer whose due time has passed, then removes it — runs
/// for the whole app lifetime, independent of whether the Lembretes/Timer
/// tool window is open, same shape as the clipboard history watcher.
pub fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL_INTERVAL);
        let items = load_reminders(&app);
        if items.is_empty() {
            continue;
        }
        let now = now_millis();
        let (due, pending): (Vec<ReminderItem>, Vec<ReminderItem>) =
            items.into_iter().partition(|i| i.due_at <= now);
        if due.is_empty() {
            continue;
        }
        for item in &due {
            let title = if item.kind == "timer" {
                "Timer concluído"
            } else {
                "Lembrete"
            };
            let _ = app
                .notification()
                .builder()
                .title(title)
                .body(&item.message)
                .show();
        }
        save_reminders(&app, &pending);
    });
}
