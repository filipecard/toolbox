import { useRef, useState } from "react";
import type { Variable, VariableResult } from "./engine";

export function VariablesPanel({
  variables,
  results,
  onAdd,
  onRemove,
  onChangeExpr,
  onRename,
  onReorder,
  onInsertName,
}: {
  variables: Variable[];
  results: Record<string, VariableResult>;
  onAdd: (name: string, expr: string) => void;
  onRemove: (id: string) => void;
  onChangeExpr: (id: string, expr: string) => void;
  onRename: (id: string, name: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onInsertName: (name: string) => void;
}) {
  const dragIndex = useRef<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");

  const startEdit = (v: Variable) => {
    setEditingId(v.id);
    setDraftName(v.name);
  };

  const commitEdit = () => {
    if (editingId) onRename(editingId, draftName);
    setEditingId(null);
  };

  const handleAdd = () => {
    onAdd(newName, newValue);
    setNewName("");
    setNewValue("");
  };

  const handleNewKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAdd();
  };

  return (
    <div className="calc-variables">
      <div className="calc-variables-header">
        <span>Variáveis</span>
      </div>
      <div className="var-new-row">
        <input
          className="var-new-input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleNewKeyDown}
          placeholder="nome"
          spellCheck={false}
        />
        <input
          className="var-new-input"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={handleNewKeyDown}
          placeholder="valor"
          spellCheck={false}
        />
        <button className="var-add-btn" onClick={handleAdd} title="Adicionar variável">
          + Adicionar
        </button>
      </div>
      <div className="calc-variables-list">
        {variables.map((v, index) => {
          const result = results[v.id];
          return (
            <div
              key={v.id}
              className={`var-row${result?.error ? " var-row-error" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex.current !== null && dragIndex.current !== index) {
                  onReorder(dragIndex.current, index);
                }
                dragIndex.current = null;
              }}
            >
              <span
                className="var-drag-handle"
                draggable
                onDragStart={(e) => {
                  dragIndex.current = index;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(index));
                }}
                title="Arrastar para reordenar"
              >
                ⋮⋮
              </span>
              {editingId === v.id ? (
                <input
                  className="var-name-input"
                  value={draftName}
                  autoFocus
                  spellCheck={false}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <button
                  className="var-name-btn"
                  onClick={() => onInsertName(v.name)}
                  onDoubleClick={() => startEdit(v)}
                  title={`Clique para inserir · duplo clique para renomear`}
                >
                  {v.name}
                </button>
              )}
              <input
                className="var-expr-input"
                value={v.expr}
                onChange={(e) => onChangeExpr(v.id, e.target.value)}
                placeholder="valor ou expressão"
                spellCheck={false}
              />
              <span className="var-value">
                {result?.error ? "Erro" : result?.value !== undefined ? `= ${result.value}` : ""}
              </span>
              <button
                className="var-remove-btn"
                onClick={() => onRemove(v.id)}
                title="Remover variável"
              >
                &times;
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
