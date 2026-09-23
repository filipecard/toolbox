import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "../../shell/TitleBar";
import { collapseTool } from "../../shared/tauri";
import { JsonTool } from "./JsonTool";
import { Base64Tool } from "./Base64Tool";
import { HashTool } from "./HashTool";
import { PasswordTool } from "./PasswordTool";
import { UuidTool } from "./UuidTool";
import { RegexTool } from "./RegexTool";

const TABS = [
  { id: "json", label: "JSON" },
  { id: "base64", label: "Base64" },
  { id: "hash", label: "Hash" },
  { id: "password", label: "Senha" },
  { id: "uuid", label: "UUID" },
  { id: "regex", label: "Regex" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function DevToolsWindow({ toolId }: { toolId: string }) {
  const [tab, setTab] = useState<TabId>("json");

  return (
    <div className="panel devtools">
      <TitleBar
        title="Utilitários"
        onMinimize={() => void collapseTool(toolId)}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="panel-body dt-body">
        <div className="conv-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`conv-tab${tab === t.id ? " conv-tab-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "json" && <JsonTool />}
        {tab === "base64" && <Base64Tool />}
        {tab === "hash" && <HashTool />}
        {tab === "password" && <PasswordTool />}
        {tab === "uuid" && <UuidTool />}
        {tab === "regex" && <RegexTool />}
      </div>
    </div>
  );
}
