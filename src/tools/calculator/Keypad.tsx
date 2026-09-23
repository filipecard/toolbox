export type KeyAction = "clear" | "delete" | "equals" | "mem-add" | "mem-recall" | "mem-clear";

interface KeyDef {
  label: string;
  insert?: string;
  action?: KeyAction;
  variant?: "op" | "fn" | "mem" | "eq";
}

const ROWS: KeyDef[][] = [
  [
    { label: "MC", action: "mem-clear", variant: "mem" },
    { label: "MR", action: "mem-recall", variant: "mem" },
    { label: "M+", action: "mem-add", variant: "mem" },
    { label: "AC", action: "clear", variant: "op" },
    { label: "DEL", action: "delete", variant: "op" },
  ],
  [
    { label: "sin", insert: "sin(", variant: "fn" },
    { label: "cos", insert: "cos(", variant: "fn" },
    { label: "tan", insert: "tan(", variant: "fn" },
    { label: "(", insert: "(", variant: "op" },
    { label: ")", insert: ")", variant: "op" },
  ],
  [
    { label: "7", insert: "7" },
    { label: "8", insert: "8" },
    { label: "9", insert: "9" },
    { label: "÷", insert: "/", variant: "op" },
    { label: "√", insert: "sqrt(", variant: "fn" },
  ],
  [
    { label: "4", insert: "4" },
    { label: "5", insert: "5" },
    { label: "6", insert: "6" },
    { label: "×", insert: "*", variant: "op" },
    { label: "^", insert: "^", variant: "op" },
  ],
  [
    { label: "1", insert: "1" },
    { label: "2", insert: "2" },
    { label: "3", insert: "3" },
    { label: "−", insert: "-", variant: "op" },
    { label: "log", insert: "log10(", variant: "fn" },
  ],
  [
    { label: "0", insert: "0" },
    { label: ".", insert: "." },
    { label: "=", action: "equals", variant: "eq" },
    { label: "+", insert: "+", variant: "op" },
    { label: "ln", insert: "log(", variant: "fn" },
  ],
];

export function Keypad({
  onInsert,
  onAction,
}: {
  onInsert: (text: string) => void;
  onAction: (action: KeyAction) => void;
}) {
  return (
    <div className="keypad">
      {ROWS.map((row, i) => (
        <div className="keypad-row" key={i}>
          {row.map((key) => (
            <button
              key={key.label}
              className={`key key-${key.variant ?? "num"}`}
              onClick={() => (key.action ? onAction(key.action) : onInsert(key.insert ?? ""))}
            >
              {key.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
