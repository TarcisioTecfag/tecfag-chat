import type { IndustrialMonitoring } from "@/lib/triage/industrial-monitor";
import { SiteContextPanel } from "./SiteContextPanel";

const deliveryLabels: Record<string, string> = {
  sent: "Enviada",
  pending: "Pendente de envio",
  not_required: "Não necessária",
  unknown: "Sem confirmação registrada",
  cancelled: "Cancelada após alteração do atendimento",
  failed: "Tentativas automáticas esgotadas",
};
const reasons: Record<string, string> = {
  human_requested: "Cliente pediu atendimento humano",
  specialist_review: "Solicitação requer especialista",
  classification_pending: "Classificação requer revisão",
  catalog_confirmed: "Referência confirmada no catálogo",
  premium_requires_review: "Linha Personnalité requer revisão",
  capacity_requires_review: "Produção requer avaliação técnica",
  category_conflict: "Referência e aplicação precisam ser conferidas",
  decisor_unavailable: "Classificação temporariamente indisponível",
  capital_requires_review: "Solicitação requer avaliação comercial",
  unconfirmed_model_match: "Referência ainda não confirmada",
};
const fields: Record<string, string> = {
  name: "Nome",
  document: "CPF/CNPJ válido",
  request: "Solicitação",
  application: "Aplicação",
  production: "Produção",
};
export function IndustrialMonitoringPanel({ monitoring: m }: { monitoring: IndustrialMonitoring }) {
  const reason = reasons[m.machine?.reason || ""] || reasons[m.reason || ""];
  return (
    <section
      className="mx-4 my-3 rounded-xl border border-border bg-muted/30 p-3 space-y-2"
      aria-label="Situação da triagem"
    >
      <p className="text-xs font-bold">{m.label}</p>
      <SiteContextPanel context={m.siteContext} />
      {[m.issue, m.clientIssue, m.operatorIssue].filter(Boolean).map((issue) => (
        <div
          key={issue!.code}
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs space-y-1"
          role="status"
        >
          <p className="font-semibold">{issue!.title}</p>
          <p className="text-muted-foreground">{issue!.action}</p>
        </div>
      ))}
      {m.targetFunnel && <p className="text-xs">Destino: {m.targetFunnel}</p>}
      {m.needsReview && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Revisão humana necessária</p>
      )}
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
      {m.machine?.line && <p className="text-xs">Linha: {m.machine.line}</p>}
      {m.missingFields.length > 0 && (
        <p className="text-xs">
          Falta coletar: {m.missingFields.map((f) => fields[f] || f).join(", ")}
        </p>
      )}
      {m.committedAt && (
        <p className="text-xs">Confirmação ao cliente: {deliveryLabels[m.clientConfirmation]}</p>
      )}
      {m.committedAt && (
        <p className="text-xs">Aviso ao responsável: {deliveryLabels[m.operatorNotification]}</p>
      )}
      {(m.clientConfirmation === "failed" || m.operatorNotification === "failed") && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Confira o canal ou as notificações internas antes de fazer contato manual. A atribuição já
          concluída será preservada.
        </p>
      )}
      {m.attempts > 0 && !m.committedAt && (
        <p className="text-xs text-muted-foreground">Tentativas de encaminhamento: {m.attempts}</p>
      )}
      {m.continuedFrom && (
        <p className="text-xs">
          Atendimento continuado do{" "}
          {m.continuedFrom.channel === "livechat" ? "site" : "outro canal"}. Dados coletados
          preservados.
        </p>
      )}
      {m.continuedTo && (
        <p className="text-xs">
          Atendimento segue no {m.continuedTo.channel === "whatsapp" ? "WhatsApp" : "outro canal"}.
        </p>
      )}
    </section>
  );
}
