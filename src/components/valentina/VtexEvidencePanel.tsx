import { readVtexEvidence } from "@/lib/vtex/contract";
const labels: Record<string, string> = {
  matched: "Produto e variante consultados",
  choices: "Aguardando escolha de produto ou variante",
  not_found: "Referência não localizada",
  unavailable: "Consulta indisponível",
  disabled: "Integração desativada",
  policy_blocked: "Informação bloqueada pela política do canal",
};
export function VtexEvidencePanel({ evidence }: { evidence: unknown }) {
  const value = readVtexEvidence(evidence);
  if (!value) return null;
  return (
    <section
      className="rounded-lg border border-border p-3 space-y-1 text-xs"
      aria-label="Consulta oficial da loja"
    >
      <h4 className="font-semibold">Consulta oficial da loja — VTEX</h4>
      <p>{labels[value.status]}</p>
      {value.productName && <p>{value.productName}</p>}
      {value.selectedSkuId && <p>SKU consultado: {value.selectedSkuId}</p>}
      {value.productUrl && (
        <a
          className="text-primary underline break-all"
          target="_blank"
          rel="noopener noreferrer"
          href={value.productUrl}
        >
          Ver produto na loja
        </a>
      )}
      <p className="text-muted-foreground">
        {new Date(value.checkedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}{" "}
        (Brasília) · {value.channel === "livechat" ? "Site" : "WhatsApp"}
      </p>
      <p className="text-muted-foreground">
        A consulta não confirma compra, reserva ou adequação técnica.
      </p>
    </section>
  );
}
