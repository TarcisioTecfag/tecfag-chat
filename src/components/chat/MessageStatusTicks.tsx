import type { ReactNode } from "react";
import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";

/**
 * Checks de entrega no padrão do WhatsApp, alimentados pelos webhooks `statuses` da Meta Cloud API:
 *  - sending/pending       → relógio (aguardando a Meta aceitar)
 *  - accepted (sent)       → ✓   enviada aos servidores do WhatsApp
 *  - delivered             → ✓✓  entregue no aparelho do cliente
 *  - read                  → ✓✓  azul, cliente abriu a conversa
 *  - failed                → alerta vermelho com o motivo
 *  - unknown / uncertain   → relógio âmbar (sem confirmação; não reenviar automaticamente)
 *
 * Se o cliente desativou a confirmação de leitura no WhatsApp, a Meta nunca envia "read":
 * a mensagem fica legitimamente em ✓✓ cinza (entregue).
 */

const READ_BLUE = "#53bdeb";

const LABELS: Record<string, string> = {
  sending: "Enviando...",
  pending: "Enviando...",
  accepted: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falha no envio",
  unknown: "Sem confirmação da Meta",
  uncertain: "Sem confirmação da Meta",
};

export function MessageStatusTicks({ status, error }: { status?: string | null; error?: string | null }) {
  if (!status) return null;

  let icon: ReactNode;
  switch (status) {
    case "read":
      icon = <CheckCheck className="h-3.5 w-3.5" style={{ color: READ_BLUE }} strokeWidth={2.5} />;
      break;
    case "delivered":
      icon = <CheckCheck className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2.5} />;
      break;
    case "accepted":
      icon = <Check className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2.5} />;
      break;
    case "failed":
      icon = <AlertCircle className="h-3.5 w-3.5 text-red-500" strokeWidth={2.5} />;
      break;
    case "unknown":
    case "uncertain":
      icon = <Clock className="h-3 w-3 text-amber-500" strokeWidth={2.5} />;
      break;
    case "sending":
    case "pending":
      icon = <Clock className="h-3 w-3 text-muted-foreground" strokeWidth={2.5} />;
      break;
    default:
      return null;
  }

  const label = LABELS[status] || status;
  const content = status === "failed" && error ? `${label}: ${error}` : label;

  return (
    <SystemTooltip content={content}>
      <span className="inline-flex items-center select-none" aria-label={content}>
        {icon}
      </span>
    </SystemTooltip>
  );
}
