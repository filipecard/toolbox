import { useState } from "react";
import { buildCharset, estimateStrength, generatePassword, type PasswordOptions } from "./password";

const DEFAULT_OPTIONS: PasswordOptions = {
  length: 16,
  lower: true,
  upper: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
};

type ToggleKey = "lower" | "upper" | "numbers" | "symbols" | "excludeAmbiguous";

const CHECKS: { key: ToggleKey; label: string }[] = [
  { key: "lower", label: "minúsculas (a-z)" },
  { key: "upper", label: "maiúsculas (A-Z)" },
  { key: "numbers", label: "números (0-9)" },
  { key: "symbols", label: "símbolos (!@#...)" },
  { key: "excludeAmbiguous", label: "excluir ambíguos (il1Lo0O)" },
];

export function PasswordTool() {
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_OPTIONS);
  const [password, setPassword] = useState(() => generatePassword(DEFAULT_OPTIONS));
  const [copied, setCopied] = useState(false);

  const regenerate = (next: PasswordOptions) => {
    setOptions(next);
    setPassword(generatePassword(next));
  };

  const toggle = (key: ToggleKey) => {
    const next = { ...options, [key]: !options[key] };
    // Never let every character source end up off — there'd be nothing left
    // to draw from, silently producing an empty "password".
    const anyLeft = next.lower || next.upper || next.numbers || next.symbols;
    if (!anyLeft && key !== "excludeAmbiguous") return;
    regenerate(next);
  };

  const copy = () => {
    void navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };

  const charsetSize = buildCharset(options).length;
  const strength = estimateStrength(password, charsetSize);

  return (
    <div className="dt-pane">
      <div className="dt-pass-output">
        <input className="dt-pass-field" value={password} readOnly spellCheck={false} />
        <button className="cp-copy-btn" onClick={copy}>
          {copied ? "✓" : "Copiar"}
        </button>
      </div>
      <p className="settings-hint">Força: {strength}</p>

      <div className="settings-row">
        <label className="settings-row-label">Tamanho</label>
        <input
          type="range"
          min={8}
          max={64}
          value={options.length}
          onChange={(e) => regenerate({ ...options, length: Number(e.target.value) })}
        />
        <span className="settings-row-value">{options.length}</span>
      </div>

      <div className="dt-pass-checks">
        {CHECKS.map((c) => (
          <label key={c.key} className="dt-check">
            <input type="checkbox" checked={options[c.key]} onChange={() => toggle(c.key)} />
            {c.label}
          </label>
        ))}
      </div>

      <button className="var-add-btn" onClick={() => regenerate(options)}>
        Gerar nova
      </button>
    </div>
  );
}
