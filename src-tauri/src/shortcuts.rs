//! User-configurable global keyboard shortcuts: open/close any tool, the
//! notes bar, the quick menu or Settings from anywhere, without clicking
//! the bubble. The bindings live in the frontend settings
//! (`settings.shortcuts`, action id → "Ctrl+Alt+KeyV"-style string, the
//! format global-hotkey parses) and are (re)registered here at startup and
//! whenever Settings changes them.

use serde::Serialize;
use std::collections::HashMap;
use std::str::FromStr;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

use crate::state::AppState;
use crate::storage::SETTINGS_STORE;

/// Used until the user saves settings with their own bindings. Keep in
/// sync with DEFAULT_SHORTCUTS in settingsStore.ts.
const DEFAULT_SHORTCUTS: &[(&str, &str)] = &[("quick-menu", "Ctrl+Alt+Space")];

/// What went wrong registering one binding, for Settings to show next to
/// it (usually: another program already owns that combination).
#[derive(Serialize)]
pub struct ShortcutError {
    action: String,
    message: String,
}

/// Called by the global-shortcut plugin on every key press of a
/// registered combination.
pub fn handle(app: &AppHandle, shortcut: &Shortcut, state: ShortcutState) {
    if state != ShortcutState::Pressed {
        return;
    }
    let action = app
        .state::<AppState>()
        .shortcut_actions
        .lock()
        .unwrap()
        .get(&shortcut.id())
        .cloned();
    if let Some(action) = action {
        crate::commands::windows::toggle_action(app, &action);
    }
}

/// Unregisters everything and registers `bindings` (action → combo).
/// Returns one error per binding that couldn't be registered; the others
/// still work.
fn apply(app: &AppHandle, bindings: &HashMap<String, String>) -> Vec<ShortcutError> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let state = app.state::<AppState>();
    let mut actions = state.shortcut_actions.lock().unwrap();
    actions.clear();

    let mut errors = Vec::new();
    for (action, combo) in bindings {
        if combo.trim().is_empty() {
            continue;
        }
        let result = Shortcut::from_str(combo)
            .map_err(|_| "Combinação inválida.".to_string())
            .and_then(|shortcut| {
                if actions.contains_key(&shortcut.id()) {
                    return Err("Já usada por outro atalho do ToolBox.".to_string());
                }
                gs.register(shortcut)
                    .map_err(|_| "Já está em uso por outro programa ou pelo Windows.".to_string())?;
                actions.insert(shortcut.id(), action.clone());
                Ok(())
            });
        if let Err(message) = result {
            errors.push(ShortcutError {
                action: action.clone(),
                message,
            });
        }
    }
    errors
}

fn stored_bindings(app: &AppHandle) -> HashMap<String, String> {
    let stored = app
        .store(SETTINGS_STORE)
        .ok()
        .and_then(|s| s.get("settings"))
        .and_then(|v| v.get("shortcuts").cloned())
        .and_then(|v| serde_json::from_value::<HashMap<String, String>>(v).ok());
    stored.unwrap_or_else(|| {
        DEFAULT_SHORTCUTS
            .iter()
            .map(|(a, c)| (a.to_string(), c.to_string()))
            .collect()
    })
}

/// Startup / after a backup import: registers whatever settings hold.
pub fn apply_from_settings(app: &AppHandle) {
    for err in apply(app, &stored_bindings(app)) {
        eprintln!("shortcut '{}' not registered: {}", err.action, err.message);
    }
}

#[tauri::command]
pub fn apply_shortcuts(app: AppHandle, shortcuts: HashMap<String, String>) -> Vec<ShortcutError> {
    apply(&app, &shortcuts)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every shape the Settings recorder (shortcutFormat.ts) can produce
    /// must parse on this side.
    #[test]
    fn recorder_formats_parse() {
        for combo in [
            "Ctrl+Alt+Space",
            "Ctrl+Alt+KeyV",
            "Shift+Super+Digit1",
            "Ctrl+Shift+F5",
            "F9",
            "Ctrl+Alt+Numpad1",
            "Ctrl+Alt+ArrowUp",
            "Ctrl+Alt+Backquote",
            "Ctrl+Shift+Comma",
        ] {
            assert!(Shortcut::from_str(combo).is_ok(), "{combo} should parse");
        }
    }

    #[test]
    fn same_combo_same_id() {
        let a = Shortcut::from_str("Ctrl+Alt+KeyV").unwrap();
        let b = Shortcut::from_str("Alt+Ctrl+KeyV").unwrap();
        assert_eq!(a.id(), b.id());
    }
}
