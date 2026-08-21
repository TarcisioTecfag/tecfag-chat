// ══════════════════════════════════════════════════════════════════════════════
// 🌉 LIVE CHAT BRIDGE — Ponte Live Chat Site → WhatsApp Baileys
// Acionado pela Valentina quando detecta atacado qualificado:
//   CNPJ valido + quantidade >= 1.000 unidades
// Fluxo: visitante no site → Valentina identifica → envia msg no WA → SDR continua
// ══════════════════════════════════════════════════════════════════════════════

import { updateChatStatus, saveMessage, getVisitorById } from "./livechatStorage";
import { SessionManager } from "../baileys/session-manager";
import { db } from "../../db";
import { conversations, contacts } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

const uuid = () => crypto.randomUUID();

export interface BridgeResult {
  success: boolean;
  waConversationId?: string;
  error?: string;
}

/**
 * Executa o bridge: envia mensagem no WhatsApp e vincula a sessão do site.
 *
 * @param tenantId  Tenant (sempre "valem")
 * @param chatId    ID do lcChat que está sendo encerrado no site
 * @param visitorId ID do visitante (para buscar dados coletados)
 * @param phone     Número do WhatsApp do visitante (E.164 sem +: "5511987654321")
 */
export async function bridgeLiveChatToWhatsApp(
  tenantId: string,
  chatId: string,
  visitorId: string,
  phone: string
): Promise<BridgeResult> {
  try {
    const visitor = await getVisitorById(tenantId, visitorId);
    if (!visitor) {
      return { success: false, error: "Visitante não encontrado" };
    }

    // 1. Monta a mensagem de abertura no WhatsApp com o contexto coletado no site
    const contextLines: string[] = [];
    if (visitor.name)             contextLines.push(`👤 *Nome:* ${visitor.name}`);
    if (visitor.company)          contextLines.push(`🏢 *Empresa:* ${visitor.company}`);
    if (visitor.cnpj)             contextLines.push(`📄 *CNPJ:* ${visitor.cnpj}`);
    if (visitor.productInterest)  contextLines.push(`📦 *Produto:* ${visitor.productInterest}`);
    if (visitor.quantityInterest) contextLines.push(`📊 *Quantidade:* ${visitor.quantityInterest}`);
    if (visitor.currentUrl)       contextLines.push(`🔗 *Página:* ${visitor.currentUrl}`);

    const contextBlock = contextLines.length > 0
      ? `\n\n${contextLines.join("\n")}`
      : "";

    const waMessage = [
      `Olá! Sou a Valentina da *Valem Válvulas e Embalagens* 😊`,
      ``,
      `Vi que você estava navegando em nosso site com interesse em produtos para atacado.`,
      `Que bom te encontrar aqui no WhatsApp também!${contextBlock}`,
      ``,
      `Posso te dar uma proposta personalizada? Para isso, preciso apenas confirmar alguns detalhes. 🤝`,
    ].join("\n");

    // 2. Envia mensagem no WhatsApp via Baileys
    const cleanPhone = phone.replace(/\D/g, "");
    const phoneJid = cleanPhone.includes("@") ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;
    
    let waConversationId: string | undefined;

    try {
      const sessionManager = SessionManager.getInstance();
      const sock = sessionManager.getSession(tenantId);
      if (!sock || sessionManager.getStatus(tenantId) !== "connected") {
        console.warn(`[LC Bridge] Sessão Baileys não conectada para tenant ${tenantId}`);
        return { success: false, error: "WhatsApp não está conectado no momento" };
      }

      await sock.sendMessage(phoneJid, { text: waMessage });
      console.log(`[LC Bridge] ✅ Mensagem WA enviada para ${phone} (tenant: ${tenantId})`);
    } catch (sendErr: any) {
      console.error("[LC Bridge] Erro ao enviar WA:", sendErr?.message);
      return { success: false, error: `Falha ao enviar WhatsApp: ${sendErr?.message}` };
    }

    // 3. Verifica se já existe conversa/contato com este número para vincular
    try {
      const [existingContact] = await db
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, tenantId),
            eq(contacts.phone, cleanPhone)
          )
        )
        .limit(1);

      if (existingContact) {
        const [existingConv] = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              eq(conversations.contactId, existingContact.id)
            )
          )
          .limit(1);

        waConversationId = existingConv?.id;
      }
    } catch {
      // Não crítico — o vínculo é opcional para o bridge funcionar
    }

    // 4. Atualiza status do chat do site para bridge_sent
    await updateChatStatus(tenantId, chatId, "bridge_sent", {
      outcome: "bridge_whatsapp",
      waConversationId,
    });

    // 5. Salva mensagem de sistema no chat do site indicando o bridge
    await saveMessage(
      tenantId,
      chatId,
      "system",
      `✅ Conversa transferida para WhatsApp: ${phone}`,
      { contentType: "bridge_card" }
    );

    console.log(`[LC Bridge] Bridge concluído: chatId=${chatId} → WA ${phone}`);
    return { success: true, waConversationId };

  } catch (err: any) {
    console.error("[LC Bridge] Erro geral:", err?.message);
    return { success: false, error: err?.message || "Erro desconhecido" };
  }
}