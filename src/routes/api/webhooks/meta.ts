import { createFileRoute } from "@tanstack/react-router";
import crypto from "node:crypto";
import { db } from "../../../db";
import { channelConfigs, messages } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import { inboundProcessor } from "../../../lib/whatsapp/inbound";

export const Route = createFileRoute("/api/webhooks/meta")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      // ── GET: Verificação de Webhook pela Meta (Handshake) ───────────────────
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const mode = url.searchParams.get("hub.mode");
          const token = url.searchParams.get("hub.verify_token");
          const challenge = url.searchParams.get("hub.challenge");
          const queryTenantId = url.searchParams.get("tenantId");

          console.log(`[Meta Webhook] Handshake GET recebido. mode=${mode}, token=[REDACTED]`);

          if (mode !== "subscribe" || !token) {
            return new Response("Modo ou token inválido", { status: 400 });
          }

          // Busca qual tenant possui esse verify_token configurado
          let matchedTenantId: string | null = null;
          if (queryTenantId) {
            const [cfg] = await db
              .select({ tenantId: channelConfigs.tenantId, metaVerifyToken: channelConfigs.metaVerifyToken })
              .from(channelConfigs)
              .where(eq(channelConfigs.tenantId, queryTenantId));
            if (cfg && cfg.metaVerifyToken === token) {
              matchedTenantId = cfg.tenantId;
            }
          }

          if (!matchedTenantId) {
            const configs = await db
              .select({ tenantId: channelConfigs.tenantId, metaVerifyToken: channelConfigs.metaVerifyToken })
              .from(channelConfigs);

            const found = configs.find((c) => c.metaVerifyToken === token);
            if (found) matchedTenantId = found.tenantId;
          }

          if (matchedTenantId && challenge) {
            console.log(`[Meta Webhook] Handshake autenticado com sucesso para o tenant '${matchedTenantId}'!`);
            return new Response(challenge, {
              status: 200,
              headers: { "Content-Type": "text/plain" },
            });
          }

          console.warn("[Meta Webhook] Token de verificação não corresponde a nenhum tenant");
          return new Response("Forbidden: Token de verificação incorreto", { status: 403 });
        } catch (err: any) {
          console.error("[Meta Webhook] Erro no handshake GET:", err);
          return new Response("Erro interno", { status: 500 });
        }
      },

      // ── POST: Recebimento de Mensagens e Status de Entrega ──────────────────
      POST: async ({ request }) => {
        try {
          // 1. O cabeçalho de assinatura criptográfica é MANDATÓRIO
          const signatureHeader = request.headers.get("x-hub-signature-256");
          if (!signatureHeader) {
            console.warn("[Meta Webhook] Rejeitado: cabeçalho x-hub-signature-256 ausente.");
            return new Response(JSON.stringify({ error: "Unauthorized: Missing x-hub-signature-256 header" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          const rawBody = await request.text();

          let body: any;
          try {
            body = JSON.parse(rawBody);
          } catch {
            return new Response(JSON.stringify({ error: "JSON inválido" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          // 2. Identificação estrita do tenant pelo phoneNumberId (usa a primeira entry para lookup)
          const url = new URL(request.url);
          const queryTenantId = url.searchParams.get("tenantId");

          const firstEntry = body?.entry?.[0];
          const firstChange = firstEntry?.changes?.[0];
          const firstValue = firstChange?.value;
          const phoneNumberId = firstValue?.metadata?.phone_number_id;

          let matchedTenantId: string | null = null;

          if (phoneNumberId) {
            const [cfg] = await db
              .select({ tenantId: channelConfigs.tenantId })
              .from(channelConfigs)
              .where(eq(channelConfigs.metaPhoneNumberId, phoneNumberId));
            if (cfg) {
              matchedTenantId = cfg.tenantId;
            }
          }

          // Se a requisição veio com ?tenantId= na URL, ela DEVE bater com o tenant resolvido pelo phone_number_id
          if (queryTenantId) {
            if (matchedTenantId && matchedTenantId !== queryTenantId) {
              console.warn(`[Meta Webhook] Conflito de tenant: queryTenantId '${queryTenantId}' != phone tenant '${matchedTenantId}'`);
              return new Response(JSON.stringify({ error: "Tenant da URL não corresponde ao proprietário do phone_number_id" }), {
                status: 403,
                headers: { "Content-Type": "application/json" },
              });
            }
            if (!matchedTenantId) {
              // Verifica se o tenant da URL tem esse phone_number_id
              const [cfg] = await db
                .select({ tenantId: channelConfigs.tenantId, metaPhoneNumberId: channelConfigs.metaPhoneNumberId })
                .from(channelConfigs)
                .where(eq(channelConfigs.tenantId, queryTenantId));
              if (cfg && (!cfg.metaPhoneNumberId || cfg.metaPhoneNumberId === phoneNumberId)) {
                matchedTenantId = cfg.tenantId;
              }
            }
          }

          // Se NENHUM tenant foi localizado para este número, REJEITA imediatamente. NUNCA FAZ FALLBACK!
          if (!matchedTenantId) {
            console.warn(`[Meta Webhook] Rejeitado: phone_number_id '${phoneNumberId}' não cadastrado para nenhum tenant.`);
            return new Response(
              JSON.stringify({ error: "Not Found: Nenhum tenant configurado para este phone_number_id" }),
              { status: 404, headers: { "Content-Type": "application/json" } }
            );
          }

          const tenantId = matchedTenantId;

          // 3. Validação Criptográfica Obrigatória HMAC SHA-256
          const [channelCfg] = await db
            .select()
            .from(channelConfigs)
            .where(eq(channelConfigs.tenantId, tenantId));

          if (!channelCfg?.metaAppSecret) {
            console.warn(`[Meta Webhook] Rejeitado: metaAppSecret não configurado no banco para o tenant '${tenantId}'`);
            return new Response(
              JSON.stringify({ error: "Unauthorized: metaAppSecret não configurado para este tenant" }),
              { status: 401, headers: { "Content-Type": "application/json" } }
            );
          }

          const expectedHash = crypto
            .createHmac("sha256", channelCfg.metaAppSecret)
            .update(rawBody, "utf8")
            .digest("hex");
          const expectedSignature = `sha256=${expectedHash}`;

          const isValid =
            signatureHeader.length === expectedSignature.length &&
            crypto.timingSafeEqual(
              Buffer.from(signatureHeader),
              Buffer.from(expectedSignature)
            );

          if (!isValid) {
            console.warn(`[Meta Webhook] Assinatura HMAC SHA-256 INVÁLIDA para o tenant '${tenantId}'`);
            return new Response(JSON.stringify({ error: "Unauthorized: Assinatura inválida" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          // 4. PERSISTÊNCIA SÍNCRONA & DURÁVEL — processa TODAS as entries e changes do lote
          let processedMessagesCount = 0;
          let processedStatusesCount = 0;

          for (const batchEntry of body?.entry ?? []) {
            for (const batchChange of batchEntry?.changes ?? []) {
              const value = batchChange?.value;
              if (!value) continue;

              // 4.1. Mensagens recebidas
              const incomingMessages = value?.messages;
              if (Array.isArray(incomingMessages) && incomingMessages.length > 0) {
                const contactProfile = value?.contacts?.[0]?.profile?.name;

                for (const msg of incomingMessages) {
                  const messageId = msg.id;
                  const fromPhone = msg.from;
                  const timestamp = msg.timestamp
                    ? new Date(parseInt(msg.timestamp, 10) * 1000)
                    : new Date();

                  let textContent: string | undefined;
                  let mediaInfo: any;

                  if (msg.type === "text") {
                    textContent = msg.text?.body;
                  } else if (msg.type === "image" || msg.type === "audio" || msg.type === "video" || msg.type === "document") {
                    const mediaObj = msg[msg.type];
                    textContent = mediaObj?.caption;
                    mediaInfo = {
                      mimeType: mediaObj?.mime_type || "application/octet-stream",
                      fileName: mediaObj?.filename || `${msg.type}_${messageId}`,
                      fileSize: mediaObj?.file_size,
                      url: `https://graph.facebook.com/v21.0/${mediaObj?.id}`,
                    };
                  }

                  // Processamento SÍNCRONO: persistido em pending_inbounds e na tabela messages antes do 200
                  const result = await inboundProcessor.process({
                    externalEventId: `meta:${tenantId}:${messageId}`,
                    tenantId,
                    provider: "meta",
                    fromPhone,
                    senderName: contactProfile,
                    text: textContent,
                    media: mediaInfo,
                    quotedExternalId: msg.context?.id,
                    timestamp,
                    rawPayload: msg,
                  });

                  if (result.success) {
                    processedMessagesCount++;
                  }
                }
              }

              // 4.2. Atualizações de Status de Mensagens Enviadas (statuses)
              const statuses = value?.statuses;
              if (Array.isArray(statuses) && statuses.length > 0) {
                for (const statusObj of statuses) {
                  const wamid = statusObj.id;
                  const metaStatus = statusObj.status; // 'sent', 'delivered', 'read', 'failed'

                  let mappedStatus: "accepted" | "delivered" | "read" | "failed" = "accepted";

                  if (metaStatus === "delivered") mappedStatus = "delivered";
                  else if (metaStatus === "read") mappedStatus = "read";
                  else if (metaStatus === "failed") mappedStatus = "failed";

                  // Atualização SÍNCRONA no banco
                  await db
                    .update(messages)
                    .set({
                      status: mappedStatus,
                      errorMessage: statusObj.errors?.[0]?.message || null,
                      updatedAt: new Date(),
                    })
                    .where(
                      and(
                        eq(messages.tenantId, tenantId),
                        eq(messages.externalId, wamid)
                      )
                    );

                  processedStatusesCount++;
                } // fim for statusObj
              } // fim if statuses
            } // fim for batchChange
          } // fim for batchEntry

          // 5. Retorna 200 OK com confirmação de que os dados foram persistidos com segurança
          return new Response(
            JSON.stringify({
              success: true,
              tenantId,
              processedMessages: processedMessagesCount,
              processedStatuses: processedStatusesCount,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        } catch (err: any) {
          console.error("[Meta Webhook POST] Erro fatal durante processamento síncrono:", err);
          // Retornar 500 para que a Meta retente o envio do webhook em caso de falha de banco
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
