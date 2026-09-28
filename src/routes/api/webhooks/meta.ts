import { createFileRoute } from "@tanstack/react-router";
import crypto from "node:crypto";
import { db } from "../../../db";
import { channelConfigs, messages, pendingInbounds } from "../../../db/schema";
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

          // 2. Identificação estrita do tenant — resolve phone_number_id de CADA change no lote.
          // A Meta garante que um lote de webhook pertence a um único número, mas validamos
          // explicitamente para rejeitar lotes inconsistentes antes de qualquer processamento.
          //
          // NUNCA usa ?tenantId= da URL como autoridade de lookup — apenas como verificação cruzada opcional.
          const url = new URL(request.url);
          const queryTenantId = url.searchParams.get("tenantId"); // apenas para log/verificação cruzada

          const allPhoneNumberIds = new Set<string>();
          for (const e of body?.entry ?? []) {
            for (const c of e?.changes ?? []) {
              const pid = c?.value?.metadata?.phone_number_id;
              if (pid) allPhoneNumberIds.add(pid);
            }
          }

          if (allPhoneNumberIds.size === 0) {
            // Sem phone_number_id não é possível identificar o tenant nem validar a assinatura HMAC.
            // Retornar 400 — não podemos aceitar o evento com segurança.
            console.warn("[Meta Webhook] Rejeitado: lote sem phone_number_id — impossível validar assinatura HMAC.");
            return new Response(
              JSON.stringify({ error: "Bad Request: payload sem phone_number_id — formato não suportado" }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          // Resolve tenantId para cada phoneNumberId único do lote e verifica consistência
          const tenantsByPhone = new Map<string, string>();
          for (const pid of allPhoneNumberIds) {
            const [cfg] = await db
              .select({ tenantId: channelConfigs.tenantId })
              .from(channelConfigs)
              .where(eq(channelConfigs.metaPhoneNumberId, pid));

            if (!cfg) {
              console.warn(`[Meta Webhook] Rejeitado: phone_number_id '${pid}' não cadastrado para nenhum tenant.`);
              return new Response(
                JSON.stringify({ error: `Not Found: phone_number_id '${pid}' não cadastrado` }),
                { status: 404, headers: { "Content-Type": "application/json" } }
              );
            }
            tenantsByPhone.set(pid, cfg.tenantId);
          }

          // Verifica que todos os phoneNumberIds do lote pertencem ao mesmo tenant
          const uniqueTenants = new Set(tenantsByPhone.values());
          if (uniqueTenants.size > 1) {
            console.warn(`[Meta Webhook] Lote com números de tenants distintos: ${[...uniqueTenants].join(", ")}. Rejeitado.`);
            return new Response(
              JSON.stringify({ error: "Lote inválido: números de tenants distintos no mesmo payload." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          const tenantId = [...uniqueTenants][0];

          // Verificação cruzada: se veio ?tenantId= na URL, deve bater com o tenant resolvido pelo número
          if (queryTenantId && queryTenantId !== tenantId) {
            console.warn(`[Meta Webhook] Conflito: queryTenantId='${queryTenantId}' != tenant resolvido='${tenantId}'`);
            return new Response(
              JSON.stringify({ error: "Tenant da URL não corresponde ao proprietário do phone_number_id" }),
              { status: 403, headers: { "Content-Type": "application/json" } }
            );
          }


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
          let unprocessableItemsCount = 0;
          const unprocessableErrors: string[] = [];

          for (const batchEntry of body?.entry ?? []) {
            for (const batchChange of batchEntry?.changes ?? []) {
              const value = batchChange?.value;
              if (!value) continue;

              const incomingMessages = value?.messages;
              const statuses = value?.statuses;
              const hasActionableContent =
                (Array.isArray(incomingMessages) && incomingMessages.length > 0) ||
                (Array.isArray(statuses) && statuses.length > 0);

              // Confirmar que este change tem phone_number_id pertencente ao tenant resolvido.
              const changePid = value?.metadata?.phone_number_id;

              if (!changePid) {
                // Se NÃO tem mensagens nem status (ex: evento genérico de conta ou heartbeat), pode ser ignorado sem perda de dados
                if (!hasActionableContent) {
                  console.info(`[Meta Webhook] Change sem mensagens/status e sem phone_number_id ignorado com segurança (tenant '${tenantId}').`);
                  continue;
                }

                // Se TEM mensagens ou status mas NÃO TEM phone_number_id:
                // NÃO pode ser descartado silenciosamente!
                // Deve ser guardado em pending_inbounds com status 'pending' (para o recovery worker reprocessar)
                // com externalEventId determinístico para evitar multiplicação de registros a cada retry da Meta.
                console.error(`[Meta Webhook] FALHA CRÍTICA: Change contém mensagens/status mas phone_number_id está ausente! Gravando em pending_inbounds como pending para recuperação (tenant '${tenantId}').`);
                unprocessableItemsCount++;
                unprocessableErrors.push("Change contém mensagens/status mas metadata.phone_number_id está ausente");

                const firstMsgId = incomingMessages?.[0]?.id;
                const firstStatusId = statuses?.[0]?.id;
                const eventFingerprint = firstMsgId
                  ? `msg:${firstMsgId}`
                  : firstStatusId
                  ? `status:${firstStatusId}:${statuses?.[0]?.status || ""}`
                  : `raw:${crypto.createHash("sha256").update(JSON.stringify(batchChange)).digest("hex").substring(0, 16)}`;

                const orphanEventId = `meta:${tenantId}:orphan:${eventFingerprint}`;
                const orphanId = `inb_orphan_${crypto.createHash("sha256").update(orphanEventId).digest("hex").substring(0, 24)}`;

                try {
                  const [existingOrphan] = await db
                    .select({ id: pendingInbounds.id, attempts: pendingInbounds.attempts })
                    .from(pendingInbounds)
                    .where(
                      and(
                        eq(pendingInbounds.tenantId, tenantId),
                        eq(pendingInbounds.externalEventId, orphanEventId)
                      )
                    );

                  if (existingOrphan) {
                    await db
                      .update(pendingInbounds)
                      .set({
                        attempts: (existingOrphan.attempts || 1) + 1,
                        errorMessage: "Retentativa Meta: Change contém mensagens/status mas metadata.phone_number_id ausente",
                        nextRetryAt: new Date(Date.now() + 60000),
                      })
                      .where(eq(pendingInbounds.id, existingOrphan.id));
                  } else {
                    await db.insert(pendingInbounds).values({
                      id: orphanId,
                      tenantId,
                      provider: "meta",
                      externalEventId: orphanEventId,
                      payload: batchChange,
                      status: "pending",
                      attempts: 1,
                      nextRetryAt: new Date(Date.now() + 60000),
                      errorMessage: "Change contém mensagens/status mas metadata.phone_number_id ausente no webhook",
                      createdAt: new Date(),
                    });
                  }
                } catch (dbErr) {
                  console.error("[Meta Webhook] Erro ao gravar evento não processável em pending_inbounds:", dbErr);
                }

                continue;
              }

              if (tenantsByPhone.get(changePid) !== tenantId) {
                // Defesa em profundidade: inconsistência entre número do change e tenant resolvido
                console.error(`[Meta Webhook] FALHA CRÍTICA: Change com phone_number_id '${changePid}' diverge do tenant '${tenantId}' do lote! Gravando para análise.`);
                unprocessableItemsCount++;
                unprocessableErrors.push(`Change com phone_number_id '${changePid}' inconsistente com tenant '${tenantId}'`);

                const firstMsgId = incomingMessages?.[0]?.id;
                const firstStatusId = statuses?.[0]?.id;
                const eventFingerprint = firstMsgId
                  ? `msg:${firstMsgId}`
                  : firstStatusId
                  ? `status:${firstStatusId}:${statuses?.[0]?.status || ""}`
                  : `raw:${crypto.createHash("sha256").update(JSON.stringify(batchChange)).digest("hex").substring(0, 16)}`;

                const mismatchEventId = `meta:${tenantId}:mismatch:${eventFingerprint}`;
                const mismatchId = `inb_mismatch_${crypto.createHash("sha256").update(mismatchEventId).digest("hex").substring(0, 24)}`;

                try {
                  const [existingMismatch] = await db
                    .select({ id: pendingInbounds.id, attempts: pendingInbounds.attempts })
                    .from(pendingInbounds)
                    .where(
                      and(
                        eq(pendingInbounds.tenantId, tenantId),
                        eq(pendingInbounds.externalEventId, mismatchEventId)
                      )
                    );

                  if (existingMismatch) {
                    await db
                      .update(pendingInbounds)
                      .set({
                        attempts: (existingMismatch.attempts || 1) + 1,
                        errorMessage: `Retentativa Meta: phone_number_id '${changePid}' diverge do tenant '${tenantId}' do lote`,
                        nextRetryAt: new Date(Date.now() + 60000),
                      })
                      .where(eq(pendingInbounds.id, existingMismatch.id));
                  } else {
                    await db.insert(pendingInbounds).values({
                      id: mismatchId,
                      tenantId,
                      provider: "meta",
                      externalEventId: mismatchEventId,
                      payload: batchChange,
                      status: "pending",
                      attempts: 1,
                      nextRetryAt: new Date(Date.now() + 60000),
                      errorMessage: `phone_number_id '${changePid}' diverge do tenant '${tenantId}' do lote`,
                      createdAt: new Date(),
                    });
                  }
                } catch (dbErr) {
                  console.error("[Meta Webhook] Erro ao gravar evento divergente em pending_inbounds:", dbErr);
                }

                continue;
              }

              // 5.1. Mensagens recebidas
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
                  } else {
                    // Se o processamento do inbound falhou, NÃO responder 200!
                    // Contabilizar como item não processável para retornar HTTP 500 e acionar retry da Meta.
                    unprocessableItemsCount++;
                    unprocessableErrors.push(result.error || `Falha ao processar mensagem ${messageId}`);
                    console.error(`[Meta Webhook] InboundProcessor falhou ao processar mensagem ${messageId}:`, result.error);
                  }
                }
              }

              // 4.2. Atualizações de Status de Mensagens Enviadas (statuses)
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

          // 5. Se houve algum item com mensagem/status que não pôde ser processado com integridade,
          // responder HTTP 500 (falha recuperável) para que a Meta retente o lote e o monitoramento seja alertado.
          // O evento já foi salvo em pending_inbounds para não haver perda de dados.
          if (unprocessableItemsCount > 0) {
            console.error(`[Meta Webhook] Lote finalizado com ${unprocessableItemsCount} item(ns) acionável(is) não processado(s). Retornando 500 para retry da Meta.`);
            return new Response(
              JSON.stringify({
                error: "Erro recuperável: item(ns) acionáveis não processáveis no lote. Eventos guardados em pending_inbounds para análise.",
                tenantId,
                unprocessableItemsCount,
                errors: unprocessableErrors,
                processedMessages: processedMessagesCount,
                processedStatuses: processedStatusesCount,
              }),
              {
                status: 500,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          // 6. Retorna 200 OK com confirmação de que 100% dos dados acionáveis foram persistidos com segurança
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
