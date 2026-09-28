import { useEffect, useState } from "react";
import type { TermsVersion } from "@toolbox/shared";
import { api } from "../api";
import { Alert, Loading, Markdown, Window, formatDate } from "../ui";

export function Terms() {
  const [terms, setTerms] = useState<TermsVersion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.currentTerms().then(setTerms).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="page page-center">
      <Window title={terms?.title ?? "Termos de Uso"} width="wide">
        {error && <Alert>{error}</Alert>}
        {!terms && !error && <Loading />}
        {terms && (
          <>
            <p className="fine">
              Versão {terms.version}, publicada em {formatDate(terms.publishedAt)}.
            </p>
            <Markdown source={terms.content} />
          </>
        )}
      </Window>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="page page-center">
      <Window title="Página não encontrada" width="narrow">
        <p className="lead-small">Esse endereço não existe. Confira o link ou volte para a página inicial.</p>
      </Window>
    </div>
  );
}
