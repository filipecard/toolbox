import { useEffect, useLayoutEffect, useRef, useState } from "react";

const POPOVER_WIDTH = 260;
const POPOVER_EST_HEIGHT = 300; // matches .ssel-popover's max-height
const VIEWPORT_MARGIN = 8;

export interface SearchableSelectOption {
  id: string;
  label: string;
  /** Optional secondary line shown smaller/muted below `label` in the
   * option list (e.g. a currency's full name under its code) — keeps the
   * primary label short so rows don't look cramped or get ellipsis-cut. */
  sublabel?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}

/** A `<select>` replacement for lists too long to scan by eye (currency
 * codes, unit names): a trigger button that opens a small searchable
 * popover instead of the browser's native (unsearchable, unstyleable)
 * dropdown. Reused across tools wherever picking from a long option list
 * comes up. */
export function SearchableSelect({ options, value, onChange, placeholder }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.id === value);

  // Positions the popover with `position: fixed` (viewport-relative, so it
  // can't be clipped by a scrolling ancestor) computed from the trigger's
  // actual position — flips left/right and up/down as needed so it always
  // stays fully inside the tool window, even a small one. Runs before
  // paint (useLayoutEffect) so it never flashes at the wrong spot first.
  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      setPopoverPos(null);
      return;
    }
    const rect = rootRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const width = Math.min(POPOVER_WIDTH, viewportW - VIEWPORT_MARGIN * 2);

    let left = rect.right - width;
    if (left < VIEWPORT_MARGIN) left = rect.left;
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), viewportW - width - VIEWPORT_MARGIN);

    let top = rect.bottom + 6;
    if (top + POPOVER_EST_HEIGHT > viewportH - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, rect.top - POPOVER_EST_HEIGHT - 6);
    }

    setPopoverPos({ top, left, width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const raf = requestAnimationFrame(() => searchRef.current?.focus());

    const handlePointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const filtered = options.filter((o) =>
    `${o.label} ${o.sublabel ?? ""} ${o.id}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const commitFirstMatch = () => {
    if (filtered.length === 0) return;
    onChange(filtered[0].id);
    setOpen(false);
  };

  return (
    <div className="ssel-root" ref={rootRef}>
      <button type="button" className="ssel-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="ssel-trigger-label">
          {selected ? `${selected.label}${selected.sublabel ? ` (${selected.sublabel})` : ""}` : placeholder ?? "Selecionar"}
        </span>
        <span className="ssel-trigger-caret">{open ? "▴" : "▾"}</span>
      </button>
      {open && popoverPos && (
        <div
          className="ssel-popover"
          style={{ top: popoverPos.top, left: popoverPos.left, width: popoverPos.width }}
        >
          <input
            ref={searchRef}
            className="ssel-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitFirstMatch();
            }}
            placeholder="Buscar..."
            spellCheck={false}
          />
          <div className="ssel-options">
            {filtered.length === 0 && <div className="ssel-empty">Nenhum resultado</div>}
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`ssel-option${o.id === value ? " ssel-option-active" : ""}`}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
              >
                <span className="ssel-option-label">{o.label}</span>
                {o.sublabel && <span className="ssel-option-sublabel">({o.sublabel})</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
