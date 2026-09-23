import type { ReactNode } from "react";

export function TitleBar({
  title,
  onMinimize,
  onClose,
  children,
}: {
  title: string;
  onMinimize: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <span className="titlebar-title">{title}</span>
      <div className="titlebar-actions">
        {children}
        <button className="titlebar-btn" onClick={onMinimize} title="Minimizar">
          &#8211;
        </button>
        <button className="titlebar-btn titlebar-btn-close" onClick={onClose} title="Fechar">
          &times;
        </button>
      </div>
    </div>
  );
}
