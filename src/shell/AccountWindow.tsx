import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "./TitleBar";
import { useAccountStatus } from "../shared/account";
import {
  accountCancelLogin,
  accountDevMode,
  accountLogout,
  accountOpenSite,
  accountRetry,
  accountStartLogin,
} from "../shared/tauri";

/** Reopens the confirmation page (same path on the ToolBox site, which the
 * API server also serves). */
function reopenPage(uri: string) {
  const url = new URL(uri);
  void accountOpenSite(url.pathname + url.search);
}

/** The sign-in window: the only thing the app shows without a valid
 * session. Sign-in happens in the browser — this window shows the code to
 * confirm there and waits. */
export function AccountWindow() {
  const status = useAccountStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel account-window">
      <TitleBar
        title="ToolBox"
        onMinimize={() => void getCurrentWindow().minimize()}
        onClose={() => void getCurrentWindow().close()}
      />
      <div className="account-body">
        <div className="account-brand" aria-hidden="true">
          <span className="account-bubble" />
        </div>

        {status.state === "loading" && <p className="account-lead">Conectando à sua conta…</p>}

        {status.state === "signed_out" && (
          <>
            <h1 className="account-title">Entre na sua conta</h1>
            <p className="account-lead">
              O login é feito no navegador: vamos abrir a página e mostrar aqui um código para você confirmar.
            </p>
            {status.message && <p className="ocr-error">{status.message}</p>}
            <button className="account-primary" disabled={busy} onClick={() => void run(accountStartLogin)}>
              {busy ? "Abrindo o navegador…" : "Entrar com o navegador"}
            </button>
            <p className="settings-hint account-center">
              Ainda não tem conta?{" "}
              <button className="account-link" onClick={() => void accountOpenSite("/cadastro")}>
                Criar conta grátis
              </button>
            </p>
            {import.meta.env.DEV && (
              <button className="account-link account-center" onClick={() => void run(accountDevMode)}>
                Continuar sem conta (só em desenvolvimento)
              </button>
            )}
          </>
        )}

        {status.state === "pending" && (
          <>
            <h1 className="account-title">Confirme no navegador</h1>
            <p className="account-lead">Confira se este é o mesmo código mostrado na página que abrimos:</p>
            <p className="account-code" aria-label={`Código ${status.user_code.split("").join(" ")}`}>
              {status.user_code}
            </p>
            <p className="settings-hint account-center account-waiting">
              <span className="account-dot" aria-hidden="true" />
              Aguardando a confirmação…
            </p>
            <div className="account-actions">
              <button className="var-add-btn" onClick={() => void reopenPage(status.verification_uri)}>
                Abrir a página de novo
              </button>
              <button className="var-add-btn" onClick={() => void run(accountCancelLogin)}>
                Cancelar
              </button>
            </div>
          </>
        )}

        {status.state === "needs_connection" && (
          <>
            <h1 className="account-title">Sem conexão</h1>
            <p className="account-lead">
              O ToolBox funciona até 7 dias sem internet. Esse prazo acabou: conecte-se para confirmar sua conta
              ({status.user.email}).
            </p>
            <button className="account-primary" disabled={busy} onClick={() => void run(accountRetry)}>
              {busy ? "Tentando…" : "Tentar de novo"}
            </button>
            <button className="account-link account-center" onClick={() => void run(accountLogout)}>
              Entrar com outra conta
            </button>
          </>
        )}

        {status.state === "terms_required" && (
          <>
            <h1 className="account-title">Termos de uso atualizados</h1>
            <p className="account-lead">
              Os Termos de Uso mudaram. Aceite a nova versão no site para continuar usando o ToolBox.
            </p>
            <button className="account-primary" onClick={() => void accountOpenSite("/conta")}>
              Abrir o site
            </button>
            <button className="var-add-btn account-center-block" disabled={busy} onClick={() => void run(accountRetry)}>
              Já aceitei, continuar
            </button>
          </>
        )}

        {(status.state === "active" || status.state === "dev_mode") && (
          <p className="account-lead">Tudo certo! Abrindo o ToolBox…</p>
        )}

        {error && <p className="ocr-error">{error}</p>}
      </div>
    </div>
  );
}
