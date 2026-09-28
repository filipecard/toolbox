import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { TitleBar } from "../../shell/TitleBar";
import { collapseNote } from "../../shared/tauri";
import { listNotes, loadNote, renameNote, saveNote, type NoteMeta } from "./notesApi";

/** Markdown → HTML, sanitized: a note can hold text pasted from anywhere,
 * and this window can call app commands, so no script/handler survives. */
function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false, gfm: true, breaks: true });
  return DOMPurify.sanitize(html);
}

export function NoteEditor({ noteId }: { noteId: string }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"saved" | "editing">("saved");
  const [preview, setPreview] = useState(false);
  // Note windows are created always-on-top (see windows.rs's open_note).
  const [onTop, setOnTop] = useState(true);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    void loadNote(noteId).then(setContent);
    void listNotes().then((notes: NoteMeta[]) => {
      const meta = notes.find((n) => n.id === noteId);
      if (meta) setTitle(meta.title);
    });
  }, [noteId]);

  const html = useMemo(() => (preview ? renderMarkdown(content) : ""), [preview, content]);

  const scheduleSave = (nextContent: string) => {
    setStatus("editing");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveNote(noteId, nextContent).then(() => setStatus("saved"));
    }, 800);
  };

  const handleContentChange = (value: string) => {
    setContent(value);
    scheduleSave(value);
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    void renameNote(noteId, value);
  };

  const toggleOnTop = () => {
    const next = !onTop;
    void getCurrentWindow()
      .setAlwaysOnTop(next)
      .then(() => setOnTop(next));
  };

  // Links in the preview open in the default browser instead of
  // navigating this window away.
  const handlePreviewClick = (e: React.MouseEvent) => {
    const link = (e.target as HTMLElement).closest("a");
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute("href");
    if (href && /^https?:\/\//i.test(href)) void openUrl(href);
  };

  return (
    <div className="panel note-editor">
      <TitleBar
        title="Nota"
        onMinimize={() => void collapseNote(noteId)}
        onClose={() => void getCurrentWindow().close()}
      />
      <input
        className="note-title-input"
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        placeholder="Título da nota"
      />
      <div className="note-toolbar">
        <div className="conv-tabs">
          <button className={`conv-tab${!preview ? " conv-tab-active" : ""}`} onClick={() => setPreview(false)}>
            Editar
          </button>
          <button className={`conv-tab${preview ? " conv-tab-active" : ""}`} onClick={() => setPreview(true)}>
            Visualizar
          </button>
        </div>
        <button
          className={`note-pin${onTop ? " note-pin-on" : ""}`}
          onClick={toggleOnTop}
          title={onTop ? "Sempre por cima (clique para soltar)" : "Manter sempre por cima"}
        >
          📌
        </button>
      </div>
      {preview ? (
        // `html` is sanitized by DOMPurify in renderMarkdown.
        <div className="note-preview" onClick={handlePreviewClick} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <textarea
          className="note-content"
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder="Escreva aqui... Aceita Markdown: # título, **negrito**, - lista, [link](https://...)"
        />
      )}
      <div className="note-status">{status === "saved" ? "Salvo" : "Salvando..."}</div>
    </div>
  );
}
