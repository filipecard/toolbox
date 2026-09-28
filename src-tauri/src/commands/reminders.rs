use serde::{Deserialize, Serialize};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

use crate::plans::{self, Feature};
use crate::state::AppState;
use crate::storage::REMINDERS_STORE;

const REMINDERS_KEY: &str = "reminders";
/// Upper bound on how long the watcher sleeps even with nothing due soon —
/// the wall clock can jump (PC sleep/hibernate, clock sync) without waking
/// a timed wait, so it re-checks at least this often.
const MAX_WAIT: Duration = Duration::from_secs(30);

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

/// In-memory reminder list shared by the commands and the watcher thread.
/// Every change goes through this one lock (read, modify, persist), so the
/// watcher removing fired items can't overwrite a reminder added at the
/// same moment — the old load-from-disk/save-to-disk approach could.
#[derive(Default)]
pub struct ReminderStore {
    items: Mutex<Vec<ReminderItem>>,
    /// Wakes the watcher early whenever the list changes, so a newly added
    /// reminder due sooner than the current wait fires on time.
    changed: Condvar,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn load_reminders(app: &AppHandle) -> Vec<ReminderItem> {
    app.store(REMINDERS_STORE)
        .ok()
        .and_then(|store| store.get(REMINDERS_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn persist(app: &AppHandle, items: &[ReminderItem]) {
    if let Ok(store) = app.store(REMINDERS_STORE) {
        store.set(REMINDERS_KEY, serde_json::json!(items));
        let _ = store.save();
    }
    let _ = app.emit("reminders-changed", items);
}

#[tauri::command]
pub fn list_reminders(app: AppHandle) -> Vec<ReminderItem> {
    app.state::<AppState>().reminders.items.lock().unwrap().clone()
}

#[tauri::command]
pub fn add_reminder(
    app: AppHandle,
    kind: String,
    message: String,
    due_at: u64,
) -> Result<ReminderItem, String> {
    let state = app.state::<AppState>();
    let mut items = state.reminders.items.lock().unwrap();

    // Plan cap on scheduled reminders (the single running timer isn't
    // counted — it's one-at-a-time by design).
    if kind == "reminder" {
        if let Some(limit) = plans::limit(&app, Feature::RemindersActive) {
            let active = items.iter().filter(|i| i.kind == "reminder").count();
            if active >= limit as usize {
                return Err(plans::limit_message(&app, Feature::RemindersActive));
            }
        }
    }

    let item = ReminderItem {
        id: Uuid::new_v4().to_string(),
        kind,
        message,
        due_at,
        created_at: now_millis(),
    };
    items.push(item.clone());
    persist(&app, &items);
    state.reminders.changed.notify_all();
    Ok(item)
}

#[tauri::command]
pub fn remove_reminder(app: AppHandle, id: String) {
    let state = app.state::<AppState>();
    let mut items = state.reminders.items.lock().unwrap();
    items.retain(|i| i.id != id);
    persist(&app, &items);
    state.reminders.changed.notify_all();
}

pub(crate) fn snapshot(app: &AppHandle) -> Vec<ReminderItem> {
    app.state::<AppState>().reminders.items.lock().unwrap().clone()
}

/// Adds reminders from a backup that are still in the future and not
/// already scheduled (by id).
pub(crate) fn import_items(app: &AppHandle, items: Vec<ReminderItem>) -> usize {
    let state = app.state::<AppState>();
    let mut current = state.reminders.items.lock().unwrap();
    let now = now_millis();
    let mut added = 0;
    for item in items {
        if item.due_at > now && !current.iter().any(|i| i.id == item.id) {
            current.push(item);
            added += 1;
        }
    }
    persist(app, &current);
    state.reminders.changed.notify_all();
    added
}

/// Background thread: sleeps until the next reminder/timer is due (or the
/// list changes), fires a native OS notification for everything past due,
/// then removes it — runs for the whole app lifetime, independent of
/// whether the Lembretes/Timer tool window is open, same shape as the
/// clipboard history watcher.
pub fn start_watcher(app: AppHandle) {
    *app.state::<AppState>().reminders.items.lock().unwrap() = load_reminders(&app);

    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let store = &state.reminders;
        let mut items = store.items.lock().unwrap();
        loop {
            let now = now_millis();
            if items.iter().any(|i| i.due_at <= now) {
                let (due, pending): (Vec<ReminderItem>, Vec<ReminderItem>) =
                    items.drain(..).partition(|i| i.due_at <= now);
                *items = pending;
                persist(&app, &items);
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
            }

            let wait = items
                .iter()
                .map(|i| Duration::from_millis(i.due_at.saturating_sub(now)))
                .min()
                .unwrap_or(MAX_WAIT)
                .min(MAX_WAIT);
            items = store.changed.wait_timeout(items, wait).unwrap().0;
        }
    });
}
