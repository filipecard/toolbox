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

export interface OcrQuota {
  used: number;
  limit: number;
}

export interface OcrResult {
  text: string;
  warning?: string;
  used: number;
  limit: number;
}

export function ocrQuota(): Promise<OcrQuota> {
  return invoke("ocr_quota");
}

export function extractTextFromImage(bytes: number[], fileName: string): Promise<OcrResult> {
  return invoke("extract_text_from_image", { bytes, fileName });
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
  text: string;
  created_at: number;
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

export interface CompressorQuota {
  used: number;
  limit: number;
}

export function compressorQuota(): Promise<CompressorQuota> {
  return invoke("compressor_quota");
}

export function consumeCompressorUse(): Promise<CompressorQuota> {
  return invoke("consume_compressor_use");
}

export interface TranscribeQuota {
  used: number;
  limit: number;
}

export interface TranscribeResult {
  text: string;
  used: number;
  limit: number;
}

export function transcribeQuota(): Promise<TranscribeQuota> {
  return invoke("transcribe_quota");
}

export function getWhisperModelPath(): Promise<string | null> {
  return invoke("get_whisper_model_path");
}

export function setWhisperModelPath(path: string): Promise<void> {
  return invoke("set_whisper_model_path", { path });
}

export function transcribeAudio(
  bytes: number[],
  fileName: string,
  lang: string,
): Promise<TranscribeResult> {
  return invoke("transcribe_audio", { bytes, fileName, lang });
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
