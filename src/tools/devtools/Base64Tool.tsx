import { useState } from "react";

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function fromBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function Base64Tool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const encode = () => {
    setOutput(toBase64(input));
    setError(null);
  };

  const decode = () => {
    try {
      setOutput(fromBase64(input.trim()));
      setError(null);
    } catch {
      setError("Texto não é um Base64 válido.");
      setOutput("");
    }
  };

  return (
    <div className="dt-pane">
      <textarea
        className="dt-textarea"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Texto ou Base64..."
        spellCheck={false}
      />
      <div className="dt-actions">
        <button className="var-add-btn" onClick={encode}>
          Codificar
        </button>
        <button className="var-add-btn" onClick={decode}>
          Decodificar
        </button>
      </div>
      {error && <p className="ocr-error">{error}</p>}
      <textarea className="dt-textarea" value={output} readOnly placeholder="Resultado" />
      {output && (
        <button className="var-add-btn" onClick={() => void navigator.clipboard.writeText(output)}>
          Copiar
        </button>
      )}
    </div>
  );
}
