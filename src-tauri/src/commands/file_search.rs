use crate::state::AppState;
use rayon::prelude::*;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Local-only placeholder for the real (server-enforced) paywall — same
/// approach as OCR's daily counter, but gating *result volume* per search
/// instead of uses per day, matching the roadmap's "heavy query volume"
/// framing for this tool's paid tier.
const MAX_RESULTS: usize = 200;
/// An index older than this is rebuilt in the background the next time the
/// tool asks for it (the old one keeps answering queries meanwhile). There's
/// no live filesystem watcher yet, so this is what bounds staleness.
const STALE_AFTER: Duration = Duration::from_secs(10 * 60);
/// Special root value meaning "every drive on this PC".
pub const ALL_DRIVES: &str = "*";
const NO_PARENT: u32 = u32::MAX;
const EXCLUDED_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    "$RECYCLE.BIN",
    "System Volume Information",
    "__pycache__",
    ".venv",
    "venv",
];

/// One file or folder in the index. Paths aren't stored — each entry only
/// knows its own name and its parent's slot, and the full path is rebuilt
/// on demand for the handful of entries actually shown. Keeps a
/// whole-drive index (~1M+ entries) in tens of MB instead of hundreds.
struct IndexEntry {
    name: Box<str>,
    name_lower: Box<str>,
    parent: u32,
    is_dir: bool,
}

struct FileIndex {
    root: String,
    entries: Vec<IndexEntry>,
    built_at_ms: u64,
    duration_ms: u64,
}

impl FileIndex {
    fn full_path(&self, mut idx: u32) -> PathBuf {
        let mut parts: Vec<&str> = Vec::new();
        while idx != NO_PARENT {
            let entry = &self.entries[idx as usize];
            parts.push(&entry.name);
            idx = entry.parent;
        }
        let mut path = PathBuf::new();
        for part in parts.iter().rev() {
            path.push(part);
        }
        path
    }
}

/// Everything-style search: instead of walking the disk on every keystroke,
/// the chosen root is scanned once into an in-memory index (in parallel, in
/// the background), and each query is then just a parallel substring scan
/// over names already in RAM — milliseconds even for a whole drive.
///
/// (Everything itself goes one step further and reads the NTFS Master File
/// Table directly, but that requires running as administrator — a normal
/// directory walk keeps ToolBox unprivileged.)
#[derive(Default)]
pub struct FileIndexStore {
    ready: RwLock<Option<Arc<FileIndex>>>,
    /// Root currently being (re)built, if any.
    building: Mutex<Option<String>>,
    /// Bumped on every new build; a build whose generation is no longer
    /// current stops early and throws its result away.
    generation: AtomicU64,
    progress: AtomicUsize,
}

#[derive(Serialize, Clone)]
pub struct FileSearchResult {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
}

#[derive(Serialize)]
pub struct FileSearchResponse {
    pub results: Vec<FileSearchResult>,
    pub total: usize,
    pub truncated: bool,
}

#[derive(Serialize)]
pub struct FileIndexStatus {
    /// Root of the index currently answering queries, if any.
    pub ready_root: Option<String>,
    pub count: usize,
    pub built_at: u64,
    pub duration_ms: u64,
    /// Root being indexed right now, if any.
    pub indexing_root: Option<String>,
    pub progress: usize,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The user's home directory, the tool's starting point before they pick
/// another folder.
#[tauri::command]
pub fn default_search_root() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string())
}

fn resolve_roots(root: &str) -> Vec<PathBuf> {
    if root == ALL_DRIVES {
        if cfg!(windows) {
            return (b'A'..=b'Z')
                .map(|letter| PathBuf::from(format!("{}:\\", letter as char)))
                .filter(|p| p.exists())
                .collect();
        }
        return vec![PathBuf::from("/")];
    }
    vec![PathBuf::from(root)]
}

fn status_of(store: &FileIndexStore) -> FileIndexStatus {
    let ready = store.ready.read().unwrap().clone();
    FileIndexStatus {
        ready_root: ready.as_ref().map(|i| i.root.clone()),
        count: ready.as_ref().map_or(0, |i| i.entries.len()),
        built_at: ready.as_ref().map_or(0, |i| i.built_at_ms),
        duration_ms: ready.as_ref().map_or(0, |i| i.duration_ms),
        indexing_root: store.building.lock().unwrap().clone(),
        progress: store.progress.load(Ordering::Relaxed),
    }
}

