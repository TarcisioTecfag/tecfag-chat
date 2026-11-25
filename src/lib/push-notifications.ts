import webpush from "web-push";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { loadOperatorAccess } from "./access-control/operator-context";
import { requireConversationAccess } from "./access-control/conversation-access";

function sanitizeUrlSafeBase64(val: string): string {
  return val.trim().replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// Chaves VAPID padrão para ambiente local / produção via ENV
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:suporte2@tecfag.com.br";
let VAPID_PUBLIC_KEY = sanitizeUrlSafeBase64(process.env.VAPID_PUBLIC_KEY || "");
let VAPID_PRIVATE_KEY = sanitizeUrlSafeBase64(process.env.VAPID_PRIVATE_KEY || "");
let usingEphemeralVapidKeys = false;

const isDeployedRuntime = Boolean(
  process.env.NODE_ENV === "production" ||
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_SERVICE_ID
);

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  const generated = webpush.generateVAPIDKeys();
  VAPID_PUBLIC_KEY = sanitizeUrlSafeBase64(generated.publicKey);
  VAPID_PRIVATE_KEY = sanitizeUrlSafeBase64(generated.privateKey);
  usingEphemeralVapidKeys = true;
  if (isDeployedRuntime) {
    console.error(
      "[Push] AVISO CRÍTICO: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas no ambiente. Usando chaves efêmeras em memória — todas as assinaturas push serão invalidadas após restart/deploy!"
    );
  }
}

// Configurar WebPush com VAPID
try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (err) {
  usingEphemeralVapidKeys = true;
  console.error("[Push] Falha ao aplicar chaves VAPID do ambiente; usando fallback efêmero:", err);
  try {
    const fallback = webpush.generateVAPIDKeys();
    VAPID_PUBLIC_KEY = sanitizeUrlSafeBase64(fallback.publicKey);
    VAPID_PRIVATE_KEY = sanitizeUrlSafeBase64(fallback.privateKey);
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (fallbackErr) {
    console.warn("Aviso ao configurar VAPID Keys do WebPush:", fallbackErr);
  }
}

export function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY;
}

export function isUsingEphemeralVapidKeys() {
  return usingEphemeralVapidKeys;
}

export function extractPushEndpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host || "unknown";
  } catch {
    return "unknown";
  }
}

export function formatPushErrorSummary(
  err: any,
  endpoint: string
): { statusCode: number | "unknown"; host: string; message: string; body: string } {
  const statusCode = typeof err?.statusCode === "number" ? err.statusCode : "unknown";
  const host = extractPushEndpointHost(endpoint);
  const message = String(err?.message || err || "Unknown push error").trim();
  const body = typeof err?.body === "string" ? err.body.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  return { statusCode, host, message, body };
}

export function isPermanentSubscriptionFailure(
  err: any,
  ephemeralVapid = usingEphemeralVapidKeys
): boolean {
  const statusCode = typeof err?.statusCode === "number" ? err.statusCode : null;
  if (statusCode === 404 || statusCode === 410) return true;
  if (!ephemeralVapid && (statusCode === 401 || statusCode === 403)) return true;
  if (
    !ephemeralVapid &&
    statusCode === 400 &&
    typeof err?.body === "string" &&
    /vapid|pkhashmismatch|invalidregistration|unregistered|mismatch/i.test(err.body)
  ) {
    return true;
  }
  return false;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  conversationId?: string;
  unreadCount?: number;
  tenantId: string;
  icon?: string;
  url?: string;
}

/**
 * Envia notificação Push EXCLUSIVAMENTE para o operador atribuído à conversa
 * respeitando o isolamento do tenant.
 */
export async function sendPushToOperator(
  tenantId: string,
  operatorId: string,
  payload: PushNotificationPayload
) {
  if (!tenantId || !operatorId || payload.tenantId !== tenantId || !payload.conversationId) {
    console.warn("[Push] TenantId e OperatorId são obrigatórios.");
    return { success: false, sentCount: 0 };
  }

  try {
    const principal = await loadOperatorAccess(tenantId, operatorId);
    if (!principal || await requireConversationAccess(principal, payload.conversationId)) return { success: false, sentCount: 0 };
    // Buscar assinaturas ativas do operador filtradas estritamente pelo tenant
    const subscriptions = await db
      .select()
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.tenantId, tenantId),
          eq(pushSubscriptions.operatorId, operatorId)
        )
      );

    if (subscriptions.length === 0) {
      return { success: true, sentCount: 0 };
    }

    let sentCount = 0;
    const stringifiedPayload = JSON.stringify(payload);

    for (const sub of subscriptions) {
      const pushSubscriptionObj = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscriptionObj, stringifiedPayload);
        sentCount++;
      } catch (err: any) {
        const summary = formatPushErrorSummary(err, sub.endpoint);
        if (isPermanentSubscriptionFailure(err)) {
          await db
            .delete(pushSubscriptions)
            .where(
              and(
                eq(pushSubscriptions.tenantId, tenantId),
                eq(pushSubscriptions.id, sub.id)
              )
            );
          console.warn(
            `[Push] Assinatura inválida removida (id=${sub.id}, status=${summary.statusCode}, host=${summary.host}): ${summary.body || summary.message}`
          );
        } else {
          console.error(
            `[Push] Erro ao enviar notificação para dispositivo ${sub.id} (status=${summary.statusCode}, host=${summary.host}): ${summary.message}${summary.body ? ` | body=${summary.body}` : ""}`
          );
        }
      }
    }

    return { success: true, sentCount };
  } catch (err) {
    console.error("[Push] Erro na execução de sendPushToOperator:", err);
    return { success: false, sentCount: 0 };
  }
}
