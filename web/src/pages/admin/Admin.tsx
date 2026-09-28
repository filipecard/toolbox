import { useCallback, useEffect, useState, type FormEvent } from "react";
import { NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router";
import {
  DEPENDENCIES,
  PAID_TIER_LABELS,
  TOOLS,
  toolName,
  type AdminUserDetail,
  type AdminUserSummary,
  type AuditEntry,
  type PaidTier,
  type Paginated,
  type Release,
  type TermsVersion,
} from "@toolbox/shared";
import { api, ApiError } from "../../api";
import { useAuth } from "../../auth";
import { Alert, Button, Field, Loading, Markdown, ToolDot, Window, formatBytes, formatDate } from "../../ui";

function errorText(e: unknown) {
  return e instanceof ApiError ? e.message : "Algo deu errado.";
}

export function Admin() {
  return (
    <div className="page">
      <h1 className="page-title">Administração</h1>
      <nav className="tabs" aria-label="Seções do admin">
        <NavLink to="/admin" end>
          Usuários
        </NavLink>
        <NavLink to="/admin/termos">Termos</NavLink>
        <NavLink to="/admin/versoes">Versões</NavLink>
        <NavLink to="/admin/auditoria">Auditoria</NavLink>
      </nav>
      <Routes>
        <Route index element={<Users />} />
        <Route path="usuarios/:id" element={<UserDetail />} />
        <Route path="termos" element={<TermsAdmin />} />
        <Route path="versoes" element={<Releases />} />
        <Route path="auditoria" element={<Audit />} />
      </Routes>
    </div>
  );
}

// --- Users ---

function Users() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const page = Number(params.get("p")) || 1;
  const [data, setData] = useState<Paginated<AdminUserSummary> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setData(null);
    void api.admin.users(q, page).then(setData);
  }, [q, page]);

  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setParams({ q: String(new FormData(e.currentTarget).get("q")) });
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / 25)) : 1;

  return (
    <Window title="Usuários" width="wide">
      <form onSubmit={search} className="inline-form" role="search">
        <Field label="Buscar por nome ou e-mail" name="q" defaultValue={q} type="search" />
        <Button type="submit">Buscar</Button>
      </form>
      {!data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <p className="lead-small">Nenhum usuário encontrado.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Usuário</th>
                <th scope="col">Situação</th>
                <th scope="col">Planos ativos</th>
                <th scope="col">Último acesso</th>
                <th scope="col">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id} className="row-link" onClick={() => navigate(`/admin/usuarios/${u.id}`)}>
                  <td>
                    <NavLink to={`/admin/usuarios/${u.id}`} onClick={(e) => e.stopPropagation()}>
                      {u.name}
                    </NavLink>
                    <span className="cell-sub">{u.email}</span>
                  </td>
                  <td>
                    {u.status === "blocked" ? (
                      <span className="tag tag-danger">Bloqueado</span>
                    ) : u.emailVerified ? (
                      <span className="tag tag-muted">Ativo</span>
                    ) : (
                      <span className="tag tag-muted">E-mail não confirmado</span>
                    )}
                    {u.role === "admin" && <span className="tag tag-plan">Admin</span>}
                  </td>
                  <td>{u.activeSubscriptions}</td>
                  <td>{u.lastSeenAt ? formatDate(u.lastSeenAt, true) : "Nunca"}</td>
                  <td>{formatDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && pages > 1 && (
        <div className="pager">
          <Button variant="quiet" disabled={page <= 1} onClick={() => setParams({ q, p: String(page - 1) })}>
            Anterior
          </Button>
          <span>
            Página {page} de {pages} ({data.total} usuários)
          </span>
          <Button variant="quiet" disabled={page >= pages} onClick={() => setParams({ q, p: String(page + 1) })}>
            Próxima
          </Button>
        </div>
      )}
    </Window>
  );
}

