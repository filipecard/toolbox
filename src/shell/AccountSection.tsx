import { useState } from "react";
import { useAccountStatus } from "../shared/account";
import { planLabel, usePlanStatus } from "../shared/plans";
import { accountLogout, accountOpenSite } from "../shared/tauri";
import { TOOL_CATALOG } from "./toolCatalog";

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function AccountSection() {
  const status = useAccountStatus();
  const plan = usePlanStatus();
  const [confirmLogout, setConfirmLogout] = useState(false);

  if (status.state === "dev_mode") {
    return (
      <section className="settings-section">
        <h3 className="settings-heading">Conta</h3>
        <p className="settings-hint">Modo de desenvolvimento: usando o app sem conta, com o plano Grátis.</p>
      </section>
    );
  }
  if (status.state !== "active") return null;

  const paid = plan
    ? TOOL_CATALOG.filter((t) => plan.tools[t.toolId]).map((t) => `${t.defaultLabel} (${planLabel(plan, t.toolId)})`)
    : [];

  return (
    <section className="settings-section">
      <h3 className="settings-heading">Conta</h3>
      <div className="account-settings-row">
        <span className="account-settings-email">
          {status.user.name} ({status.user.email})
        </span>
      </div>
      <p className="settings-hint">
        {status.diamond
          ? "Plano Diamante: todas as ferramentas, sem limites."
          : paid.length
            ? `Planos pagos: ${paid.join(", ")}. As demais ferramentas no Grátis.`
            : "Todas as ferramentas no plano Grátis."}
      </p>
      {status.offline && (
        <p className="settings-hint">
          Sem conexão agora: usando o plano salvo, válido até {formatDate(status.valid_until)}.
        </p>
      )}
      <div className="settings-row">
        <button className="var-add-btn" onClick={() => void accountOpenSite("/conta")}>
          Gerenciar conta no site
        </button>
        {confirmLogout ? (
          <>
            <button className="var-add-btn" onClick={() => void accountLogout()}>
              Confirmar: sair
            </button>
            <button className="var-add-btn" onClick={() => setConfirmLogout(false)}>
              Cancelar
            </button>
          </>
        ) : (
          <button className="var-add-btn" onClick={() => setConfirmLogout(true)}>
            Sair da conta
          </button>
        )}
      </div>
    </section>
  );
}
