import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import { useWindowMove } from "../../shell/useWindowMove";
import { collapseNotesBar } from "../../shared/tauri";
import { createNote, deleteNote, listNotes, openNote, searchNotes, type NoteMeta } from "./notesApi";

export function NotesBar() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [query, setQuery] = useState("");
  /** Ids matching the search (title or content), or null when not searching. */
  const [matches, setMatches] = useState<Set<string> | null>(null);
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

  // Debounced full-text search, re-run when notes change too.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setMatches(null);
      return;
    }
    const id = setTimeout(() => {
      void searchNotes(q).then((ids) => setMatches(new Set(ids)));
    }, 200);
    return () => clearTimeout(id);
  }, [query, notes]);

  const visible = matches ? notes.filter((n) => matches.has(n.id)) : notes;

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
        <input
          className="notes-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 Buscar"
          title="Busca no título e no conteúdo das notas"
          spellCheck={false}
        />
        {matches && visible.length === 0 && <span className="notes-no-match">Nada encontrado</span>}
        {visible.map((note) => (
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
