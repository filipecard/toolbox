use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

use crate::plans::{self, Feature};
use crate::state::AppState;
use crate::storage::CLIPBOARD_STORE;

const HISTORY_KEY: &str = "clipboardHistory";
const CHANGED_EVENT: &str = "clipboard-history-changed";
const POLL_INTERVAL: Duration = Duration::from_millis(700);
const IMAGES_DIR: &str = "clipboard-images";
/// Bigger clipboard images (huge screenshots of multi-monitor setups,
/// raw photos) are skipped rather than stored as multi-hundred-MB PNGs.
const MAX_IMAGE_PIXELS: u64 = 40_000_000;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    #[default]
    Text,
    Image,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ImageInfo {
    pub width: u32,
    pub height: u32,
    /// FNV-1a of the RGBA pixels, as hex — how a re-copied image is
    /// recognized as one already in history.
    pub hash: String,
}

/// One clipboard item. Pinned entries ("Fixados") are kept out of the
/// history cap and survive "Limpar histórico"; a pinned text entry created
/// by hand, with a title, is a ready-made snippet ("texto pronto").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardEntry {
    pub id: String,
    #[serde(default)]
    pub kind: EntryKind,
    /// The text itself; empty for images.
    pub text: String,
    pub created_at: u64,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<ImageInfo>,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn images_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(IMAGES_DIR))
}

pub(crate) fn image_path(app: &AppHandle, id: &str) -> Option<PathBuf> {
    // ids are our own UUIDs; anything else never becomes a path.
    if !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return None;
    }
    images_dir(app).map(|d| d.join(format!("{id}.png")))
}

