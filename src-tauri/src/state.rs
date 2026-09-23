use crate::commands::clipboard::ClipboardEntry;
use crate::commands::file_search::FileIndexStore;
use crate::window_registry::WindowRegistry;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct AppState {
    pub registry: WindowRegistry,
    /// Set right before `open_quick_menu` programmatically repositions the
    /// quick-menu window (to re-anchor it next to the bubble), so its
    /// `Moved` event handler can tell that reposition apart from a genuine
    /// user drag and skip persisting it as the bubble's new position.
    pub quick_menu_self_move: AtomicBool,
    /// Debounces persisting quick-menu drags: each `Moved` event bumps this,
    /// and a delayed write only applies if it's still the latest one by the
    /// time its delay elapses.
    pub quick_menu_move_gen: AtomicU64,
    /// Bumped on every quick-menu open/close so `collapse_quick_menu`'s
    /// deferred hide can tell it was superseded by a reopen.
    pub quick_menu_visibility_gen: AtomicU64,
    /// Snapshot of (bar_x, bar_y, bubble_x, bubble_y) taken whenever the
    /// quick-menu bar is (re)anchored next to the bubble on open. A later
    /// drag of the bar moves the bubble by the same delta from this
    /// snapshot, rather than snapping the bubble straight to the bar's own
    /// (offset) corner — which is a position the bubble was never actually
    /// at, and reads as a teleport instead of "the bubble followed the bar".
    pub quick_menu_anchor: Mutex<Option<(f64, f64, f64, f64)>>,
    /// In-memory mirror of the clipboard history persisted to store.json —
    /// kept here (not just read from disk per-call) so the background
    /// watcher thread and the `list_clipboard_history` command share one
    /// source of truth without racing disk I/O.
    pub clipboard_history: Mutex<Vec<ClipboardEntry>>,
    /// In-memory index behind the file-search tool — an `Arc` so the
    /// background indexing thread can outlive the command that started it.
    pub file_index: Arc<FileIndexStore>,
}
