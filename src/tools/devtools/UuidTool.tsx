import { useState } from "react";
import { v4 as uuidv4 } from "uuid";

export function UuidTool() {
  const [current, setCurrent] = useState(() => uuidv4());
  const [history, setHistory] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const generate = () => {
    const next = uuidv4();
    setCurrent(next);
    setHistory((h) => [next, ...h].slice(0, 10));
  };

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied((c) => (c === value ? null : c)), 1000);
  };

  return (
    <div className="dt-pane">
      <div className="dt-pass-output">
        <input className="dt-pass-field" value={current} readOnly spellCheck={false} />
        <button className="cp-copy-btn" onClick={() => copy(current)}>
          {copied === current ? "✓" : "Copiar"}
        </button>
      </div>
      <button className="var-add-btn" onClick={generate}>
        Gerar novo UUID
      </button>
      {history.length > 0 && (
        <div className="dt-uuid-history">
          <span className="cp-section-label">Recentes</span>
          {history.map((id) => (
            <div className="dt-hash-row" key={id}>
              <span className="dt-hash-value">{id}</span>
              <button className="cp-copy-btn" onClick={() => copy(id)}>
                {copied === id ? "✓" : "Copiar"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
