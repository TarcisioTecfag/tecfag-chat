import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { channelConfigs, conversations } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { metaAdapter } from "../../../lib/whatsapp/adapters/meta";
import { getMetaServiceWindow } from "../../../lib/whatsapp/meta-policy";

export const Route = createFileRoute("/api/whatsapp/meta-state")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const tenantId = auth.session.tenantId;
        const url = new URL(request.url);
        const conversationId = url.searchParams.get("conversationId");
        if (!conversationId) return Response.json({ error: "conversationId é obrigatório" }, { status: 400 });

        const [conversation] = await db.select({ id: conversations.id, operatorId: conversations.operatorId }).from(conversations).where(and(
          eq(conversations.id, conversationId),
          eq(conversations.tenantId, tenantId)
        ));
        if (!conversation) return Response.json({ error: "Conversa não encontrada" }, { status: 404 });
        const operator = auth.session.operator;
        if (!["admin", "supervisor"].includes(operator.role) && conversation.operatorId !== operator.id) {
          return Response.json({ error: "Sem permissão para responder nesta conversa." }, { status: 403 });
        }

        const [config] = await db.select({ activeProvider: channelConfigs.activeProvider }).from(channelConfigs)
          .where(eq(channelConfigs.tenantId, tenantId));
        if (config?.activeProvider !== "meta") {
          return Response.json({ activeProvider: config?.activeProvider || "baileys" });
        }

        const window = await getMetaServiceWindow(tenantId, conversationId);
        if (url.searchParams.get("templates") !== "1") {
          return Response.json({ activeProvider: "meta", window });
        }
        try {
          const templates = await metaAdapter.listApprovedTemplates(tenantId);
          return Response.json({ activeProvider: "meta", window, templates });
        } catch (error: any) {
          return Response.json({ error: error.message || "Falha ao consultar templates da Meta" }, { status: 502 });
        }
      },
    },
  },
});
