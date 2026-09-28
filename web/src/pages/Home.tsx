import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import { FEATURE_LIMITS, TIERS, TOOLS, toolName } from "@toolbox/shared";
import { ToolDot } from "../ui";

/** The hero: the desktop app's bubble opening into its row of tools — the
 * one moment of motion on the site (static when reduced motion is on). */
function BubbleScene() {
  return (
    <div className="scene" aria-hidden="true">
      <div className="scene-bar">
        <span className="scene-bubble" />
        <div className="scene-tools">
          {TOOLS.map((t, i) => (
            <span key={t.id} className="scene-tool" style={{ animationDelay: `${300 + i * 55}ms` }}>
              <ToolDot toolId={t.id} size={34} />
            </span>
          ))}
        </div>
      </div>
      <div className="scene-window">
        <div className="scene-window-bar">
          <span>Calculadora</span>
          <span className="scene-window-controls">
            <i />
            <i />
          </span>
        </div>
        <div className="scene-window-body">
          <span className="scene-expr">preço * 3 - desconto</span>
          <span className="scene-result">= 142,50</span>
          <span className="scene-var">preço = 52,50</span>
          <span className="scene-var">desconto = 15</span>
        </div>
      </div>
    </div>
  );
}

const freeTools = TOOLS.filter((t) => !t.paid);
const paidTools = TOOLS.filter((t) => t.paid);

export function Home() {
  const location = useLocation();
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [location.hash]);

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>Suas ferramentas do dia a dia, guardadas numa bolinha.</h1>
          <p className="lead">
            Calculadora, notas, leitor de texto em imagens, histórico do que você copia e mais oito ferramentas ficam
            num canto da tela. Um clique e elas abrem por cima do que você está fazendo.
          </p>
          <div className="actions">
            <Link to="/download" className="btn btn-primary btn-large">
              Baixar para Windows
            </Link>
            <a href="#planos" className="btn btn-quiet btn-large">
              Ver planos
            </a>
          </div>
        </div>
        <BubbleScene />
      </section>

      <section id="ferramentas" className="section">
        <h2 className="section-title">Doze ferramentas, você escolhe quais instalar</h2>
        <p className="section-intro">
          Na hora de baixar, marque só as que você usa. Dá para adicionar as outras depois, sem reinstalar nada.
        </p>
        <ul className="tool-list">
          {TOOLS.map((tool) => (
            <li key={tool.id} className="tool-row">
              <ToolDot toolId={tool.id} size={40} />
              <div>
                <h3>{tool.name}</h3>
                <p>{tool.description}</p>
              </div>
              <span className={`tag ${tool.paid ? "tag-plan" : "tag-free"}`}>
                {tool.paid ? "Grátis com limite" : "Sempre grátis"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section id="planos" className="section">
        <h2 className="section-title">Planos por ferramenta</h2>
        <p className="section-intro">
          Você paga só pelo que usa: cada ferramenta tem seu plano, do Grátis ao Gold, e o Diamante libera todas sem
          limite. {freeTools.map((t) => t.name).join(", ").replace(/, ([^,]*)$/, " e $1")} não têm limites em nenhum
          plano.
        </p>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Limites de cada plano">
          <table className="plans">
            <thead>
              <tr>
                <th scope="col">Ferramenta</th>
                {TIERS.map((t) => (
                  <th scope="col" key={t.id}>
                    {t.label}
                  </th>
                ))}
                <th scope="col" className="plans-diamond">
                  Diamante
                </th>
              </tr>
            </thead>
            <tbody>
              {paidTools.map((tool) =>
                FEATURE_LIMITS.filter((f) => f.tool === tool.id).map((f, i, rows) => (
                  <tr key={f.id} className={i === rows.length - 1 ? "plans-group-end" : undefined}>
                    <th scope="row">
                      {i === 0 && (
                        <span className="plans-tool">
                          <ToolDot toolId={tool.id} size={22} />
                          {toolName(tool.id)}
                        </span>
                      )}
                      <span className="plans-feature">{f.label}</span>
                    </th>
                    {f.limits.map((n, j) => (
                      <td key={j}>{n.toLocaleString("pt-BR")}</td>
                    ))}
                    <td className="plans-diamond">Sem limite</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        <p className="fine">Os preços dos planos pagos serão divulgados em breve. O plano Grátis não expira.</p>
      </section>

      <section className="section">
        <h2 className="section-title">Como começar</h2>
        <ol className="steps">
          <li>
            <h3>Crie sua conta</h3>
            <p>Só nome, e-mail e senha. Confirme o e-mail pelo link que enviamos.</p>
          </li>
          <li>
            <h3>Escolha e baixe</h3>
            <p>Marque as ferramentas que quer e baixe o instalador para Windows.</p>
          </li>
          <li>
            <h3>Conecte o aplicativo</h3>
            <p>Ao abrir, o app mostra um código. Confirme esse código no navegador e pronto.</p>
          </li>
        </ol>
        <Link to="/cadastro" className="btn btn-primary btn-large">
          Criar conta grátis
        </Link>
      </section>
    </>
  );
}
