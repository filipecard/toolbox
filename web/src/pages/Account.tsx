import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { PAID_TIER_LABELS, TOOLS, type SessionInfo } from "@toolbox/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Field, Loading, ToolDot, Window, formatDate } from "../ui";

function describeSession(s: SessionInfo): string {
  if (s.kind === "desktop") return s.deviceName ?? "Computador";
  const ua = s.userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  return `${browser} (site)`;
}

export function Account() {
  const { me, reload } = useAuth();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadSessions = () => void api.sessions().then(setSessions);
  useEffect(loadSessions, []);

  if (!me) return <Loading />;
  const { user, entitlements } = me;

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setNotice(null);
    try {
      setNotice({ kind: "success", text: await fn() });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof ApiError ? e.message : "Algo deu errado." });
    } finally {
      setBusy(null);
    }
  };

  const saveName = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name"));
    void act("name", async () => {
      await api.updateName(name);
      await reload();
      return "Nome atualizado.";
    });
  };

  const changePassword = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    void act("password", async () => {
      await api.changePassword(String(data.get("current")), String(data.get("new")));
      form.reset();
      loadSessions();
      return "Senha alterada. Os outros computadores e navegadores foram desconectados.";
    });
  };

  const paid = TOOLS.filter((t) => t.paid);

  return (
    <div className="page">
      <h1 className="page-title">Minha conta</h1>
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}

      {!user.emailVerified && (
        <Alert kind="info">
          Confirme seu e-mail ({user.email}) para conectar o aplicativo. Não recebeu?{" "}
          <button
            className="link-button"
            disabled={busy === "verify"}
            onClick={() =>
              void act("verify", async () => {
                await api.resendVerification();
                return "Enviamos um novo link de confirmação.";
              })
            }
          >
            Enviar de novo
          </button>
        </Alert>
      )}

      <div className="grid">
        <Window title="Perfil">
          <form onSubmit={saveName} className="form">
            <Field label="Nome" name="name" defaultValue={user.name} required minLength={2} />
            <Field label="E-mail" value={user.email} readOnly hint="Para trocar o e-mail, fale com o suporte." />
            <Button type="submit" busy={busy === "name"}>
              Salvar nome
            </Button>
          </form>
        </Window>

        <Window title="Seus planos">
          {entitlements.diamond ? (
            <p className="lead-small">
              Você tem o plano <strong>Diamante</strong>: todas as ferramentas, sem limites.
            </p>
          ) : (
            <ul className="plan-list">
              {paid.map((tool) => {
                const tier = entitlements.tools[tool.id];
                return (
                  <li key={tool.id}>
                    <ToolDot toolId={tool.id} size={24} />
                    <span>{tool.name}</span>
                    <span className={`tag ${tier ? "tag-plan" : "tag-muted"}`}>
                      {tier ? PAID_TIER_LABELS[tier] : "Grátis"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="fine">
            <Link to="/#planos">Compare o que cada plano libera</Link>. Mudanças de plano chegam ao aplicativo em até
            algumas horas, ou na hora ao reabri-lo.
          </p>
        </Window>

        <Window title="Computadores e navegadores conectados">
          {!sessions ? (
            <Loading />
          ) : (
            <ul className="session-list">
              {sessions.map((s) => (
                <li key={s.id}>
                  <div>
                    <strong>{describeSession(s)}</strong>
                    {s.current && <span className="tag tag-muted">Este navegador</span>}
                    <p className="fine">Último uso em {formatDate(s.lastUsedAt, true)}</p>
                  </div>
                  {!s.current && (
                    <Button
                      variant="quiet"
                      busy={busy === s.id}
                      onClick={() =>
                        void act(s.id, async () => {
                          await api.revokeSession(s.id);
                          loadSessions();
                          return `${describeSession(s)} foi desconectado.`;
                        })
                      }
                    >
                      Desconectar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Window>

        <Window title="Alterar senha">
          <form onSubmit={changePassword} className="form">
            <Field label="Senha atual" name="current" type="password" autoComplete="current-password" required />
            <Field
              label="Nova senha"
              name="new"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              hint="Pelo menos 8 caracteres. Os outros dispositivos serão desconectados."
            />
            <Button type="submit" busy={busy === "password"}>
              Alterar senha
            </Button>
          </form>
        </Window>
      </div>
    </div>
  );
}
