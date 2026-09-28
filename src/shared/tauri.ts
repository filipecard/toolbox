import { invoke } from "@tauri-apps/api/core";

export interface NoteMeta {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export function openBubble(toolId: string): Promise<void> {
  return invoke("open_bubble", { toolId });
}

export function setBubbleSize(size: number): Promise<void> {
  return invoke("set_bubble_size", { size });
}

export function listSystemFonts(): Promise<string[]> {
  return invoke("list_system_fonts");
}

/** A plan-limited allowance (see plans.rs). `limit: null` = unlimited. */
export interface Quota {
  used: number;
  limit: number | null;
  /** Display name of the plan that set this limit ("Grátis", "Prata"...). */
  plan: string;
}

export function featureQuota(feature: string): Promise<Quota> {
  return invoke("feature_quota", { feature });
}

export function consumeFeatureUse(feature: string): Promise<Quota> {
  return invoke("consume_feature_use", { feature });
}

export interface OcrResult {
  text: string;
  warning?: string;
  quota: Quota;
}

/** File uploads go as the raw IPC body (not a JSON number array — ~4x
 * smaller and no giant parse), other arguments as headers. Header values
 * must be ASCII, hence the URI-encoded file name. */
function invokeWithFile<T>(cmd: string, bytes: Uint8Array, headers: Record<string, string>): Promise<T> {
  return invoke<T>(cmd, bytes, { headers });
}

export function extractTextFromImage(bytes: Uint8Array, fileName: string): Promise<OcrResult> {
  return invokeWithFile("extract_text_from_image", bytes, { "x-file-name": encodeURIComponent(fileName) });
}

/** Compresses a PDF (embedded images re-encoded, structure optimized).
 * Consumes one of the compressor's daily uses. */
export async function compressPdf(bytes: Uint8Array, quality: number, maxDimension: number): Promise<Blob> {
  const out = await invokeWithFile<ArrayBuffer>("compress_pdf", bytes, {
    "x-quality": String(Math.round(quality * 100)),
    "x-max-dimension": String(maxDimension),
  });
  return new Blob([out], { type: "application/pdf" });
}

export function openQuickMenu(): Promise<void> {
  return invoke("open_quick_menu");
}

export function collapseQuickMenu(): Promise<void> {
  return invoke("collapse_quick_menu");
}

export function expandTool(toolId: string): Promise<void> {
  return invoke("expand_tool", { toolId });
}

export function collapseTool(toolId: string): Promise<void> {
  return invoke("collapse_tool", { toolId });
}

/** A tool id, or "notes" for the notes bar. Keeps the quick menu open. */
export function openFromQuickMenu(toolId: string): Promise<void> {
  return invoke("open_from_quick_menu", { toolId });
}

export function openNotesBar(): Promise<void> {
  return invoke("open_notes_bar");
}

export function collapseNotesBar(): Promise<void> {
  return invoke("collapse_notes_bar");
}

export function openNote(noteId: string): Promise<void> {
  return invoke("open_note", { noteId });
}

export function collapseNote(noteId: string): Promise<void> {
  return invoke("collapse_note", { noteId });
}

export function createNote(): Promise<NoteMeta> {
  return invoke("create_note");
}

export function listNotes(): Promise<NoteMeta[]> {
  return invoke("list_notes");
}

export function loadNote(id: string): Promise<string> {
  return invoke("load_note", { id });
}

export function saveNote(id: string, content: string): Promise<void> {
  return invoke("save_note", { id, content });
}

export function renameNote(id: string, title: string): Promise<void> {
  return invoke("rename_note", { id, title });
}

export function deleteNote(id: string): Promise<void> {
  return invoke("delete_note", { id });
}

export interface ClipboardEntry {
  id: string;
  kind: "text" | "image";
  /** Empty for images. */
  text: string;
  created_at: number;
  /** Fixado: kept out of the history cap and "Limpar histórico". */
  pinned: boolean;
  /** Set on hand-made snippets ("textos prontos"). */
  title?: string;
  image?: { width: number; height: number; hash: string };
}

export function listClipboardHistory(): Promise<ClipboardEntry[]> {
  return invoke("list_clipboard_history");
}

export function clearClipboardHistory(): Promise<void> {
  return invoke("clear_clipboard_history");
}

export function removeClipboardEntry(id: string): Promise<void> {
  return invoke("remove_clipboard_entry", { id });
}

export function setClipboardPinned(id: string, pinned: boolean): Promise<void> {
  return invoke("set_clipboard_pinned", { id, pinned });
}

export function addClipboardSnippet(title: string, text: string): Promise<ClipboardEntry> {
  return invoke("add_clipboard_snippet", { title, text });
}

export function updateClipboardSnippet(id: string, title: string, text: string): Promise<void> {
  return invoke("update_clipboard_snippet", { id, title, text });
}

/** Puts an entry (text or image) back on the system clipboard. */
export function copyClipboardEntry(id: string): Promise<void> {
  return invoke("copy_clipboard_entry", { id });
}

/** An image entry's PNG, for display. */
export async function clipboardImage(id: string): Promise<Blob> {
  const bytes = await invoke<ArrayBuffer>("clipboard_image", { id });
  return new Blob([bytes], { type: "image/png" });
}

export function searchNotes(query: string): Promise<string[]> {
  return invoke("search_notes", { query });
}

export interface ImportSummary {
  settings: boolean;
  notes: number;
  clipboard: number;
  reminders: number;
}

export function exportBackup(path: string): Promise<void> {
  return invoke("export_backup", { path });
}

export function importBackup(path: string): Promise<ImportSummary> {
  return invoke("import_backup", { path });
}

// --- Account (see src-tauri/src/account) ---

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export type AccountStatus =
  | { state: "loading" }
  | { state: "signed_out"; message: string | null }
  | { state: "pending"; user_code: string; verification_uri: string }
  | { state: "active"; user: AccountUser; offline: boolean; valid_until: number; diamond: boolean }
  | { state: "needs_connection"; user: AccountUser }
  | { state: "terms_required"; user: AccountUser }
  | { state: "dev_mode" };

export const ACCOUNT_CHANGED_EVENT = "account-changed";

export function accountStatus(): Promise<AccountStatus> {
  return invoke("account_status");
}

export function accountStartLogin(): Promise<AccountStatus> {
  return invoke("account_start_login");
}

export function accountCancelLogin(): Promise<void> {
  return invoke("account_cancel_login");
}

export function accountRetry(): Promise<AccountStatus> {
  return invoke("account_retry");
}

export function accountLogout(): Promise<void> {
  return invoke("account_logout");
}

/** Opens a page of the ToolBox website in the browser, e.g. "/conta". */
export function accountOpenSite(path: string): Promise<void> {
  return invoke("account_open_site", { path });
}

export function accountDevMode(): Promise<void> {
  return invoke("account_dev_mode");
}

export interface DependencyStatus {
  installed: boolean;
  version: string | null;
}

export interface DependencyProgress {
  id: string;
  stage: "downloading" | "extracting";
  downloaded: number;
  total: number;
}

export function dependencyStatus(id: string): Promise<DependencyStatus> {
  return invoke("dependency_status", { id });
}

export function installDependency(id: string): Promise<DependencyStatus> {
  return invoke("install_dependency", { id });
}

export interface ShortcutError {
  action: string;
  message: string;
}

/** Re-registers every global shortcut; returns the ones that failed. */
export function applyShortcuts(shortcuts: Record<string, string>): Promise<ShortcutError[]> {
  return invoke("apply_shortcuts", { shortcuts });
}

export interface TranscribeResult {
  text: string;
  quota: Quota;
}

export function getWhisperModelPath(): Promise<string | null> {
  return invoke("get_whisper_model_path");
}

export function setWhisperModelPath(path: string): Promise<void> {
  return invoke("set_whisper_model_path", { path });
}

export function transcribeAudio(bytes: Uint8Array, fileName: string, lang: string): Promise<TranscribeResult> {
  return invokeWithFile("transcribe_audio", bytes, {
    "x-file-name": encodeURIComponent(fileName),
    "x-lang": lang,
  });
}

export interface WhisperStatus {
  ready: boolean;
  binary_path?: string;
  model_path?: string;
}

export function whisperSetupStatus(): Promise<WhisperStatus> {
  return invoke("whisper_setup_status");
}

export function setupWhisper(): Promise<WhisperStatus> {
  return invoke("setup_whisper");
}

export interface ReminderItem {
  id: string;
  kind: "reminder" | "timer";
  message: string;
  due_at: number;
  created_at: number;
}

export function listReminders(): Promise<ReminderItem[]> {
  return invoke("list_reminders");
}

export function addReminder(
  kind: "reminder" | "timer",
  message: string,
  dueAt: number,
): Promise<ReminderItem> {
  return invoke("add_reminder", { kind, message, dueAt });
}

export function removeReminder(id: string): Promise<void> {
  return invoke("remove_reminder", { id });
}

export interface FileSearchResult {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

export interface FileSearchResponse {
  results: FileSearchResult[];
  total: number;
  truncated: boolean;
  /** How many results this search was allowed to show (plan limit). */
  limit: number;
}

export interface FileIndexStatus {
  ready_root: string | null;
  count: number;
  built_at: number;
  duration_ms: number;
  indexing_root: string | null;
  progress: number;
}

/** Root value meaning "every drive on this PC" (mirrors `ALL_DRIVES` in file_search.rs). */
export const ALL_DRIVES_ROOT = "*";

export function defaultSearchRoot(): Promise<string> {
  return invoke("default_search_root");
}

export function ensureFileIndex(root: string, force = false): Promise<FileIndexStatus> {
  return invoke("ensure_file_index", { root, force });
}

export function fileIndexStatus(): Promise<FileIndexStatus> {
  return invoke("file_index_status");
}

export function searchFiles(
  root: string,
  query: string,
  extension: string,
): Promise<FileSearchResponse> {
  return invoke("search_files", { root, query, extension: extension || null });
}