fn load_history(app: &AppHandle) -> Vec<ClipboardEntry> {
    app.store(CLIPBOARD_STORE)
        .ok()
        .and_then(|store| store.get(HISTORY_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn persist_history(app: &AppHandle, history: &[ClipboardEntry]) {
    if let Ok(store) = app.store(CLIPBOARD_STORE) {
        store.set(HISTORY_KEY, serde_json::json!(history));
        let _ = store.save();
    }
}

fn delete_image_file(app: &AppHandle, entry: &ClipboardEntry) {
    if entry.kind == EntryKind::Image {
        if let Some(path) = image_path(app, &entry.id) {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Persists, notifies open windows. Call with the lock still held so
/// writes land in order.
fn commit(app: &AppHandle, history: &[ClipboardEntry]) {
    persist_history(app, history);
    let _ = app.emit(CHANGED_EVENT, history.to_vec());
}

/// Keeps at most the plan's number of unpinned entries (newest first),
/// deleting the image files of the ones dropped. Returns whether anything
/// was removed.
fn trim_unpinned(app: &AppHandle, history: &mut Vec<ClipboardEntry>) -> bool {
    let Some(limit) = plans::limit(app, Feature::ClipboardHistory) else {
        return false;
    };
    let mut kept_unpinned = 0usize;
    let before = history.len();
    history.retain(|e| {
        if e.pinned {
            return true;
        }
        kept_unpinned += 1;
        if kept_unpinned > limit as usize {
            delete_image_file(app, e);
            return false;
        }
        true
    });
    history.len() != before
}

fn fnv1a(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, png::EncodingError> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header()?;
        writer.write_image_data(rgba)?;
    }
    Ok(out)
}

fn decode_png(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let decoder = png::Decoder::new(bytes);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(info.buffer_size());
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return Err("formato de imagem inesperado".into());
    }
    Ok((info.width, info.height, buf))
}

/// What the watcher just read from the system clipboard.
enum Captured {
    Text(String),
    Image { width: u32, height: u32, rgba: Vec<u8>, hash: String },
}

fn capture(clipboard: &mut arboard::Clipboard) -> Option<Captured> {
    if let Ok(text) = clipboard.get_text() {
        let text = text.trim().to_string();
        return (!text.is_empty()).then_some(Captured::Text(text));
    }
    let img = clipboard.get_image().ok()?;
    if (img.width as u64) * (img.height as u64) > MAX_IMAGE_PIXELS {
        return None;
    }
    let hash = fnv1a(&img.bytes);
    Some(Captured::Image {
        width: img.width as u32,
        height: img.height as u32,
        rgba: img.bytes.into_owned(),
        hash,
    })
}

/// Adds a captured item to history — or, if it's already there (e.g. an
/// older entry clicked to copy it back), moves that entry to the top with a
/// fresh timestamp instead of duplicating it (pinned/title kept).
fn record(app: &AppHandle, captured: Captured) {
    let state = app.state::<AppState>();
    let mut history = state.clipboard_history.lock().unwrap();

    let existing = history.iter().position(|e| match &captured {
        Captured::Text(text) => e.kind == EntryKind::Text && e.text == *text,
        Captured::Image { hash, .. } => e.image.as_ref().is_some_and(|i| i.hash == *hash),
    });
    if let Some(pos) = existing {
        if pos == 0 {
            return; // already the newest — nothing changed
        }
        let mut entry = history.remove(pos);
        entry.created_at = now_millis();
        history.insert(0, entry);
    } else {
        let id = Uuid::new_v4().to_string();
        let entry = match captured {
            Captured::Text(text) => ClipboardEntry {
                id,
                kind: EntryKind::Text,
                text,
                created_at: now_millis(),
                pinned: false,
                title: None,
                image: None,
            },
            Captured::Image { width, height, rgba, hash } => {
                let Some(path) = image_path(app, &id) else { return };
                let saved = encode_png(width, height, &rgba)
                    .map_err(|e| e.to_string())
                    .and_then(|png| {
                        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
                        std::fs::write(&path, png).map_err(|e| e.to_string())
                    });
                if let Err(e) = saved {
                    eprintln!("clipboard watcher: failed to save image: {e}");
                    return;
                }
                ClipboardEntry {
                    id,
                    kind: EntryKind::Image,
                    text: String::new(),
                    created_at: now_millis(),
                    pinned: false,
                    title: None,
                    image: Some(ImageInfo { width, height, hash }),
                }
            }
        };
        history.insert(0, entry);
        trim_unpinned(app, &mut history);
    }
    commit(app, &history);
}

/// Adds entries from a backup that aren't already here (by id), newest
/// first, then applies the plan's history cap. Image files must already
/// be in place (see backup.rs).
pub(crate) fn import_entries(app: &AppHandle, entries: Vec<ClipboardEntry>) -> usize {
    let state = app.state::<AppState>();
    let mut history = state.clipboard_history.lock().unwrap();
    let mut added = 0;
    for entry in entries {
        if !history.iter().any(|e| e.id == entry.id) {
            history.push(entry);
            added += 1;
        }
    }
    history.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    trim_unpinned(app, &mut history);
    commit(app, &history);
    added
}

pub(crate) fn snapshot(app: &AppHandle) -> Vec<ClipboardEntry> {
    app.state::<AppState>().clipboard_history.lock().unwrap().clone()
}

/// Deletes image files no entry points to (left by a crash, or by an
/// older version).
fn remove_orphan_images(app: &AppHandle, history: &[ClipboardEntry]) {
    let Some(dir) = images_dir(app) else { return };
    let Ok(read) = std::fs::read_dir(&dir) else { return };
    for file in read.flatten() {
        let name = file.file_name().to_string_lossy().to_string();
        let id = name.trim_end_matches(".png");
        if !history.iter().any(|e| e.id == id) {
            let _ = std::fs::remove_file(file.path());
        }
    }
}

/// Windows bumps this counter on every clipboard change. Reading it is a
/// single cheap call, unlike `get_text`, which copies the whole clipboard
/// contents out — so each poll only does real work when something changed.
#[cfg(windows)]
fn clipboard_sequence() -> Option<u32> {
    #[link(name = "user32")]
    extern "system" {
        fn GetClipboardSequenceNumber() -> u32;
    }
    // SAFETY: no arguments, no preconditions; returns 0 when unavailable.
    let seq = unsafe { GetClipboardSequenceNumber() };
    (seq != 0).then_some(seq)
}

#[cfg(not(windows))]
fn clipboard_sequence() -> Option<u32> {
    None
}

/// Starts the background thread that watches the system clipboard for
/// text and images and appends them to history — independent of whether
/// the Clipboard tool window is open, which is the whole point of a
/// clipboard *manager* rather than a one-shot paste tool. Runs for the
/// entire app lifetime.
pub fn start_watcher(app: AppHandle) {
    let initial = load_history(&app);
    remove_orphan_images(&app, &initial);
    *app.state::<AppState>().clipboard_history.lock().unwrap() = initial;
    // History saved under a bigger plan (or before plans existed) must not
    // show more than the current plan allows.
    enforce_plan_limit(&app);

    std::thread::spawn(move || {
        let mut clipboard = match arboard::Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("clipboard watcher: failed to open system clipboard: {e}");
                return;
            }
        };

        // None, so the first poll always reads (picks up whatever was copied
        // while the app was closed).
        let mut last_seq: Option<u32> = None;
        loop {
            std::thread::sleep(POLL_INTERVAL);
            let seq = clipboard_sequence();
            if seq.is_some() && seq == last_seq {
                continue;
            }
            last_seq = seq;
            if let Some(captured) = capture(&mut clipboard) {
                record(&app, captured);
            }
        }
    });
}

/// Trims history to the current plan's cap (keeping the newest entries).
/// Runs at startup and whenever the plan changes (see plans.rs), besides on
/// every new copy — so the list never shows more than the plan allows.
/// Pinned entries are never removed here; a lower plan only blocks new pins.
pub fn enforce_plan_limit(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut history = state.clipboard_history.lock().unwrap();
    if trim_unpinned(app, &mut history) {
        commit(app, &history);
    }
}

fn pinned_count(history: &[ClipboardEntry]) -> usize {
    history.iter().filter(|e| e.pinned).count()
}

fn check_pin_allowed(app: &AppHandle, history: &[ClipboardEntry]) -> Result<(), String> {
    match plans::limit(app, Feature::ClipboardPinned) {
        Some(limit) if pinned_count(history) >= limit as usize => {
            Err(plans::limit_message(app, Feature::ClipboardPinned))
        }
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn list_clipboard_history(app: AppHandle) -> Vec<ClipboardEntry> {
    app.state::<AppState>().clipboard_history.lock().unwrap().clone()
}

/// Clears the history but keeps pinned entries and snippets.
#[tauri::command]
pub fn clear_clipboard_history(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut history = state.clipboard_history.lock().unwrap();
    history.retain(|e| {
        if !e.pinned {
            delete_image_file(&app, e);
        }
        e.pinned
    });
    commit(&app, &history);
    Ok(())
}

#[tauri::command]
pub fn remove_clipboard_entry(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut history = state.clipboard_history.lock().unwrap();
    history.retain(|e| {
        if e.id == id {
            delete_image_file(&app, e);
        }
        e.id != id
    });
    commit(&app, &history);
    Ok(())
}

#[tauri::command]
pub fn set_clipboard_pinned(app: AppHandle, id: String, pinned: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut history = state.clipboard_history.lock().unwrap();
    if pinned {
        check_pin_allowed(&app, &history)?;
    }
    let Some(pos) = history.iter().position(|e| e.id == id) else {
        return Err("Item não encontrado.".into());
    };
    if pinned {
        history[pos].pinned = true;
    } else {
        // Back into the regular history at the top, so unpinning an old
        // item doesn't immediately push it past the history cap.
        let mut entry = history.remove(pos);
        entry.pinned = false;
        entry.created_at = now_millis();
        history.insert(0, entry);
        trim_unpinned(&app, &mut history);
    }
    commit(&app, &history);
    Ok(())
}

/// A hand-written, titled, pinned text entry — a "texto pronto".
#[tauri::command]
pub fn add_clipboard_snippet(app: AppHandle, title: String, text: String) -> Result<ClipboardEntry, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Escreva o texto do item.".into());
    }
    let state = app.state::<AppState>();
    let mut history = state.clipboard_history.lock().unwrap();
    check_pin_allowed(&app, &history)?;
    let title = title.trim();
    let entry = ClipboardEntry {
        id: Uuid::new_v4().to_string(),
        kind: EntryKind::Text,
        text,
        created_at: now_millis(),
        pinned: true,
        title: (!title.is_empty()).then(|| title.to_string()),
        image: None,
    };
    history.insert(0, entry.clone());
    commit(&app, &history);
    Ok(entry)
}

#[tauri::command]
pub fn update_clipboard_snippet(app: AppHandle, id: String, title: String, text: String) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Escreva o texto do item.".into());
    }
    let state = app.state::<AppState>();
    let mut history = state.clipboard_history.lock().unwrap();
    let entry = history
        .iter_mut()
        .find(|e| e.id == id && e.kind == EntryKind::Text)
        .ok_or("Item não encontrado.")?;
    let title = title.trim();
    entry.title = (!title.is_empty()).then(|| title.to_string());
    entry.text = text;
    commit(&app, &history);
    Ok(())
}

