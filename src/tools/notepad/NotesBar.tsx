import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import { useWindowMove } from "../../shell/useWindowMove";
import { collapseNotesBar } from "../../shared/tauri";
import { createNote, deleteNote, listNotes, openNote, type NoteMeta } from "./notesApi";

export function NotesBar() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  useWindowMove("notes-bar.pos");

  const refresh = () => {
    void listNotes().then(setNotes);
  };

  useEffect(refresh, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("notes-changed", refresh).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const handleCreate = async () => {
    const note = await createNote();
    refresh();
    await openNote(note.id);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteNote(id);
    refresh();
  };

  return (
    <div className="panel notes-bar">
      <TitleBar
        title="Notas"
        onMinimize={() => void collapseNotesBar()}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="notes-strip">
        {notes.map((note) => (
          <button key={note.id} className="note-tab" onClick={() => void openNote(note.id)}>
            <span className="note-tab-title">{note.title || "Sem título"}</span>
            <span className="note-tab-close" onClick={(e) => void handleDelete(note.id, e)}>
              &times;
            </span>
          </button>
        ))}
        <button className="note-tab note-tab-add" onClick={() => void handleCreate()}>
          + Nova
        </button>
      </div>
    </div>
  );
}
