use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn notes_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("no app data dir")
        .join("notes")
}

fn ensure_notes_dir(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(notes_dir(app)).map_err(|e| e.to_string())
}

fn read_index(app: &AppHandle) -> Vec<NoteMeta> {
    let path = notes_dir(app).join("index.json");
    match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn write_index(app: &AppHandle, index: &[NoteMeta]) -> Result<(), String> {
    ensure_notes_dir(app)?;
    let dir = notes_dir(app);
    let tmp_path = dir.join("index.json.tmp");
    let final_path = dir.join("index.json");
    let json = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())
}

fn write_note_content(app: &AppHandle, id: &str, content: &str) -> Result<(), String> {
    ensure_notes_dir(app)?;
    let dir = notes_dir(app);
    let tmp_path = dir.join(format!("{id}.md.tmp"));
    let final_path = dir.join(format!("{id}.md"));
    fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_notes(app: AppHandle) -> Result<Vec<NoteMeta>, String> {
    ensure_notes_dir(&app)?;
    Ok(read_index(&app))
}

#[tauri::command]
pub fn create_note(app: AppHandle) -> Result<NoteMeta, String> {
    ensure_notes_dir(&app)?;
    let now = now_millis();
    let meta = NoteMeta {
        id: Uuid::new_v4().to_string(),
        title: "Nova nota".to_string(),
        created_at: now,
        updated_at: now,
    };

    let mut index = read_index(&app);
    index.insert(0, meta.clone());
    write_index(&app, &index)?;
    write_note_content(&app, &meta.id, "")?;
    let _ = app.emit("notes-changed", ());

    Ok(meta)
}

#[tauri::command]
pub fn load_note(app: AppHandle, id: String) -> Result<String, String> {
    let path = notes_dir(&app).join(format!("{id}.md"));
    match fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(_) => Ok(String::new()),
    }
}

#[tauri::command]
pub fn save_note(app: AppHandle, id: String, content: String) -> Result<(), String> {
    write_note_content(&app, &id, &content)?;

    let mut index = read_index(&app);
    if let Some(m) = index.iter_mut().find(|m| m.id == id) {
        m.updated_at = now_millis();
    }
    write_index(&app, &index)
}

#[tauri::command]
pub fn rename_note(app: AppHandle, id: String, title: String) -> Result<(), String> {
    let mut index = read_index(&app);
    if let Some(m) = index.iter_mut().find(|m| m.id == id) {
        m.title = title;
        m.updated_at = now_millis();
    }
    write_index(&app, &index)?;
    let _ = app.emit("notes-changed", ());
    Ok(())
}

#[tauri::command]
pub fn delete_note(app: AppHandle, id: String) -> Result<(), String> {
    let mut index = read_index(&app);
    index.retain(|m| m.id != id);
    write_index(&app, &index)?;

    let path = notes_dir(&app).join(format!("{id}.md"));
    let _ = fs::remove_file(path);
    let _ = app.emit("notes-changed", ());
    Ok(())
}