#[tauri::command]
pub fn file_index_status(state: tauri::State<'_, AppState>) -> FileIndexStatus {
    status_of(&state.file_index)
}

/// Makes sure an index for `root` exists: starts a background build when
/// there's none, it belongs to another root, it's stale, or `force` is set.
/// Returns immediately — the frontend polls `file_index_status`.
#[tauri::command]
pub fn ensure_file_index(
    state: tauri::State<'_, AppState>,
    root: String,
    force: bool,
) -> Result<FileIndexStatus, String> {
    let store = state.file_index.clone();
    let roots = resolve_roots(&root);
    if roots.is_empty() || roots.iter().any(|r| !r.is_dir()) {
        return Err(format!("Pasta não encontrada: {root}"));
    }

    {
        let mut building = store.building.lock().unwrap();
        if building.as_deref() == Some(root.as_str()) {
            return Ok(status_of(&store)); // already on it
        }
        let fresh = store.ready.read().unwrap().as_ref().is_some_and(|i| {
            i.root == root && now_ms().saturating_sub(i.built_at_ms) < STALE_AFTER.as_millis() as u64
        });
        if fresh && !force && building.is_none() {
            return Ok(status_of(&store));
        }
        *building = Some(root.clone());
    }

    let generation = store.generation.fetch_add(1, Ordering::SeqCst) + 1;
    store.progress.store(0, Ordering::Relaxed);
    // A new root replaces the old index outright rather than keeping both
    // in memory; a refresh of the same root keeps serving the old one.
    {
        let mut ready = store.ready.write().unwrap();
        if ready.as_ref().is_some_and(|i| i.root != root) {
            *ready = None;
        }
    }

    let store_for_build = store.clone();
    std::thread::spawn(move || {
        let start = Instant::now();
        let entries = build_index(&store_for_build, generation, &roots);
        if store_for_build.generation.load(Ordering::SeqCst) != generation {
            return; // superseded by a newer build, which owns `building` now
        }
        *store_for_build.ready.write().unwrap() = Some(Arc::new(FileIndex {
            root,
            entries,
            built_at_ms: now_ms(),
            duration_ms: start.elapsed().as_millis() as u64,
        }));
        *store_for_build.building.lock().unwrap() = None;
    });

    Ok(status_of(&store))
}

fn build_index(store: &FileIndexStore, generation: u64, roots: &[PathBuf]) -> Vec<IndexEntry> {
    let entries: Mutex<Vec<IndexEntry>> = Mutex::new(Vec::with_capacity(256 * 1024));
    rayon::scope(|scope| {
        for root in roots {
            let root_str = root.to_string_lossy().to_string();
            let idx = {
                let mut list = entries.lock().unwrap();
                list.push(IndexEntry {
                    name_lower: root_str.to_lowercase().into(),
                    name: root_str.into(),
                    parent: NO_PARENT,
                    is_dir: true,
                });
                (list.len() - 1) as u32
            };
            let root = root.clone();
            let entries = &entries;
            scope.spawn(move |s| walk_dir(s, store, generation, entries, idx, root));
        }
    });
    entries.into_inner().unwrap()
}

