import { useId, useMemo, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { TOOL_VISUALS } from "./toolVisuals";

/** The site's one container: a ToolBox app window — black panel, title bar
 * with the window's name. Everything lives in these, floating on the page
 * like the tools float on the desktop. */
export function Window({
  title,
  actions,
  children,
  width = "normal",
  className = "",
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  width?: "narrow" | "normal" | "wide";
  className?: string;
}) {
  const headingId = useId();
  return (
    <section className={`window window-${width} ${className}`} aria-labelledby={headingId}>
      <header className="window-bar">
        <h2 id={headingId} className="window-title">
          {title}
        </h2>
        {actions && <div className="window-actions">{actions}</div>}
      </header>
      <div className="window-body">{children}</div>
    </section>
  );
}

export function Button({
  variant = "primary",
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "danger"; busy?: boolean }) {
  return (
    <button {...rest} className={`btn btn-${variant} ${rest.className ?? ""}`} disabled={rest.disabled || busy} aria-busy={busy}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} {...input} aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "success" | "info"; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

/** A tool's quick-menu circle. */
export function ToolDot({ toolId, size = 36 }: { toolId: string; size?: number }) {
  const v = TOOL_VISUALS[toolId];
  if (!v) return null;
  return (
    <span className="tool-dot" style={{ background: v.color, width: size, height: size }} aria-hidden="true">
      {v.icon ? (
        <img src={v.icon} alt="" className={v.mono ? "tool-dot-mono" : undefined} />
      ) : (
        <span style={{ fontSize: size * 0.5 }}>{v.emoji}</span>
      )}
    </span>
  );
}

export function Markdown({ source }: { source: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }) as string),
    [source],
  );
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Loading({ label = "Carregando…" }: { label?: string }) {
  return (
    <p className="loading" role="status">
      <span className="loading-dot" aria-hidden="true" />
      {label}
    </p>
  );
}

export function formatDate(ms: number, withTime = false): string {
  return new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
