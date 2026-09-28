//! Export/import of the user's data as a single .zip: settings (themes,
//! quick-menu, shortcuts), calculator state, notes, clipboard history
//! (with images) and scheduled reminders.
//!
//! Deliberately NOT included: plan.json (entitlements and usage counters
//! must never travel in a file the user can edit and re-import), window
//! positions and machine-specific paths (whisper binary/model).
//!
//! Import merges instead of replacing: notes/clipboard/reminders not already
//! present are added (a note present on both sides keeps the newer copy),
//! settings are replaced — they're a single coherent block.

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::commands::clipboard::{self, ClipboardEntry, EntryKind};
use crate::commands::notes::{self as notes, NoteMeta};
use crate::commands::reminders::{self, ReminderItem};
use crate::storage::SETTINGS_STORE;

const FORMAT: &str = "toolbox-backup";
const VERSION: u32 = 1;
/// Per-entry read cap on import — a crafted zip can't balloon memory.
const MAX_ENTRY_BYTES: u64 = 200 * 1024 * 1024;
/// store.json keys that travel in a backup.
const SETTINGS_KEYS: &[&str] = &["settings", "calculator"];

#[derive(Serialize, Deserialize)]
struct Manifest {
    format: String,
    version: u32,
    created_at: u64,
}

#[derive(Serialize, Default)]
pub struct ImportSummary {
    settings: bool,
    notes: usize,
    clipboard: usize,
    reminders: usize,
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn io_err(e: impl std::fmt::Display) -> String {
    format!("Falha no backup: {e}")
}

#[tauri::command]
pub fn export_backup(app: AppHandle, path: String) -> Result<(), String> {
    let file = File::create(&path).map_err(io_err)?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default();
    let put = |zip: &mut ZipWriter<File>, name: &str, bytes: &[u8]| -> Result<(), String> {
        zip.start_file(name, opts).map_err(io_err)?;
        zip.write_all(bytes).map_err(io_err)
    };

    let manifest = Manifest {
        format: FORMAT.into(),
        version: VERSION,
        created_at: chrono::Local::now().timestamp_millis() as u64,
    };
    put(&mut zip, "manifest.json", &serde_json::to_vec_pretty(&manifest).map_err(io_err)?)?;

    let store = app.store(SETTINGS_STORE).map_err(io_err)?;
    let settings: serde_json::Map<String, serde_json::Value> = SETTINGS_KEYS
        .iter()
        .filter_map(|k| store.get(*k).map(|v| (k.to_string(), v)))
        .collect();
    put(&mut zip, "settings.json", &serde_json::to_vec_pretty(&settings).map_err(io_err)?)?;

    let index = notes::read_index(&app);
    put(&mut zip, "notes/index.json", &serde_json::to_vec_pretty(&index).map_err(io_err)?)?;
    let dir = notes::notes_dir(&app);
    for meta in &index {
        if let Ok(content) = std::fs::read(dir.join(format!("{}.md", meta.id))) {
            put(&mut zip, &format!("notes/{}.md", meta.id), &content)?;
        }
    }

    let history = clipboard::snapshot(&app);
    put(&mut zip, "clipboard.json", &serde_json::to_vec_pretty(&history).map_err(io_err)?)?;
    for entry in history.iter().filter(|e| e.kind == EntryKind::Image) {
        if let Some(bytes) = clipboard::image_path(&app, &entry.id).and_then(|p| std::fs::read(p).ok()) {
            // Already-compressed PNGs: storing avoids burning CPU for ~0 gain.
            zip.start_file(
                format!("clipboard-images/{}.png", entry.id),
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
            )
            .map_err(io_err)?;
            zip.write_all(&bytes).map_err(io_err)?;
        }
    }

    let items = reminders::snapshot(&app);
    put(&mut zip, "reminders.json", &serde_json::to_vec_pretty(&items).map_err(io_err)?)?;

    zip.finish().map_err(io_err)?;
    Ok(())
}

fn read_entry(archive: &mut ZipArchive<File>, name: &str) -> Option<Vec<u8>> {
    let entry = archive.by_name(name).ok()?;
    let mut buf = Vec::new();
    entry.take(MAX_ENTRY_BYTES).read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn read_json<T: for<'de> Deserialize<'de>>(archive: &mut ZipArchive<File>, name: &str) -> Option<T> {
    serde_json::from_slice(&read_entry(archive, name)?).ok()
}

#[tauri::command]
pub fn import_backup(app: AppHandle, path: String) -> Result<ImportSummary, String> {
    let file = File::open(&path).map_err(io_err)?;
    let mut archive = ZipArchive::new(file).map_err(|_| "Arquivo não é um backup válido do ToolBox.".to_string())?;
    let manifest: Manifest =
        read_json(&mut archive, "manifest.json").ok_or("Arquivo não é um backup válido do ToolBox.")?;
    if manifest.format != FORMAT || manifest.version > VERSION {
        return Err("Backup de um formato/versão desconhecido — atualize o ToolBox.".into());
    }
    let mut summary = ImportSummary::default();

    // Settings (replaced as a block).
    if let Some(settings) = read_json::<serde_json::Map<String, serde_json::Value>>(&mut archive, "settings.json") {
        let store = app.store(SETTINGS_STORE).map_err(io_err)?;
        for key in SETTINGS_KEYS {
            if let Some(value) = settings.get(*key) {
                store.set(*key, value.clone());
                summary.settings = true;
            }
        }
        store.save().map_err(io_err)?;
        // null payload → each window re-reads (see settingsStore.ts).
        let _ = app.emit("settings-changed", serde_json::Value::Null);
        crate::shortcuts::apply_from_settings(&app);
    }

    // Notes (merged; newer copy wins).
    if let Some(backup_index) = read_json::<Vec<NoteMeta>>(&mut archive, "notes/index.json") {
        let mut index = notes::read_index(&app);
        for meta in backup_index.into_iter().filter(|m| is_safe_id(&m.id)) {
            let current = index.iter().position(|m| m.id == meta.id);
            if current.is_some_and(|i| index[i].updated_at >= meta.updated_at) {
                continue;
            }
            let content = read_entry(&mut archive, &format!("notes/{}.md", meta.id))
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .unwrap_or_default();
            notes::write_note_content(&app, &meta.id, &content)?;
            match current {
                Some(i) => index[i] = meta,
                None => index.push(meta),
            }
            summary.notes += 1;
        }
        index.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        notes::write_index(&app, &index)?;
        let _ = app.emit("notes-changed", ());
    }

    // Clipboard (images copied first, so entries never point at nothing).
    if let Some(entries) = read_json::<Vec<ClipboardEntry>>(&mut archive, "clipboard.json") {
        let mut usable = Vec::new();
        for entry in entries.into_iter().filter(|e| is_safe_id(&e.id)) {
            if entry.kind == EntryKind::Image {
                let Some(bytes) = read_entry(&mut archive, &format!("clipboard-images/{}.png", entry.id)) else {
                    continue;
                };
                let Some(dest) = clipboard::image_path(&app, &entry.id) else { continue };
                if let Some(parent) = dest.parent() {
                    std::fs::create_dir_all(parent).map_err(io_err)?;
                }
                std::fs::write(dest, bytes).map_err(io_err)?;
            }
            usable.push(entry);
        }
        summary.clipboard = clipboard::import_entries(&app, usable);
    }

    // Reminders (only future ones).
    if let Some(items) = read_json::<Vec<ReminderItem>>(&mut archive, "reminders.json") {
        summary.reminders = reminders::import_items(&app, items);
    }

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::is_safe_id;

    #[test]
    fn only_plain_ids_become_file_names() {
        assert!(is_safe_id("3f2b9c1e-7a1d-4b8e-9c2f-0a1b2c3d4e5f"));
        assert!(!is_safe_id("../../evil"));
        assert!(!is_safe_id("a/b"));
        assert!(!is_safe_id(""));
    }
}
