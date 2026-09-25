import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { channelConfigs } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { requireSession, requirePermission } from "../../../lib/auth-session";
import { baileysAdapter } from "../../../lib/whatsapp/adapters/baileys";
import { metaAdapter } from "../../../lib/whatsapp/adapters/meta";

export const Route = createFileRoute("/api/settings/whatsapp")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      // ── GET: Consulta configurações e status do canal do tenant ────────────
      GET: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          let [config] = await db
            .select()
            .from(channelConfigs)
            .where(eq(channelConfigs.tenantId, session.tenantId));

          if (!config) {
            // Cria configuração inicial padrão se não existir
            const [created] = await db
              .insert(channelConfigs)
              .values({
                id: `cfg-${session.tenantId}`,
                tenantId: session.tenantId,
                activeProvider: session.tenantId === "tecfag" ? "meta" : "baileys",
                connectionStatus: "disconnected",
                connectionVersion: 1,
              })
              .returning();
            config = created;
          }

          // Busca status em tempo real do provedor ativo
          let liveStatus = { status: config.connectionStatus || "disconnected", phone: "", details: null };
          try {
            if (config.activeProvider === "meta") {
              liveStatus = await metaAdapter.getStatus(session.tenantId) as any;
            } else {
              liveStatus = await baileysAdapter.getStatus(session.tenantId) as any;
            }
          } catch (statusErr) {
            console.warn(`[Settings WhatsApp] Falha ao consultar liveStatus (${config.activeProvider}):`, statusErr);
          }

          // Mascara chaves sensíveis
          const mask = (val?: string | null) => (val && val.length > 8 ? `${val.substring(0, 4)}...${val.substring(val.length - 4)}` : val ? "******" : null);

          return new Response(
            JSON.stringify({
              tenantId: session.tenantId,
              activeProvider: config.activeProvider || "baileys",
              connectionStatus: liveStatus.status || config.connectionStatus,
              connectionVersion: config.connectionVersion,
              livePhone: liveStatus.phone || config.baileysPairedPhone,
              baileysPairedPhone: config.baileysPairedPhone,
              metaPhoneNumberId: config.metaPhoneNumberId,
              metaBusinessAccountId: config.metaBusinessAccountId,
              metaVerifyToken: config.metaVerifyToken,
              metaAccessTokenMasked: mask(config.metaAccessToken),
              hasMetaAccessToken: !!config.metaAccessToken,
              hasMetaAppSecret: !!config.metaAppSecret,
              lastError: config.lastError,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },

      // ── POST: Atualiza credenciais e parâmetros do canal ───────────────────
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const permDenied = requirePermission(session, () => session.operator.role === "admin");
          if (permDenied) return permDenied;

          const body = await request.json();
          const {
            activeProvider,
            baileysPairedPhone,
            baileysPhoneNumber,
            metaPhoneNumberId,
            metaBusinessAccountId,
            metaAccessToken,
            metaVerifyToken,
            metaAppSecret,
          } = body;

          const updates: Record<string, any> = {
            updatedAt: new Date(),
          };

          if (activeProvider && (activeProvider === "baileys" || activeProvider === "meta")) {
            updates.activeProvider = activeProvider;
          }
          const targetPhone = baileysPairedPhone !== undefined ? baileysPairedPhone : baileysPhoneNumber;
          if (targetPhone !== undefined) updates.baileysPairedPhone = targetPhone;
          if (metaPhoneNumberId !== undefined) updates.metaPhoneNumberId = metaPhoneNumberId;
          if (metaBusinessAccountId !== undefined) updates.metaBusinessAccountId = metaBusinessAccountId;
          if (metaAccessToken) updates.metaAccessToken = metaAccessToken; // Só altera se fornecido novo
          if (metaVerifyToken !== undefined) updates.metaVerifyToken = metaVerifyToken;
          if (metaAppSecret) updates.metaAppSecret = metaAppSecret; // Só altera se fornecido novo

          let [existing] = await db
            .select()
            .from(channelConfigs)
            .where(eq(channelConfigs.tenantId, session.tenantId));

          if (existing) {
            updates.connectionVersion = (existing.connectionVersion || 1) + 1;
            await db
              .update(channelConfigs)
              .set(updates)
              .where(eq(channelConfigs.tenantId, session.tenantId));
          } else {
            await db.insert(channelConfigs).values({
              id: `cfg-${session.tenantId}`,
              tenantId: session.tenantId,
              activeProvider: activeProvider || "baileys",
              connectionStatus: "disconnected",
              connectionVersion: 1,
              ...updates,
            });
          }

          return new Response(JSON.stringify({ success: true, message: "Configurações atualizadas com sucesso" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
