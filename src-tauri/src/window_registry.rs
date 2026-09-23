use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum WindowRole {
    Bubble,
    ToolCalculator,
    NotesBar,
    NoteEditor,
}

#[derive(Debug, Clone, Serialize)]
pub struct WindowMeta {
    pub role: WindowRole,
    pub tool_id: String,
}

#[derive(Default)]
pub struct WindowRegistry {
    windows: Mutex<HashMap<String, WindowMeta>>,
}

impl WindowRegistry {
    pub fn register(&self, label: &str, meta: WindowMeta) {
        self.windows.lock().unwrap().insert(label.to_string(), meta);
    }

    pub fn unregister(&self, label: &str) {
        self.windows.lock().unwrap().remove(label);
    }
}
