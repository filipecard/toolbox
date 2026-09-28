import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import { collapseTool } from "../../shared/tauri";
import { formatLimit, planLabel, usePlanStatus } from "../../shared/plans";
import { buildVariableScope, evaluateExpression, type Variable } from "./engine";
import { Keypad, type KeyAction } from "./Keypad";
import { VariablesPanel } from "./VariablesPanel";
import { loadCalcState, saveCalcState, type HistoryEntry } from "./calcStorage";

export function CalculatorWindow({ toolId }: { toolId: string }) {
  const [expression, setExpression] = useState("");
  const [preview, setPreview] = useState("");
  const [memory, setMemory] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const nextVarNum = useRef(1);
  // Nothing is saved until the stored state has been loaded, or the empty
  // initial state would overwrite it.
  const [loaded, setLoaded] = useState(false);
  const plan = usePlanStatus();
  const varLimit = plan ? plan.limits.calcVariables : 0;
  const atVarLimit = varLimit !== null && variables.length >= varLimit;

  const { scope, results } = useMemo(
    () => buildVariableScope(variables, memory),
    [variables, memory],
  );

  useEffect(() => {
    void loadCalcState()
      .then((saved) => {
        if (!saved) return;
        const vars = saved.variables ?? [];
        setVariables(vars);
        setHistory(saved.history ?? []);
        setMemory(saved.memory ?? 0);
        setExpression(saved.expression ?? "");
        // Keeps auto-generated names (variavel_01...) from colliding with
        // restored ones.
        nextVarNum.current = vars.length + 1;
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded) saveCalcState({ expression, memory, history, variables });
  }, [loaded, expression, memory, history, variables]);

  // The preview depends on variables/memory too, which may arrive after
  // the expression when state is restored.
  useEffect(() => {
    setPreview(expression ? evaluateExpression(expression, scope) : "");
  }, [scope]);

  const updateExpression = (next: string) => {
    setExpression(next);
    setPreview(next ? evaluateExpression(next, scope) : "");
  };

  const handleInsert = (text: string) => updateExpression(expression + text);

  const handleAction = (action: KeyAction) => {
    switch (action) {
      case "clear":
        updateExpression("");
        break;
      case "delete":
        updateExpression(expression.slice(0, -1));
        break;
      case "equals": {
        const result = evaluateExpression(expression, scope);
        if (expression.trim() && result !== "Erro") {
          setHistory((h) => [{ expression, result }, ...h].slice(0, 50));
          updateExpression(result);
        }
        break;
      }
      case "mem-add": {
        const value = Number(preview || evaluateExpression(expression, scope));
        if (Number.isFinite(value)) setMemory((m) => m + value);
        break;
      }
      case "mem-recall":
        updateExpression(expression + "M");
        break;
      case "mem-clear":
        setMemory(0);
        break;
    }
  };

  const handleAddVariable = (rawName: string, rawExpr: string) => {
    if (atVarLimit) return;
    const trimmedName = rawName.trim();
    const isValidName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedName);
    const isTaken = isValidName && variables.some((v) => v.name === trimmedName);

    let name = trimmedName;
    if (!isValidName || isTaken) {
      name = `variavel_${String(nextVarNum.current).padStart(2, "0")}`;
      nextVarNum.current += 1;
    }

    setVariables((vars) => [...vars, { id: uuidv4(), name, expr: rawExpr.trim() }]);
  };

  const handleRemoveVariable = (id: string) => {
    setVariables((vars) => vars.filter((v) => v.id !== id));
  };

  const handleChangeVariableExpr = (id: string, expr: string) => {
    setVariables((vars) => vars.map((v) => (v.id === id ? { ...v, expr } : v)));
  };

  const handleRenameVariable = (id: string, rawName: string) => {
    const name = rawName.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
    setVariables((vars) => {
      if (vars.some((v) => v.id !== id && v.name === name)) return vars;
      return vars.map((v) => (v.id === id ? { ...v, name } : v));
    });
  };

  const handleReorderVariables = (fromIndex: number, toIndex: number) => {
    setVariables((vars) => {
      const next = [...vars];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  return (
    <div className="panel calculator">
      <TitleBar
        title="Calculadora"
        onMinimize={() => void collapseTool(toolId)}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="panel-body">
        <div className="calc-display">
          <input
            className="calc-expression"
            value={expression}
            onChange={(e) => updateExpression(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAction("equals");
            }}
            placeholder="0"
            spellCheck={false}
          />
          <div className="calc-preview">{preview}</div>
        </div>
        <Keypad onInsert={handleInsert} onAction={handleAction} />
        <VariablesPanel
          variables={variables}
          results={results}
          onAdd={handleAddVariable}
          onRemove={handleRemoveVariable}
          onChangeExpr={handleChangeVariableExpr}
          onRename={handleRenameVariable}
          onReorder={handleReorderVariables}
          onInsertName={handleInsert}
          atLimit={atVarLimit}
          limitHint={
            plan
              ? `Plano ${planLabel(plan, "calculator")}: ${variables.length}/${formatLimit(varLimit)} variáveis${
                  atVarLimit ? " — faça upgrade para adicionar mais" : ""
                }`
              : ""
          }
        />
        <div className="calc-history">
          {history.map((entry, i) => (
            <div key={i} className="calc-history-entry">
              <span className="calc-history-expr">{entry.expression}</span>
              <span className="calc-history-result">= {entry.result}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
