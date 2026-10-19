import webpush from "web-push";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { eq, and } from "drizzle-orm";

function sanitizeUrlSafeBase64(val: string): string {
  return val.trim().replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// Chaves VAPID padrão para ambiente local / produção via ENV
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:suporte2@tecfag.com.br";
let VAPID_PUBLIC_KEY = sanitizeUrlSafeBase64(process.env.VAPID_PUBLIC_KEY || "");
let VAPID_PRIVATE_KEY = sanitizeUrlSafeBase64(process.env.VAPID_PRIVATE_KEY || "");

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  const generated = webpush.generateVAPIDKeys();
  VAPID_PUBLIC_KEY = sanitizeUrlSafeBase64(generated.publicKey);
  VAPID_PRIVATE_KEY = sanitizeUrlSafeBase64(generated.privateKey);
}

// Configurar WebPush com VAPID
try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (err) {
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
  if (!tenantId || !operatorId) {
    console.warn("[Push] TenantId e OperatorId são obrigatórios.");
    return { success: false, sentCount: 0 };
  }

  try {
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
        // Se a assinatura expirou ou foi cancelada no celular (410 Gone / 404 Not Found), removemos do banco
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db
            .delete(pushSubscriptions)
            .where(
              and(
                eq(pushSubscriptions.tenantId, tenantId),
                eq(pushSubscriptions.id, sub.id)
              )
            );
        } else {
          console.error(`[Push] Erro ao enviar notificação para dispositivo ${sub.id}:`, err.message || err);
        }
      }
    }

    return { success: true, sentCount };
  } catch (err) {
    console.error("[Push] Erro na execução de sendPushToOperator:", err);
    return { success: false, sentCount: 0 };
  }
}
