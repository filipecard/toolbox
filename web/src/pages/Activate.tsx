import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import type { DeviceLookupResponse } from "@toolbox/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Field, Loading, Window, formatDate } from "../ui";

/** Where the desktop app sends the browser to sign in: shows which computer
 * is asking and lets the user confirm the code the app displays. */
export function Activate() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const code = params.get("code") ?? "";
  const [device, setDevice] = useState<DeviceLookupResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "approved" | "denied">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code || !me) return;
    setState("loading");
    setError(null);
    api
      .deviceLookup(code)
      .then((d) => {
        setDevice(d);
        setState("idle");
      })
      .catch((e: Error) => {
        setDevice(null);
        setState("idle");
        setError(e.message);
      });
  }, [code, me]);

  if (!me) return <Loading />;

  const decide = async (approve: boolean) => {
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      if (approve) await api.deviceApprove(device.userCode);
      else await api.deviceDeny(device.userCode);
      setState(approve ? "approved" : "denied");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Algo deu errado.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setParams({ code: String(new FormData(e.currentTarget).get("code")).trim() });
  };

  return (
    <div className="page page-center">
      <Window title="Conectar o aplicativo" width="narrow">
        {state === "approved" && (
          <Alert kind="success">
            Pronto! Pode voltar para o ToolBox: ele entra na sua conta em alguns segundos.
          </Alert>
        )}
        {state === "denied" && (
          <Alert kind="info">Acesso recusado. Esse computador não foi conectado à sua conta.</Alert>
        )}
        {state === "loading" && <Loading />}
        {(state === "idle" || state === "loading") && device && (
          <>
            <p className="lead-small">Confira se o código abaixo é o mesmo que aparece no aplicativo.</p>
            <p className="device-code" aria-label={`Código ${device.userCode.split("").join(" ")}`}>
              {device.userCode}
            </p>
            <dl className="facts">
              <div>
                <dt>Computador</dt>
                <dd>{device.deviceName ?? "Sem nome"}</dd>
              </div>
              <div>
                <dt>Pedido em</dt>
                <dd>{formatDate(device.createdAt, true)}</dd>
              </div>
              <div>
                <dt>Conta</dt>
                <dd>{me.user.email}</dd>
              </div>
            </dl>
            {error && <Alert>{error}</Alert>}
            <div className="actions">
              <Button onClick={() => void decide(true)} busy={busy}>
                Conectar este computador
              </Button>
              <Button variant="quiet" onClick={() => void decide(false)} disabled={busy}>
                Não fui eu
              </Button>
            </div>
            <p className="fine">
              Se você não pediu para conectar nenhum computador agora, clique em "Não fui eu". Ninguém entra na sua
              conta sem essa confirmação.
            </p>
          </>
        )}
        {state === "idle" && !device && (
          <form onSubmit={submitCode} className="form">
            <p className="lead-small">Digite o código que aparece no aplicativo ToolBox.</p>
            <Field
              label="Código"
              name="code"
              defaultValue={code}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              required
              autoFocus
            />
            {error && <Alert>{error}</Alert>}
            {error?.includes("e-mail") && (
              <p className="fine">
                <Link to="/conta">Ir para Minha conta</Link>
              </p>
            )}
            <Button type="submit">Continuar</Button>
          </form>
        )}
      </Window>
    </div>
  );
}
