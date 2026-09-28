import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router";
import type { TermsVersion } from "@toolbox/shared";
import { api } from "./api";
import { useAuth } from "./auth";
import { Alert, Button, Loading, Markdown, Window } from "./ui";

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="ToolBox, página inicial">
      <span className="logo-bubble" aria-hidden="true" />
      ToolBox
    </Link>
  );
}

export function Layout() {
  const { me, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>
      <header className="topbar">
        <Logo />
        <button
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="nav"
          onClick={() => setMenuOpen((v) => !v)}
        >
          Menu
        </button>
        <nav id="nav" className={`nav${menuOpen ? " nav-open" : ""}`}>
          <Link to="/#ferramentas">Ferramentas</Link>
          <Link to="/#planos">Planos</Link>
          <NavLink to="/download">Download</NavLink>
          {me?.user.role === "admin" && <NavLink to="/admin">Admin</NavLink>}
          {me ? (
            <>
              <NavLink to="/conta">Minha conta</NavLink>
              <button className="nav-button" onClick={() => void signOut()}>
                Sair
              </button>
            </>
          ) : me === null ? (
            <>
              <NavLink to="/entrar">Entrar</NavLink>
              <Link to="/cadastro" className="btn btn-primary btn-small">
                Criar conta
              </Link>
            </>
          ) : null}
        </nav>
      </header>
      <main id="conteudo">
        <TermsGate>
          <Outlet />
        </TermsGate>
      </main>
      <footer className="footer">
        <Logo />
        <nav className="footer-links" aria-label="Rodapé">
          <Link to="/termos">Termos de uso</Link>
          <Link to="/download">Download</Link>
          <Link to="/conta">Minha conta</Link>
        </nav>
      </footer>
    </div>
  );
}

/** Signed-in pages. Remembers where the user was going. */
export function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { me } = useAuth();
  const location = useLocation();
  if (me === undefined) return <Loading />;
  if (me === null) return <Navigate to={`/entrar?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (admin && me.user.role !== "admin") return <Navigate to="/conta" replace />;
  return <>{children}</>;
}

/** New terms published since the user last accepted: they must accept
 * before doing anything else with the account. */
function TermsGate({ children }: { children: ReactNode }) {
  const { me, reload, signOut } = useAuth();
  const [terms, setTerms] = useState<TermsVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();
  const needsAcceptance = me && !me.terms.accepted && location.pathname !== "/termos";

  useEffect(() => {
    if (needsAcceptance) void api.currentTerms().then(setTerms);
  }, [needsAcceptance]);

  if (!needsAcceptance) return <>{children}</>;

  const accept = async () => {
    if (!terms) return;
    setBusy(true);
    setError(null);
    try {
      await api.acceptTerms(terms.version);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-center">
      <Window title="Termos de uso atualizados" width="wide">
        <p className="lead-small">
          Os Termos de Uso mudaram. Leia a nova versão e aceite para continuar usando sua conta e o aplicativo.
        </p>
        {terms ? (
          <div className="terms-scroll">
            <Markdown source={terms.content} />
          </div>
        ) : (
          <Loading />
        )}
        {error && <Alert>{error}</Alert>}
        <div className="actions">
          <Button onClick={() => void accept()} busy={busy} disabled={!terms}>
            Aceitar e continuar
          </Button>
          <Button variant="quiet" onClick={() => void signOut()}>
            Sair
          </Button>
        </div>
      </Window>
    </div>
  );
}
