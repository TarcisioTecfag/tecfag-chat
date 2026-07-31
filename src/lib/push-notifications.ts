import webpush from "web-push";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// Chaves VAPID padrão para ambiente local / produção via ENV
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:suporte2@tecfag.com.br";
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BEl62iUYgUivxIkv69yViEuiBIa7e1G0a2j0Y0wQ4mC1T7o3D2zX6q8W9vR8uY2x0L1M2N3O4P5Q6R7S8T9U0V==";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "u1V2W3X4Y5Z6A7B8C9D0E1F2G3H4I5J6K7L8M9N0O1P=";

// Configurar WebPush com VAPID
try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (err) {
  console.warn("Aviso ao configurar VAPID Keys do WebPush:", err);
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