/// Reads one directory, appends its children to the index in a single
/// locked batch, then fans each subfolder out as its own rayon task.
/// `DirEntry::file_type` comes free with the directory listing on Windows
/// (no extra syscall per file), and reports junctions/symlinks as
/// non-directories — so link loops like "Application Data" aren't followed.
fn walk_dir<'s>(
    scope: &rayon::Scope<'s>,
    store: &'s FileIndexStore,
    generation: u64,
    entries: &'s Mutex<Vec<IndexEntry>>,
    dir_idx: u32,
    dir: PathBuf,
) {
    if store.generation.load(Ordering::Relaxed) != generation {
        return;
    }
    let Ok(read) = std::fs::read_dir(&dir) else {
        return;
    };
    let mut children: Vec<(String, bool)> = Vec::new();
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
        if is_dir && EXCLUDED_DIR_NAMES.iter().any(|ex| ex.eq_ignore_ascii_case(&name)) {
            continue;
        }
        children.push((name, is_dir));
    }
    if children.is_empty() {
        return;
    }

    let base = {
        let mut list = entries.lock().unwrap();
        let base = list.len() as u32;
        for (name, is_dir) in &children {
            list.push(IndexEntry {
                name_lower: name.to_lowercase().into(),
                name: name.as_str().into(),
                parent: dir_idx,
                is_dir: *is_dir,
            });
        }
        base
    };
    store.progress.fetch_add(children.len(), Ordering::Relaxed);

    for (i, (name, is_dir)) in children.into_iter().enumerate() {
        if is_dir {
            let child = dir.join(&name);
            scope.spawn(move |s| walk_dir(s, store, generation, entries, base + i as u32, child));
        }
    }
}

/// Queries the in-memory index. Space-separated terms must all appear in the
/// name (in any order), like Everything. Only the shown results touch the
/// disk (for size/date), so query cost doesn't depend on disk speed.
#[tauri::command]
pub async fn search_files(
    state: tauri::State<'_, AppState>,
    root: String,
    query: String,
    extension: Option<String>,
) -> Result<FileSearchResponse, String> {
    let terms: Vec<String> = query.split_whitespace().map(|t| t.to_lowercase()).collect();
    let ext_suffix = extension
        .map(|e| e.trim().trim_start_matches('.').to_lowercase())
        .filter(|e| !e.is_empty())
        .map(|e| format!(".{e}"));
    if terms.is_empty() && ext_suffix.is_none() {
        return Ok(FileSearchResponse {
            results: vec![],
            total: 0,
            truncated: false,
        });
    }
    let index = state
        .file_index
        .ready
        .read()
        .unwrap()
        .clone()
        .filter(|i| i.root == root)
        .ok_or_else(|| "O índice dessa pasta ainda está sendo criado.".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let first_term = terms.first().cloned().unwrap_or_default();
        let mut matches: Vec<(bool, u32)> = index
            .entries
            .par_iter()
            .enumerate()
            .filter(|(_, e)| e.parent != NO_PARENT)
            .filter(|(_, e)| match &ext_suffix {
                None => true,
                Some(suffix) => !e.is_dir && e.name_lower.ends_with(suffix.as_str()),
            })
            .filter(|(_, e)| terms.iter().all(|t| e.name_lower.contains(t.as_str())))
            .map(|(i, e)| (e.name_lower.starts_with(first_term.as_str()), i as u32))
            .collect();

        let total = matches.len();
        // Cheap two-tier relevance: names starting with the query first,
        // then alphabetical. Only the top slice is fully sorted.
        let cmp = |a: &(bool, u32), b: &(bool, u32)| {
            b.0.cmp(&a.0).then_with(|| {
                index.entries[a.1 as usize]
                    .name_lower
                    .cmp(&index.entries[b.1 as usize].name_lower)
            })
        };
        if matches.len() > MAX_RESULTS {
            matches.select_nth_unstable_by(MAX_RESULTS, cmp);
            matches.truncate(MAX_RESULTS);
        }
        matches.sort_unstable_by(cmp);

        let results = matches
            .into_iter()
            .filter_map(|(_, idx)| {
                let entry = &index.entries[idx as usize];
                let path = index.full_path(idx);
                // Also drops anything deleted since the index was built.
                let metadata = std::fs::symlink_metadata(&path).ok()?;
                Some(FileSearchResult {
                    name: entry.name.to_string(),
                    path: path.to_string_lossy().to_string(),
                    is_dir: entry.is_dir,
                    size: if entry.is_dir { 0 } else { metadata.len() },
                    modified: metadata
                        .modified()
                        .ok()
                        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                        .map_or(0, |d| d.as_millis() as u64),
                })
            })
            .collect();

        FileSearchResponse {
            results,
            total,
            truncated: total > MAX_RESULTS,
        }
    })
    .await
    .map_err(|e| format!("Falha na busca: {e}"))
}
