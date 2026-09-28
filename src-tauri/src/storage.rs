//! Which file each kind of persisted data lives in. Kept apart so frequent
//! writes (every clipboard copy, every reminder) don't rewrite the settings
//! file each time — a smaller, rarely-written store.json is also less
//! exposed to corruption, and the clipboard history can grow with paid
//! plans without making every settings save heavier.

use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// Settings, window positions, whisper paths, cached currency rates.
pub const SETTINGS_STORE: &str = "store.json";
pub const CLIPBOARD_STORE: &str = "clipboard.json";
pub const REMINDERS_STORE: &str = "reminders.json";
/// Plan entitlements + daily usage counters.
pub const PLAN_STORE: &str = "plan.json";

/// Moves data older versions kept in store.json into its own file. Runs at
/// startup before any watcher reads it; a no-op once migrated.
pub fn migrate_legacy(app: &AppHandle) {
    let Ok(settings) = app.store(SETTINGS_STORE) else {
        return;
    };
    let mut changed = false;

    for (key, target) in [("clipboardHistory", CLIPBOARD_STORE), ("reminders", REMINDERS_STORE)] {
        if let Some(value) = settings.get(key) {
            if let Ok(store) = app.store(target) {
                if store.get(key).is_none() {
                    store.set(key, value);
                    let _ = store.save();
                }
            }
            settings.delete(key);
            changed = true;
        }
    }

    // Old per-tool daily counters — superseded by plans.rs's counters.
    for key in ["ocrUsage", "compressorUsage", "transcribeUsage"] {
        changed |= settings.delete(key);
    }

    if changed {
        let _ = settings.save();
    }
}
