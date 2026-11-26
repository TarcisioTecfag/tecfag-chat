export const PENDING_MESSAGE_PREFIX = "pending-";

export function isOptimisticPendingMessageId(messageId?: string | null): boolean {
  return typeof messageId === "string" && messageId.startsWith(PENDING_MESSAGE_PREFIX) && messageId.length > PENDING_MESSAGE_PREFIX.length;
}

export function extractPendingClientMessageId(
  messageId?: string | null,
  explicitClientMessageId?: string | null,
): string | null {
  const explicit = typeof explicitClientMessageId === "string" ? explicitClientMessageId.trim() : "";
  if (explicit) return explicit;
  if (isOptimisticPendingMessageId(messageId)) {
    const derived = messageId!.slice(PENDING_MESSAGE_PREFIX.length).trim();
    return derived || null;
  }
  return null;
}

export interface ReconcileApiResult {
  success?: boolean;
  messageId?: string;
  status?: string;
  error?: string;
  code?: string;
}

export interface ReconcileOrRetryParams {
  messageId: string;
  clientMessageId?: string | null;
  action: "resend" | "confirm_sent";
  uncertain: boolean;
  confirmPrompt: (message: string) => boolean;
  callReconcileApi: (payload: {
    messageId: string;
    clientMessageId?: string;
    action: "resend" | "confirm_sent";
    confirmNotDelivered: boolean;
  }) => Promise<{ status: number; ok: boolean; body: ReconcileApiResult }>;
  resendLocally: (clientMessageId: string) => Promise<boolean>;
}

export type ReconcileOrRetryOutcome =
  | { outcome: "cancelled" }
  | { outcome: "reconciled_on_server"; result: ReconcileApiResult }
  | { outcome: "resent_locally" }
  | { outcome: "local_resend_failed" }
  | { outcome: "not_found_on_server_for_confirm"; error: string }
  | { outcome: "error"; error: string };

const CONFIRM_SENT_PROMPT = "Você conferiu o WhatsApp e confirma que a mensagem já foi enviada?";
const CONFIRM_NOT_DELIVERED_PROMPT =
  "Você conferiu o histórico e confirma que a mensagem anterior NÃO foi enviada?";

/**
 * Orquestra a reconciliação segura de mensagens incertas/falhas, inclusive balões otimistas
 * (`pending-<clientMessageId>`) cujo POST inicial falhou por erro de rede no navegador.
 *
 * Fluxo garantido sem duplicidade:
 * 1. Para `pending-...` + `resend`, consulta o servidor primeiro por `id` e `clientMessageId` (`idempotencyKey`).
 *    - Se o servidor já recebeu e enviou (`200`), evita reenvio duplicado.
 *    - Se o servidor tem registro incerto (`409 DELIVERY_CONFIRMATION_REQUIRED`), pede confirmação ao operador e repete com `confirmNotDelivered: true`.
 *    - Se o servidor retorna `404` (`MESSAGE_NOT_FOUND`), temos certeza de que o envio nunca chegou ao servidor
 *      (pois o backend persiste `idempotencyKey` antes de acionar Meta/Baileys) e executa o reenvio local com o MESMO `clientMessageId`.
 * 2. Para `pending-...` + `confirm_sent`, se o servidor retornar `404`, informa claramente que o envio
 *    não chegou ao servidor em vez de exibir um erro genérico "Envio não encontrado.".
 */
export async function reconcileOrRetryMessage(
  params: ReconcileOrRetryParams,
): Promise<ReconcileOrRetryOutcome> {
  const {
    messageId,
    clientMessageId,
    action,
    uncertain,
    confirmPrompt,
    callReconcileApi,
    resendLocally,
  } = params;

  const isPending = isOptimisticPendingMessageId(messageId);
  const resolvedClientMessageId = extractPendingClientMessageId(messageId, clientMessageId);

  // Para mensagens já persistidas no banco (não-pending) ou confirmação manual de envio,
  // exige confirmação explícita antes de chamar o servidor quando o estado é incerto.
  let confirmedNotDelivered = false;
  if (uncertain && (!isPending || action === "confirm_sent")) {
    const prompt = action === "confirm_sent" ? CONFIRM_SENT_PROMPT : CONFIRM_NOT_DELIVERED_PROMPT;
    if (!confirmPrompt(prompt)) {
      return { outcome: "cancelled" };
    }
    confirmedNotDelivered = action === "resend";
  }

  let apiRes = await callReconcileApi({
    messageId,
    ...(resolvedClientMessageId ? { clientMessageId: resolvedClientMessageId } : {}),
    action,
    confirmNotDelivered: action === "resend" && confirmedNotDelivered,
  });

  // Se era um balão otimista `pending-...` que na verdade chegou ao servidor e ficou em estado incerto,
  // o servidor retorna 409 DELIVERY_CONFIRMATION_REQUIRED: pedimos confirmação agora e repetimos.
  if (
    !apiRes.ok &&
    apiRes.status === 409 &&
    apiRes.body?.code === "DELIVERY_CONFIRMATION_REQUIRED" &&
    action === "resend" &&
    !confirmedNotDelivered
  ) {
    if (!confirmPrompt(CONFIRM_NOT_DELIVERED_PROMPT)) {
      return { outcome: "cancelled" };
    }
    apiRes = await callReconcileApi({
      messageId,
      ...(resolvedClientMessageId ? { clientMessageId: resolvedClientMessageId } : {}),
      action,
      confirmNotDelivered: true,
    });
  }

  // O request inicial nunca chegou ao servidor (404 por id e por idempotencyKey).
  if (!apiRes.ok && apiRes.status === 404 && isPending) {
    if (action === "resend" && resolvedClientMessageId) {
      const sent = await resendLocally(resolvedClientMessageId);
      return sent ? { outcome: "resent_locally" } : { outcome: "local_resend_failed" };
    }
    return {
      outcome: "not_found_on_server_for_confirm",
      error:
        "Esta mensagem não chegou ao servidor e não foi enviada pelo sistema. Clique em 'Reenviar' para enviá-la.",
    };
  }

  if (!apiRes.ok) {
    return {
      outcome: "error",
      error: apiRes.body?.error || "Não foi possível reconciliar.",
    };
  }

  if (!apiRes.body?.success) {
    return {
      outcome: "error",
      error: apiRes.body?.error || "Envio ainda não confirmado.",
    };
  }

  return {
    outcome: "reconciled_on_server",
    result: apiRes.body,
  };
}
