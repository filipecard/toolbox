import { useEffect, useState } from "react";
import { computeHashes, type HashResults } from "./hash";

const ROWS: { key: keyof HashResults; label: string }[] = [
  { key: "md5", label: "MD5" },
  { key: "sha1", label: "SHA-1" },
  { key: "sha256", label: "SHA-256" },
  { key: "sha512", label: "SHA-512" },
];

export function HashTool() {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<HashResults | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!input) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      void computeHashes(input).then((r) => {
        if (!cancelled) setResults(r);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [input]);

  const copy = (key: string, value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1000);
  };

  return (
    <div className="dt-pane">
      <textarea
        className="dt-textarea dt-textarea-short"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Digite o texto..."
        spellCheck={false}
      />
      <div className="dt-hash-list">
        {ROWS.map((row) => (
          <div className="dt-hash-row" key={row.key}>
            <span className="dt-hash-label">{row.label}</span>
            <span className="dt-hash-value">{results?.[row.key] ?? "—"}</span>
            <button
              className="cp-copy-btn"
              disabled={!results}
              onClick={() => results && copy(row.key, results[row.key])}
            >
              {copied === row.key ? "✓" : "Copiar"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
