import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import { collapseNote } from "../../shared/tauri";
import { listNotes, loadNote, renameNote, saveNote, type NoteMeta } from "./notesApi";

export function NoteEditor({ noteId }: { noteId: string }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"saved" | "editing">("saved");
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    void loadNote(noteId).then(setContent);
    void listNotes().then((notes: NoteMeta[]) => {
      const meta = notes.find((n) => n.id === noteId);
      if (meta) setTitle(meta.title);
    });
  }, [noteId]);

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
      <textarea
        className="note-content"
        value={content}
        onChange={(e) => handleContentChange(e.target.value)}
        placeholder="Escreva aqui..."
      />
      <div className="note-status">{status === "saved" ? "Salvo" : "Salvando..."}</div>
    </div>
  );
}
