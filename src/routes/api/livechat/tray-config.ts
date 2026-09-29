import { createFileRoute } from "@tanstack/react-router";
import { db } from "@/db";
import { lcTrayConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { requireSession } from "@/lib/auth-session";

const uuid = () => crypto.randomUUID();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/livechat/tray-config")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      GET: async ({ request }: { request: Request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        try {
          const [config] = await db.select().from(lcTrayConfig).where(eq(lcTrayConfig.tenantId, tenantId)).limit(1);
          if (!config) {
            return new Response(JSON.stringify({ configured: false }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          const { consumerSecret: _, accessToken: __, refreshToken: ___, ...safeConfig } = config;
          return new Response(JSON.stringify({ configured: !!config.accessToken, config: safeConfig }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e?.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      POST: async ({ request }: { request: Request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;

        if (session.operator.role !== "admin") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores podem configurar a integração Tray.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const tenantId = session.tenantId;

        try {
          const body = (await request.json()) as any;
          const {
            apiAddress,
            consumerKey,
            consumerSecret,
            proactiveMessage,
            proactiveDelaySec,
            sessionTtlHours,
            attackQualifyScore,
          } = body;

          if (!apiAddress) {
            return new Response(JSON.stringify({ error: "apiAddress é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const existing = await db.select().from(lcTrayConfig).where(eq(lcTrayConfig.tenantId, tenantId)).limit(1);
          if (existing[0]) {
            await db
              .update(lcTrayConfig)
              .set({
                apiAddress,
                consumerKey,
                consumerSecret: consumerSecret || existing[0].consumerSecret,
                proactiveMessage,
                proactiveDelaySec,
                sessionTtlHours,
                attackQualifyScore,
                updatedAt: new Date(),
              })
              .where(eq(lcTrayConfig.tenantId, tenantId));
          } else {
            await db.insert(lcTrayConfig).values({
              id: uuid(),
              tenantId,
              apiAddress,
              consumerKey,
              consumerSecret,
              proactiveMessage,
              proactiveDelaySec,
              sessionTtlHours,
              attackQualifyScore,
            });
          }
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e?.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});