function UserDetail() {
  const { id = "" } = useParams();
  const { me } = useAuth();
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState<{ toolId: string; tier: PaidTier; endsAt: string; note: string }>({
    toolId: TOOLS.find((t) => t.paid)!.id,
    tier: "basic",
    endsAt: "",
    note: "",
  });

  const load = useCallback(() => {
    void api.admin.user(id).then(setDetail).catch((e) => setNotice({ kind: "error", text: errorText(e) }));
    void api.admin.audit(id).then(setAudit);
  }, [id]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<AdminUserDetail>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      setDetail(await fn());
      setNotice({ kind: "success", text: success });
      void api.admin.audit(id).then(setAudit);
    } catch (e) {
      setNotice({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!detail) return notice ? <Alert>{notice.text}</Alert> : <Loading />;
  const { user } = detail;
  const isSelf = me?.user.id === user.id;
  const active = detail.subscriptions.filter((s) => s.status === "active" && (!s.endsAt || s.endsAt > Date.now()));
  const history = detail.subscriptions.filter((s) => !active.includes(s));

  const submitGrant = (e: FormEvent) => {
    e.preventDefault();
    const endsAt = grant.endsAt ? new Date(`${grant.endsAt}T23:59:59`).getTime() : null;
    const toolId = grant.tier === "diamond" ? "*" : grant.toolId;
    void act(
      () => api.admin.grant(user.id, { toolId, tier: grant.tier, endsAt, note: grant.note.trim() || null }),
      `Plano ${PAID_TIER_LABELS[grant.tier]} liberado${grant.tier === "diamond" ? "" : ` para ${toolName(toolId)}`}.`,
    );
  };

  return (
    <div className="stack">
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      <div className="grid">
        <Window title={user.name}>
          <dl className="facts">
            <div>
              <dt>E-mail</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Conta criada</dt>
              <dd>{formatDate(user.createdAt, true)}</dd>
            </div>
            <div>
              <dt>E-mail confirmado</dt>
              <dd>{user.emailVerified ? "Sim" : "Não"}</dd>
            </div>
            <div>
              <dt>Papel</dt>
              <dd>{user.role === "admin" ? "Administrador" : "Usuário"}</dd>
            </div>
            <div>
              <dt>Situação</dt>
              <dd>{user.status === "blocked" ? "Bloqueado" : "Ativo"}</dd>
            </div>
            <div>
              <dt>Ferramentas escolhidas</dt>
              <dd>{detail.tools.length ? detail.tools.map(toolName).join(", ") : "Nenhuma ainda"}</dd>
            </div>
          </dl>
          <div className="actions actions-wrap">
            {!user.emailVerified && (
              <Button variant="quiet" busy={busy} onClick={() => void act(() => api.admin.updateUser(user.id, { emailVerified: true }), "E-mail marcado como confirmado.")}>
                Confirmar e-mail
              </Button>
            )}
            <Button
              variant="quiet"
              busy={busy}
              disabled={isSelf}
              onClick={() =>
                void act(
                  () => api.admin.updateUser(user.id, { role: user.role === "admin" ? "user" : "admin" }),
                  user.role === "admin" ? "Acesso de administrador removido." : "Agora é administrador.",
                )
              }
            >
              {user.role === "admin" ? "Remover admin" : "Tornar admin"}
            </Button>
            <Button
              variant={user.status === "blocked" ? "quiet" : "danger"}
              busy={busy}
              disabled={isSelf}
              onClick={() =>
                void act(
                  () => api.admin.updateUser(user.id, { status: user.status === "blocked" ? "active" : "blocked" }),
                  user.status === "blocked" ? "Conta desbloqueada." : "Conta bloqueada e desconectada de tudo.",
                )
              }
            >
              {user.status === "blocked" ? "Desbloquear" : "Bloquear conta"}
            </Button>
          </div>
        </Window>

        <Window title="Planos">
          {active.length === 0 ? (
            <p className="lead-small">Sem planos pagos: todas as ferramentas no Grátis.</p>
          ) : (
            <ul className="plan-list">
              {active.map((s) => (
                <li key={s.id}>
                  {s.toolId === "*" ? <span className="tool-dot tool-dot-diamond" aria-hidden="true" /> : <ToolDot toolId={s.toolId} size={24} />}
                  <span>
                    {s.toolId === "*" ? "Todas as ferramentas" : toolName(s.toolId)}
                    <span className="cell-sub">
                      {s.endsAt ? `até ${formatDate(s.endsAt)}` : "sem data de término"}
                      {s.note ? `, ${s.note}` : ""}
                    </span>
                  </span>
                  <span className="tag tag-plan">{PAID_TIER_LABELS[s.tier]}</span>
                  <Button variant="quiet" busy={busy} onClick={() => void act(() => api.admin.cancelSubscription(s.id), "Plano cancelado.")}>
                    Cancelar
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={submitGrant} className="form grant-form">
            <h3 className="subhead">Liberar plano</h3>
            <div className="field">
              <label htmlFor="grant-tier">Plano</label>
              <select id="grant-tier" value={grant.tier} onChange={(e) => setGrant({ ...grant, tier: e.target.value as PaidTier })}>
                {(Object.keys(PAID_TIER_LABELS) as PaidTier[]).map((t) => (
                  <option key={t} value={t}>
                    {PAID_TIER_LABELS[t]}
                    {t === "diamond" ? " (todas as ferramentas)" : ""}
                  </option>
                ))}
              </select>
            </div>
            {grant.tier !== "diamond" && (
              <div className="field">
                <label htmlFor="grant-tool">Ferramenta</label>
                <select id="grant-tool" value={grant.toolId} onChange={(e) => setGrant({ ...grant, toolId: e.target.value })}>
                  {TOOLS.filter((t) => t.paid).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Field
              label="Válido até (opcional)"
              type="date"
              value={grant.endsAt}
              onChange={(e) => setGrant({ ...grant, endsAt: e.target.value })}
              hint="Em branco: sem data de término. Um plano novo substitui o atual da mesma ferramenta."
            />
            <Field label="Observação (opcional)" value={grant.note} maxLength={500} onChange={(e) => setGrant({ ...grant, note: e.target.value })} />
            <Button type="submit" busy={busy}>
              Liberar plano
            </Button>
          </form>
          {history.length > 0 && (
            <details className="history">
              <summary>Histórico ({history.length})</summary>
              <ul className="fine">
                {history.map((s) => (
                  <li key={s.id}>
                    {PAID_TIER_LABELS[s.tier]} {s.toolId === "*" ? "(todas)" : toolName(s.toolId)}, de {formatDate(s.startsAt)}
                    {s.status === "canceled" ? ", cancelado" : s.endsAt ? ` até ${formatDate(s.endsAt)}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Window>

        <Window
          title="Conectado em"
          actions={
            detail.sessions.length > 0 && (
              <Button variant="quiet" busy={busy} onClick={() => void act(() => api.admin.revokeSessions(user.id), "Todas as sessões foram encerradas.")}>
                Desconectar tudo
              </Button>
            )
          }
        >
          {detail.sessions.length === 0 ? (
            <p className="lead-small">Nenhuma sessão ativa.</p>
          ) : (
            <ul className="session-list">
              {detail.sessions.map((s) => (
                <li key={s.id}>
                  <div>
                    <strong>{s.kind === "desktop" ? (s.deviceName ?? "Computador") : "Navegador"}</strong>
                    <p className="fine">Último uso em {formatDate(s.lastUsedAt, true)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Window>

        <Window title="Atividade">{audit ? <AuditList entries={audit} /> : <Loading />}</Window>
      </div>
    </div>
  );
}

// --- Terms ---

function TermsAdmin() {
  const [versions, setVersions] = useState<TermsVersion[] | null>(null);
  const [draft, setDraft] = useState<{ title: string; content: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => void api.admin.terms().then(setVersions);
  useEffect(load, []);

  const publish = async () => {
    if (!draft) return;
    if (!window.confirm("Publicar esta versão? Todos os usuários vão precisar aceitá-la para continuar usando a conta e o app.")) return;
    setBusy(true);
    setNotice(null);
    try {
      const { version } = await api.admin.publishTerms(draft.title, draft.content);
      setDraft(null);
      setNotice({ kind: "success", text: `Versão ${version} publicada.` });
      load();
    } catch (e) {
      setNotice({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!versions) return <Loading />;
  const current = versions[0];

  return (
    <div className="stack">
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {draft ? (
        <Window
          title="Nova versão dos termos"
          width="wide"
          actions={
            <Button variant="quiet" onClick={() => setPreview((v) => !v)}>
              {preview ? "Editar" : "Pré-visualizar"}
            </Button>
          }
        >
          {preview ? (
            <Markdown source={draft.content} />
          ) : (
            <div className="form">
              <Field label="Título" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <div className="field">
                <label htmlFor="terms-content">Conteúdo (Markdown)</label>
                <textarea id="terms-content" rows={20} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
              </div>
            </div>
          )}
          <div className="actions">
            <Button onClick={() => void publish()} busy={busy}>
              Publicar versão {(current?.version ?? 0) + 1}
            </Button>
            <Button variant="quiet" onClick={() => setDraft(null)}>
              Descartar
            </Button>
          </div>
        </Window>
      ) : (
        <Window
          title={current ? `Versão atual: ${current.version}` : "Nenhuma versão publicada"}
          width="wide"
          actions={
            <Button variant="quiet" onClick={() => setDraft({ title: current?.title ?? "Termos de Uso do ToolBox", content: current?.content ?? "" })}>
              Criar nova versão
            </Button>
          }
        >
          {current && (
            <>
              <p className="fine">Publicada em {formatDate(current.publishedAt, true)}.</p>
              <div className="terms-scroll">
                <Markdown source={current.content} />
              </div>
            </>
          )}
          {versions.length > 1 && (
            <details className="history">
              <summary>Versões anteriores ({versions.length - 1})</summary>
              <ul className="fine">
                {versions.slice(1).map((v) => (
                  <li key={v.version}>
                    Versão {v.version}, {formatDate(v.publishedAt)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Window>
      )}
    </div>
  );
}

// --- Releases ---

const TARGETS = [
  { kind: "app" as const, target: "windows-x64", label: "Aplicativo para Windows (64 bits)" },
  ...DEPENDENCIES.map((d) => ({ kind: "dependency" as const, target: d.id, label: `Dependência: ${d.name}` })),
];

function Releases() {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"upload" | "register">("upload");
  const [targetIndex, setTargetIndex] = useState(0);

  const load = () => void api.admin.releases().then(setReleases);
  useEffect(load, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const { kind, target } = TARGETS[targetIndex];
    setBusy(true);
    setNotice(null);
    try {
      if (mode === "upload") {
        data.set("kind", kind);
        data.set("target", target);
        await api.admin.uploadRelease(data);
      } else {
        await api.admin.registerRelease({
          kind,
          target,
          version: String(data.get("version")),
          notes: String(data.get("notes") ?? "") || null,
          r2Key: String(data.get("r2Key")),
          fileName: String(data.get("fileName")),
        });
      }
      form.reset();
      setNotice({ kind: "success", text: "Versão publicada. Os usuários já veem este arquivo no download." });
      load();
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Release) => {
    if (!window.confirm(`Apagar ${r.fileName} (${r.version})? O arquivo é removido do armazenamento.`)) return;
    try {
      await api.admin.deleteRelease(r.id);
      load();
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err) });
    }
  };

  return (
    <div className="stack">
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      <Window title="Publicar versão" width="wide">
        <div className="tabs tabs-small" role="tablist">
          <button role="tab" aria-selected={mode === "upload"} onClick={() => setMode("upload")}>
            Enviar arquivo (até 100 MB)
          </button>
          <button role="tab" aria-selected={mode === "register"} onClick={() => setMode("register")}>
            Registrar arquivo já no R2
          </button>
        </div>
        <form onSubmit={(e) => void submit(e)} className="form">
          <div className="field">
            <label htmlFor="rel-target">O que é</label>
            <select id="rel-target" value={targetIndex} onChange={(e) => setTargetIndex(Number(e.target.value))}>
              {TARGETS.map((t, i) => (
                <option key={t.target} value={i}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <Field label="Versão" name="version" required placeholder="0.2.0" pattern="[0-9A-Za-z.+\-]{1,40}" />
          {mode === "upload" ? (
            <div className="field">
              <label htmlFor="rel-file">Arquivo</label>
              <input id="rel-file" name="file" type="file" required />
            </div>
          ) : (
            <>
              <Field
                label="Chave no R2"
                name="r2Key"
                required
                placeholder="dependency/whisper/1.7/whisper.zip"
                hint="Envie antes com: npx wrangler r2 object put toolbox-files/<chave> --file <arquivo> --remote"
              />
              <Field label="Nome do arquivo para download" name="fileName" required placeholder="whisper.zip" />
            </>
          )}
          <Field label="Notas da versão (opcional)" name="notes" />
          <Button type="submit" busy={busy}>
            Publicar
          </Button>
        </form>
      </Window>

      <Window title="Versões publicadas" width="wide">
        {!releases ? (
          <Loading />
        ) : releases.length === 0 ? (
          <p className="lead-small">Nada publicado ainda. O download fica indisponível até o primeiro instalador.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Arquivo</th>
                  <th scope="col">Versão</th>
                  <th scope="col">Tamanho</th>
                  <th scope="col">Publicado em</th>
                  <th scope="col">
                    <span className="visually-hidden">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {releases.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {TARGETS.find((t) => t.target === r.target)?.label ?? r.target}
                      <span className="cell-sub">{r.fileName}</span>
                    </td>
                    <td>{r.version}</td>
                    <td>{formatBytes(r.size)}</td>
                    <td>{formatDate(r.publishedAt, true)}</td>
                    <td>
                      <Button variant="quiet" onClick={() => void remove(r)}>
                        Apagar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Window>
    </div>
  );
}

// --- Audit ---

const ACTION_LABELS: Record<string, string> = {
  "user.signup": "Criou a conta",
  "user.email_verified": "Confirmou o e-mail",
  "auth.login": "Entrou no site",
  "auth.login_failed": "Tentativa de login com senha errada",
  "auth.password_changed": "Alterou a senha",
  "auth.password_reset": "Redefiniu a senha pelo e-mail",
  "device.signed_in": "Conectou um computador",
  "session.revoked": "Desconectou uma sessão",
  "terms.accepted": "Aceitou os termos",
  download: "Baixou um arquivo",
  "admin.user_updated": "Admin alterou a conta",
  "admin.sessions_revoked": "Admin desconectou todas as sessões",
  "admin.plan_granted": "Admin liberou um plano",
  "admin.plan_canceled": "Admin cancelou um plano",
  "admin.terms_published": "Admin publicou termos",
  "admin.release_published": "Admin publicou uma versão",
  "admin.release_deleted": "Admin apagou uma versão",
};

function AuditList({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <p className="lead-small">Nenhuma atividade registrada.</p>;
  return (
    <ul className="audit-list">
      {entries.map((a) => (
        <li key={a.id}>
          <time dateTime={new Date(a.createdAt).toISOString()}>{formatDate(a.createdAt, true)}</time>
          <span>
            {ACTION_LABELS[a.action] ?? a.action}
            {a.actorEmail && a.action.startsWith("admin.") && <span className="cell-sub">por {a.actorEmail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Audit() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => void api.admin.audit().then(setEntries), []);
  return (
    <Window title="Últimos 200 eventos" width="wide">
      {entries ? <AuditList entries={entries} /> : <Loading />}
    </Window>
  );
}
