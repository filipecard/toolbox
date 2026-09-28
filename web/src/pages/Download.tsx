import { useEffect, useMemo, useState } from "react";
import { DEPENDENCIES, TOOLS, type DownloadsResponse } from "@toolbox/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Loading, ToolDot, Window, formatBytes } from "../ui";

/** Pick the tools to install, then download. The app itself is one small
 * installer; what the selection changes is which tools show up in the app
 * and which heavy dependencies (OCR engine, voice model) it downloads. */
export function Download() {
  const { me, reload } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [releases, setReleases] = useState<DownloadsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // First visit: everything selected; afterwards, what was saved.
    setSelected(new Set(me?.tools.length ? me.tools : TOOLS.map((t) => t.id)));
  }, [me?.tools]);

  useEffect(() => {
    void api.downloads().then(setReleases).catch((e: Error) => setError(e.message));
  }, []);

  const neededDeps = useMemo(
    () => DEPENDENCIES.filter((d) => TOOLS.some((t) => selected.has(t.id) && t.dependencies.includes(d.id))),
    [selected],
  );
  const installer = releases?.app.find((r) => r.target === "windows-x64") ?? null;
  const extraMb = neededDeps.reduce((sum, d) => sum + d.approxSizeMb, 0);

  const toggle = (id: string) => {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const download = async () => {
    if (!installer) return;
    setBusy(true);
    setError(null);
    try {
      await api.setTools([...selected]);
      await reload();
      setSaved(true);
      const { url } = await api.downloadLink(installer.id);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível iniciar o download.");
    } finally {
      setBusy(false);
    }
  };

  if (!me) return <Loading />;

  return (
    <div className="page">
      <h1 className="page-title">Baixar o ToolBox</h1>
      <div className="download-layout">
        <Window title="Escolha suas ferramentas" width="wide">
          <p className="lead-small">
            Marque as que você quer ver no aplicativo. Você pode mudar isso depois nas configurações do app.
          </p>
          <div className="pick-actions">
            <button className="link-button" onClick={() => setSelected(new Set(TOOLS.map((t) => t.id)))}>
              Marcar todas
            </button>
            <button className="link-button" onClick={() => setSelected(new Set())}>
              Desmarcar todas
            </button>
          </div>
          <ul className="pick-list">
            {TOOLS.map((tool) => {
              const deps = DEPENDENCIES.filter((d) => tool.dependencies.includes(d.id));
              return (
                <li key={tool.id}>
                  <label className={`pick${selected.has(tool.id) ? " pick-on" : ""}`}>
                    <input type="checkbox" checked={selected.has(tool.id)} onChange={() => toggle(tool.id)} />
                    <ToolDot toolId={tool.id} size={32} />
                    <span className="pick-text">
                      <strong>{tool.name}</strong>
                      <span>{tool.description}</span>
                      {deps.length > 0 && (
                        <span className="pick-dep">
                          Baixa também {deps.map((d) => `${d.name} (~${d.approxSizeMb} MB)`).join(" e ")} na
                          primeira vez que for usada.
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Window>

        <Window title="Instalador" className="download-summary">
          {!releases && !error && <Loading />}
          {releases && !installer && (
            <Alert kind="info">O instalador ainda não foi publicado. Volte em breve.</Alert>
          )}
          {installer && (
            <>
              <dl className="facts">
                <div>
                  <dt>Versão</dt>
                  <dd>{installer.version}</dd>
                </div>
                <div>
                  <dt>Sistema</dt>
                  <dd>Windows 10 e 11 (64 bits)</dd>
                </div>
                <div>
                  <dt>Instalador</dt>
                  <dd>{formatBytes(installer.size)}</dd>
                </div>
                <div>
                  <dt>Ferramentas</dt>
                  <dd>{selected.size} de {TOOLS.length}</dd>
                </div>
                {extraMb > 0 && (
                  <div>
                    <dt>Dependências</dt>
                    <dd>~{extraMb} MB, baixadas quando usar</dd>
                  </div>
                )}
              </dl>
              {!me.user.emailVerified && (
                <Alert kind="info">Confirme seu e-mail antes de conectar o app (veja em Minha conta).</Alert>
              )}
              <Button onClick={() => void download()} busy={busy} disabled={selected.size === 0} className="btn-block">
                Baixar instalador
              </Button>
              {selected.size === 0 && <p className="fine">Marque pelo menos uma ferramenta.</p>}
              {saved && <p className="fine">Seleção salva na sua conta. O download começou.</p>}
              <details className="checksum">
                <summary>Verificar a integridade do arquivo</summary>
                <p className="fine">
                  SHA-256: <code>{installer.sha256}</code>
                </p>
              </details>
            </>
          )}
          {error && <Alert>{error}</Alert>}
        </Window>
      </div>
    </div>
  );
}