/// Puts an entry back on the system clipboard (text or image). The watcher
/// then sees the change and moves the entry to the top.
#[tauri::command]
pub fn copy_clipboard_entry(app: AppHandle, id: String) -> Result<(), String> {
    let entry = app
        .state::<AppState>()
        .clipboard_history
        .lock()
        .unwrap()
        .iter()
        .find(|e| e.id == id)
        .cloned()
        .ok_or("Item não encontrado.")?;
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    match entry.kind {
        EntryKind::Text => clipboard.set_text(entry.text).map_err(|e| e.to_string()),
        EntryKind::Image => {
            let path = image_path(&app, &entry.id).ok_or("Imagem não encontrada.")?;
            let png = std::fs::read(path).map_err(|_| "Imagem não encontrada.".to_string())?;
            let (width, height, rgba) = decode_png(&png)?;
            clipboard
                .set_image(arboard::ImageData {
                    width: width as usize,
                    height: height as usize,
                    bytes: Cow::Owned(rgba),
                })
                .map_err(|e| e.to_string())
        }
    }
}

/// An image entry's PNG, as raw bytes for the frontend's thumbnail.
#[tauri::command]
pub fn clipboard_image(app: AppHandle, id: String) -> Result<Response, String> {
    let path = image_path(&app, &id).ok_or("Imagem não encontrada.")?;
    let png = std::fs::read(path).map_err(|_| "Imagem não encontrada.".to_string())?;
    Ok(Response::new(png))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_round_trips() {
        let rgba: Vec<u8> = (0..4 * 3 * 2).map(|i| i as u8).collect();
        let png = encode_png(3, 2, &rgba).unwrap();
        assert_eq!(decode_png(&png).unwrap(), (3, 2, rgba));
    }

    #[test]
    fn hash_is_stable_and_content_based() {
        assert_eq!(fnv1a(b""), "cbf29ce484222325");
        assert_eq!(fnv1a(b"abc"), fnv1a(b"abc"));
        assert_ne!(fnv1a(b"abc"), fnv1a(b"abd"));
    }

    #[test]
    fn old_entries_without_new_fields_still_load() {
        let old = r#"[{"id":"1","text":"oi","created_at":5}]"#;
        let parsed: Vec<ClipboardEntry> = serde_json::from_str(old).unwrap();
        assert_eq!(parsed[0].kind, EntryKind::Text);
        assert!(!parsed[0].pinned);
        assert!(parsed[0].image.is_none());
    }
}
