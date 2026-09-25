import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../../db";
import { channelConfigs } from "../../../../db/schema";
import { eq } from "drizzle-orm";
import { requireSession, requirePermission } from "../../../../lib/auth-session";
import { metaAdapter } from "../../../../lib/whatsapp/adapters/meta";
import { baileysAdapter } from "../../../../lib/whatsapp/adapters/baileys";
import { SessionManager } from "../../../../lib/baileys/session-manager";

export const Route = createFileRoute("/api/settings/whatsapp/actions")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const permDenied = requirePermission(session, () => session.operator.role === "admin");
          if (permDenied) return permDenied;

          const body = await request.json();
          const { action, provider, customConfig } = body;

          let [config] = await db
            .select()
            .from(channelConfigs)
            .where(eq(channelConfigs.tenantId, session.tenantId));

          if (!config) {
            return new Response(JSON.stringify({ error: "Canal não configurado para este tenant" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }

          // ── AÇÃO 1: Troca de Provedor Ativo (Baileys <-> Meta) ────────────────
          if (action === "switch_provider") {
            const targetProvider = provider === "meta" ? "meta" : "baileys";
            const nextVersion = (config.connectionVersion || 1) + 1;

            // Se estava no Baileys e mudou para Meta, desconecta o socket do Baileys
            if (config.activeProvider === "baileys" && targetProvider === "meta") {
              try {
                await baileysAdapter.disconnect(session.tenantId);
              } catch (e) {
                console.warn("[Switch Provider] Erro ao desconectar Baileys:", e);
              }
            }

            await db
              .update(channelConfigs)
              .set({
                activeProvider: targetProvider,
                connectionVersion: nextVersion,
                connectionStatus: targetProvider === "meta" ? "connected" : "disconnected",
                updatedAt: new Date(),
              })
              .where(eq(channelConfigs.tenantId, session.tenantId));

            // Notifica operadores conectados via SSE
            SessionManager.getInstance().notifyPublic(session.tenantId, {
              type: "status",
              status: targetProvider === "meta" ? "connected" : "disconnected",
            });

            return new Response(
              JSON.stringify({
                success: true,
                message: `Provedor alterado com sucesso para '${targetProvider.toUpperCase()}' (Versão ${nextVersion})`,
                activeProvider: targetProvider,
                connectionVersion: nextVersion,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }

          // ── AÇÃO 2: Testar Credenciais Meta ──────────────────────────────────
          if (action === "test_credentials") {
            const result = await metaAdapter.testCredentials(session.tenantId, customConfig);
            return new Response(JSON.stringify(result), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          // ── AÇÃO 3: Desconectar ──────────────────────────────────────────────
          if (action === "disconnect") {
            if (config.activeProvider === "baileys") {
              await baileysAdapter.disconnect(session.tenantId);
              await db
                .update(channelConfigs)
                .set({ connectionStatus: "disconnected", updatedAt: new Date() })
                .where(eq(channelConfigs.tenantId, session.tenantId));
            }

            return new Response(JSON.stringify({ success: true, message: "Desconectado com sucesso" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ error: "Ação não reconhecida" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });

        } catch (err: any) {
          console.error("[WhatsApp Actions] Erro:", err);
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
