import { createAPIFileRoute } from "@tanstack/start/api";
import { db } from "@/db";
import { lcTrayConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const uuid = () => crypto.randomUUID();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const APIRoute = createAPIFileRoute("/api/livechat/tray-config")({
  GET: async ({ request }) => {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get("tenantId");
    if (!tenantId) return json({ error: "tenantId é obrigatório" }, 400);
    const [config] = await db.select().from(lcTrayConfig).where(eq(lcTrayConfig.tenantId, tenantId)).limit(1);
    if (!config) return json({ configured: false });
    // Não expor consumer_secret ao frontend
    const { consumerSecret: _, accessToken: __, refreshToken: ___, ...safeConfig } = config;
    return json({ configured: !!config.accessToken, config: safeConfig });
  },

  POST: async ({ request }) => {
    const body = await request.json() as any;
    const { tenantId, apiAddress, consumerKey, consumerSecret, proactiveMessage, proactiveDelaySec, sessionTtlHours, attackQualifyScore } = body;
    if (!tenantId) return json({ error: "tenantId é obrigatório" }, 400);
    if (!apiAddress) return json({ error: "apiAddress é obrigatório" }, 400);

    const existing = await db.select().from(lcTrayConfig).where(eq(lcTrayConfig.tenantId, tenantId)).limit(1);
    if (existing[0]) {
      await db.update(lcTrayConfig).set({
        apiAddress, consumerKey, consumerSecret,
        proactiveMessage, proactiveDelaySec, sessionTtlHours, attackQualifyScore,
        updatedAt: new Date(),
      }).where(eq(lcTrayConfig.tenantId, tenantId));
    } else {
      await db.insert(lcTrayConfig).values({
        id: uuid(), tenantId, apiAddress, consumerKey, consumerSecret,
        proactiveMessage, proactiveDelaySec, sessionTtlHours, attackQualifyScore,
      });
    }
    return json({ success: true });
  },
});