import { createFileRoute } from "@tanstack/react-router";
import { SessionManager, resolveRealJid } from "../../../lib/baileys/session-manager";
import { db } from "../../../db";
import { contacts } from "../../../db/schema";
import { eq, isNull, and } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * POST /api/baileys/sync-avatars
 * Varre todos os contatos do tenant que não têm foto salva
 * e tenta buscar via profilePictureUrl no Baileys.
 * Útil para re-sincronizar fotos de contatos antigos.
 */
export const Route = createFileRoute("/api/baileys/sync-avatars")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const tenantId = body.tenantId || "valem";

          const sessionManager = SessionManager.getInstance();
          const sock = sessionManager.getSession(tenantId);

          if (!sock || sessionManager.getStatus(tenantId) !== "connected") {
            return new Response(
              JSON.stringify({ error: "WhatsApp não conectado" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Busca todos os contatos do tenant sem foto e com JID salvo
          const contactsWithoutAvatar = await db
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                isNull(contacts.avatar)
              )
            );

          let updated = 0;
          let failed = 0;

          for (const contact of contactsWithoutAvatar) {
            try {
              const jid = contact.whatsappJid;
              if (!jid && !contact.phone) { failed++; continue; }

              // Resolve o JID real usando onWhatsApp se não tivermos um JID confiável salvo
              let resolvedJid = jid;
              if (!resolvedJid && contact.phone) {
                resolvedJid = await resolveRealJid(sock, contact.phone);
                // Se conseguimos resolver o JID, vamos salvar no contato
                if (resolvedJid) {
                  await db
                    .update(contacts)
                    .set({ whatsappJid: resolvedJid })
                    .where(eq(contacts.id, contact.id));
                }
              }

              if (!resolvedJid) { failed++; continue; }

              // Montamos a lista de JIDs a tentar
              const cleanPhone = (contact.phone || "").replace(/\D/g, "");
              const jidsToTry: string[] = [resolvedJid];
              if (cleanPhone.startsWith("55")) {
                const ddd = cleanPhone.slice(2, 4);
                const rest = cleanPhone.slice(4);
                if (rest.length === 9 && rest.startsWith("9")) {
                  jidsToTry.push(`55${ddd}${rest.slice(1)}@s.whatsapp.net`);
                } else if (rest.length === 8) {
                  jidsToTry.push(`55${ddd}9${rest}@s.whatsapp.net`);
                }
              }

              let picUrl: string | undefined;
              for (const tryJid of jidsToTry) {
                try {
                  picUrl = await sock.profilePictureUrl(tryJid, "preview")
                    .catch(() => sock.profilePictureUrl(tryJid, "image"));
                  if (picUrl) {
                    console.log(`[sync-avatars] Foto obtida para ${contact.phone} via ${tryJid}`);
                    break;
                  }
                } catch { /* próximo */ }
              }

              if (picUrl) {
                await db
                  .update(contacts)
                  .set({ avatar: picUrl })
                  .where(eq(contacts.id, contact.id));

                // Notifica o front via SSE
                sessionManager.notifyPublic(tenantId, {
                  type: "contact_avatar",
                  contactId: contact.id,
                  phone: contact.phone ?? "",
                  avatar: picUrl,
                });

                updated++;
              } else {
                failed++;
              }

              // Pequena pausa entre requisições para não disparar rate-limit do WhatsApp
              await new Promise((r) => setTimeout(r, 200));
            } catch (err: any) {
              console.log(`[sync-avatars] Falha ao processar contato ${contact.phone || contact.id}:`, err.message);
              failed++;
            }
          }

          return new Response(
            JSON.stringify({
              success: true,
              total: contactsWithoutAvatar.length,
              updated,
              failed,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[sync-avatars] Erro:", e);
          return new Response(
            JSON.stringify({ error: e.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
