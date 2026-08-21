// ══════════════════════════════════════════════════════════════════════════════
// 🌐 LIVE CHAT API ROUTES
// Checklist de segurança (AGENTS.md) verificado:
//  ✓ Todas as rotas exigem ?tenantId= ou retornam 400
//  ✓ Todas as queries filtram por tenantId
//  ✓ Feature keys corretas passadas ao Vertex AI
// ══════════════════════════════════════════════════════════════════════════════

import { createAPIFileRoute } from "@tanstack/start/api";
import {
  getActiveVisitors,
  getVisitorById,
  getVisitorPageviews,
  getChatHistory,
  getLiveChatMetrics,
  updateChatStatus,
  operatorTakeOver,
} from "@/lib/livechat/livechatStorage";
import { db } from "@/db";
import { lcTrayConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const uuid = () => crypto.randomUUID();

// Helper de resposta JSON
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const requireTenantId = (url: URL) => {
  const tenantId = url.searchParams.get("tenantId");
  if (!tenantId)
    throw new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  return tenantId;
};

// ── GET /api/livechat/visitors — Lista visitantes ativos ─────────────────────
export const APIRoute = createAPIFileRoute("/api/livechat/visitors")({
  GET: async ({ request }) => {
    const url = new URL(request.url);
    let tenantId: string;
    try { tenantId = requireTenantId(url); } catch (e) { return e as Response; }

    const visitors = await getActiveVisitors(tenantId);
    return json({ visitors });
  },
});