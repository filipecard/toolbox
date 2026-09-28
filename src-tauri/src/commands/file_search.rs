use crate::plans::{self, Feature};
use crate::state::AppState;
use rayon::prelude::*;
use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// Results per search are capped by the plan (see plans.rs). Diamante has
/// no plan cap, but each shown result costs a disk stat (size/date), so
/// this technical ceiling keeps a one-letter query on a whole drive from
/// stalling the UI.
const TECHNICAL_MAX_RESULTS: usize = 20_000;
/// On-disk copy of the last built index (see `save_cache`/`load_cache`).
const CACHE_FILE: &str = "file-index.bin";
const CACHE_MAGIC: &[u8; 6] = b"TBIDX1";
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
    /// How many results this search was allowed to show.
    pub limit: usize,
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
    app: AppHandle,
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
    let cache_path = app.path().app_cache_dir().ok().map(|dir| dir.join(CACHE_FILE));
    std::thread::spawn(move || {
        // After an app restart there's no index in memory: serve the last
        // saved one right away (possibly a bit stale) while the fresh walk
        // below runs, instead of making the user wait for a full rescan.
        let has_index = store_for_build.ready.read().unwrap().is_some();
        if !has_index {
            if let Some(cached) = cache_path.as_deref().and_then(|p| load_cache(p, &root)) {
                let mut ready = store_for_build.ready.write().unwrap();
                if ready.is_none() && store_for_build.generation.load(Ordering::SeqCst) == generation {
                    *ready = Some(Arc::new(cached));
                }
            }
        }

        let start = Instant::now();
        let entries = build_index(&store_for_build, generation, &roots);
        if store_for_build.generation.load(Ordering::SeqCst) != generation {
            return; // superseded by a newer build, which owns `building` now
        }
        let index = Arc::new(FileIndex {
            root,
            entries,
            built_at_ms: now_ms(),
            duration_ms: start.elapsed().as_millis() as u64,
        });
        *store_for_build.ready.write().unwrap() = Some(index.clone());
        *store_for_build.building.lock().unwrap() = None;
        if let Some(path) = cache_path {
            if let Err(e) = save_cache(&path, &index) {
                eprintln!("file search: failed to save index cache: {e}");
            }
        }
    });

    Ok(status_of(&store))
}

/// Plain binary layout: magic, root, timestamps, then each entry as
/// (parent u32, is_dir u8, name length u16, UTF-8 name). `name_lower` isn't
/// stored — it's recomputed on load, keeping the file about half the size.
fn save_cache(path: &Path, index: &FileIndex) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // Written to a temp file and renamed, so a crash mid-write can't leave
    // a truncated cache behind.
    let tmp = path.with_extension("tmp");
    {
        let mut w = BufWriter::new(File::create(&tmp)?);
        w.write_all(CACHE_MAGIC)?;
        write_bytes(&mut w, index.root.as_bytes())?;
        w.write_all(&index.built_at_ms.to_le_bytes())?;
        w.write_all(&index.duration_ms.to_le_bytes())?;
        w.write_all(&(index.entries.len() as u32).to_le_bytes())?;
        for e in &index.entries {
            w.write_all(&e.parent.to_le_bytes())?;
            w.write_all(&[e.is_dir as u8])?;
            let name = e.name.as_bytes();
            let len = name.len().min(u16::MAX as usize);
            w.write_all(&(len as u16).to_le_bytes())?;
            w.write_all(&name[..len])?;
        }
        w.flush()?;
    }
    std::fs::rename(tmp, path)
}

fn write_bytes(w: &mut impl Write, bytes: &[u8]) -> std::io::Result<()> {
    w.write_all(&(bytes.len() as u32).to_le_bytes())?;
    w.write_all(bytes)
}

