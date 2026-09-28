/** Sign-in, sign-up, password recovery and e-mail verification. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import type { TermsVersion } from "@toolbox/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Field, Loading, Window } from "../ui";

/** Only same-site paths: an open redirect via ?next= would let a phishing
 * link bounce users to another site right after a real login. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/conta";
}

function useFormState() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Algo deu errado. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function Login() {
  const { me, signIn } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"));
  const { busy, error, run } = useFormState();

  if (me) return <Navigate to={next} replace />;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void run(async () => {
      await signIn(await api.login({ email: String(form.get("email")), password: String(form.get("password")) }));
      navigate(next, { replace: true });
    });
  };

  return (
    <div className="page page-center">
      <Window title="Entrar" width="narrow">
        <form onSubmit={submit} className="form">
          <Field label="E-mail" name="email" type="email" autoComplete="email" required autoFocus />
          <Field label="Senha" name="password" type="password" autoComplete="current-password" required />
          {error && <Alert>{error}</Alert>}
          <Button type="submit" busy={busy}>
            Entrar
          </Button>
        </form>
        <p className="form-links">
          <Link to="/esqueci-senha">Esqueci minha senha</Link>
          <Link to={`/cadastro${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`}>Criar conta</Link>
        </p>
      </Window>
    </div>
  );
}

export function Signup() {
  const { me, signIn } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [terms, setTerms] = useState<TermsVersion | null>(null);
  const { busy, error, run } = useFormState();

  useEffect(() => {
    void api.currentTerms().then(setTerms);
  }, []);

  if (me) return <Navigate to={safeNext(params.get("next"))} replace />;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void run(async () => {
      if (!terms) throw new ApiError(0, "terms", "Aguarde os Termos de Uso carregarem.");
      await signIn(
        await api.signup({
          name: String(form.get("name")),
          email: String(form.get("email")),
          password: String(form.get("password")),
          acceptedTermsVersion: terms.version,
        }),
      );
      navigate(params.get("next") ? safeNext(params.get("next")) : "/download", { replace: true });
    });
  };

  return (
    <div className="page page-center">
      <Window title="Criar conta" width="narrow">
        <form onSubmit={submit} className="form">
          <Field label="Nome" name="name" autoComplete="name" required minLength={2} autoFocus />
          <Field label="E-mail" name="email" type="email" autoComplete="email" required />
          <Field
            label="Senha"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            hint="Pelo menos 8 caracteres."
          />
          <label className="check">
            <input type="checkbox" name="terms" required />
            <span>
              Li e aceito os{" "}
              <Link to="/termos" target="_blank">
                Termos de Uso
              </Link>
              .
            </span>
          </label>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" busy={busy} disabled={!terms}>
            Criar conta
          </Button>
        </form>
        <p className="form-links">
          <span>
            Já tem conta? <Link to="/entrar">Entrar</Link>
          </span>
        </p>
      </Window>
    </div>
  );
}

export function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useFormState();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    void run(async () => {
      await api.forgotPassword(email);
      setSent(true);
    });
  };

  return (
    <div className="page page-center">
      <Window title="Recuperar senha" width="narrow">
        {sent ? (
          <Alert kind="success">
            Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha. Ele vale por 1 hora.
          </Alert>
        ) : (
          <form onSubmit={submit} className="form">
            <p className="lead-small">Informe o e-mail da sua conta e enviaremos um link para criar uma nova senha.</p>
            <Field label="E-mail" name="email" type="email" autoComplete="email" required autoFocus />
            {error && <Alert>{error}</Alert>}
            <Button type="submit" busy={busy}>
              Enviar link
            </Button>
          </form>
        )}
        <p className="form-links">
          <Link to="/entrar">Voltar para o login</Link>
        </p>
      </Window>
    </div>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [done, setDone] = useState(false);
  const { busy, error, run } = useFormState();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    void run(async () => {
      await api.resetPassword(token, password);
      setDone(true);
    });
  };

  return (
    <div className="page page-center">
      <Window title="Nova senha" width="narrow">
        {done ? (
          <>
            <Alert kind="success">
              Senha alterada. Por segurança, todos os computadores e navegadores conectados foram desconectados.
            </Alert>
            <p className="form-links">
              <Link to="/entrar">Entrar com a nova senha</Link>
            </p>
          </>
        ) : !token ? (
          <Alert>Link incompleto. Abra o link exatamente como veio no e-mail.</Alert>
        ) : (
          <form onSubmit={submit} className="form">
            <Field
              label="Nova senha"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              autoFocus
              hint="Pelo menos 8 caracteres."
            />
            {error && <Alert>{error}</Alert>}
            <Button type="submit" busy={busy}>
              Salvar nova senha
            </Button>
          </form>
        )}
      </Window>
    </div>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const { me, reload } = useAuth();
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("");
  // StrictMode runs effects twice in development; the link is single-use.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get("token");
    if (!token) {
      setState("error");
      setMessage("Link incompleto. Abra o link exatamente como veio no e-mail.");
      return;
    }
    api
      .verifyEmail(token)
      .then(async () => {
        setState("ok");
        if (me) await reload();
      })
      .catch((e: Error) => {
        setState("error");
        setMessage(e.message);
      });
  }, [params, me, reload]);

  return (
    <div className="page page-center">
      <Window title="Confirmação de e-mail" width="narrow">
        {state === "working" && <Loading label="Confirmando…" />}
        {state === "ok" && (
          <>
            <Alert kind="success">E-mail confirmado. Agora você já pode conectar o aplicativo.</Alert>
            <p className="form-links">
              <Link to={me ? "/download" : "/entrar"}>{me ? "Ir para o download" : "Entrar"}</Link>
            </p>
          </>
        )}
        {state === "error" && (
          <>
            <Alert>{message}</Alert>
            <p className="form-links">
              <Link to="/conta">Pedir um novo link em Minha conta</Link>
            </p>
          </>
        )}
      </Window>
    </div>
  );
}