/// Returns the cached index only if it was built for `root`.
fn load_cache(path: &Path, root: &str) -> Option<FileIndex> {
    let mut r = BufReader::new(File::open(path).ok()?);
    let mut magic = [0u8; 6];
    r.read_exact(&mut magic).ok()?;
    if &magic != CACHE_MAGIC {
        return None;
    }
    let cached_root = String::from_utf8(read_bytes(&mut r)?).ok()?;
    if cached_root != root {
        return None;
    }
    let built_at_ms = u64::from_le_bytes(read_array(&mut r)?);
    let duration_ms = u64::from_le_bytes(read_array(&mut r)?);
    let count = u32::from_le_bytes(read_array(&mut r)?) as usize;
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        let parent = u32::from_le_bytes(read_array(&mut r)?);
        let [is_dir] = read_array::<1>(&mut r)?;
        let len = u16::from_le_bytes(read_array(&mut r)?) as usize;
        let mut name = vec![0u8; len];
        r.read_exact(&mut name).ok()?;
        let name = String::from_utf8_lossy(&name).into_owned();
        entries.push(IndexEntry {
            name_lower: name.to_lowercase().into(),
            name: name.into(),
            parent,
            is_dir: is_dir != 0,
        });
    }
    // A corrupt parent pointer would make full_path index out of bounds.
    if entries.iter().any(|e| e.parent != NO_PARENT && e.parent as usize >= count) {
        return None;
    }
    Some(FileIndex {
        root: cached_root,
        entries,
        built_at_ms,
        duration_ms,
    })
}

fn read_array<const N: usize>(r: &mut impl Read) -> Option<[u8; N]> {
    let mut buf = [0u8; N];
    r.read_exact(&mut buf).ok()?;
    Some(buf)
}

fn read_bytes(r: &mut impl Read) -> Option<Vec<u8>> {
    let len = u32::from_le_bytes(read_array(r)?) as usize;
    if len > 64 * 1024 {
        return None;
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).ok()?;
    Some(buf)
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
    app: AppHandle,
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
            limit: 0,
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

    let max_results = plans::limit(&app, Feature::FileSearchResults)
        .map_or(TECHNICAL_MAX_RESULTS, |l| (l as usize).min(TECHNICAL_MAX_RESULTS));

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
        if matches.len() > max_results {
            matches.select_nth_unstable_by(max_results, cmp);
            matches.truncate(max_results);
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
            truncated: total > max_results,
            limit: max_results,
        }
    })
    .await
    .map_err(|e| format!("Falha na busca: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, parent: u32, is_dir: bool) -> IndexEntry {
        IndexEntry {
            name: name.into(),
            name_lower: name.to_lowercase().into(),
            parent,
            is_dir,
        }
    }

    #[test]
    fn cache_round_trips_and_checks_root() {
        let index = FileIndex {
            root: r"C:\Users\teste".into(),
            entries: vec![
                entry(r"C:\Users\teste", NO_PARENT, true),
                entry("Documentos", 0, true),
                entry("Relatório Final.PDF", 1, false),
            ],
            built_at_ms: 123,
            duration_ms: 45,
        };
        let path = std::env::temp_dir().join(format!("toolbox-index-test-{}.bin", std::process::id()));
        save_cache(&path, &index).unwrap();

        let loaded = load_cache(&path, r"C:\Users\teste").expect("cache should load");
        assert_eq!(loaded.entries.len(), 3);
        assert_eq!(&*loaded.entries[2].name, "Relatório Final.PDF");
        assert_eq!(&*loaded.entries[2].name_lower, "relatório final.pdf");
        assert_eq!(loaded.built_at_ms, 123);
        assert_eq!(loaded.full_path(2), PathBuf::from(r"C:\Users\teste\Documentos\Relatório Final.PDF"));

        assert!(load_cache(&path, r"D:\outra").is_none(), "other root must not load");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn corrupt_cache_is_rejected() {
        let path = std::env::temp_dir().join(format!("toolbox-index-bad-{}.bin", std::process::id()));
        std::fs::write(&path, b"TBIDX1\xff\xff\xff\xff").unwrap();
        assert!(load_cache(&path, "x").is_none());
        let _ = std::fs::remove_file(path);
    }
}
