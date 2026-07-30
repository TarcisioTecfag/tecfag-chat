import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  conversations,
  responseTimeLogs,
  sectors,
  contacts
} from "../../../db/schema";
import { eq, and, gte, lte, isNotNull, count, avg } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/performance")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          const now = new Date();
          const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

          // ── 1. Volumetria Semanal (últimos 7 dias) ──────────────────────────
          const last7Days: { dateStr: string; name: string; start: Date; end: Date }[] = [];
          for (let i = 6; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split("T")[0];
            const start = new Date(dateStr + "T00:00:00.000Z");
            const end = new Date(dateStr + "T23:59:59.999Z");
            last7Days.push({
              dateStr,
              name: dayNames[d.getDay()],
              start,
              end,
            });
          }

          const volumes = await Promise.all(
            last7Days.map(async (day) => {
              const [createdRes, closedRes, slaLogs] = await Promise.all([
                db
                  .select({ count: count() })
                  .from(conversations)
                  .where(
                    and(
                      eq(conversations.tenantId, tenantId),
                      gte(conversations.createdAt, day.start),
                      lte(conversations.createdAt, day.end)
                    )
                  ),
                db
                  .select({ count: count() })
                  .from(conversations)
                  .where(
                    and(
                      eq(conversations.tenantId, tenantId),
                      eq(conversations.queueState, "finalizados"),
                      gte(conversations.lastMessageTime, day.start),
                      lte(conversations.lastMessageTime, day.end)
                    )
                  ),
                db
                  .select({ isOverdue: responseTimeLogs.isOverdue })
                  .from(responseTimeLogs)
                  .where(
                    and(
                      eq(responseTimeLogs.tenantId, tenantId),
                      gte(responseTimeLogs.createdAt, day.start),
                      lte(responseTimeLogs.createdAt, day.end)
                    )
                  ),
              ]);

              const chats = Number(createdRes[0]?.count ?? 0);
              const atendidos = Number(closedRes[0]?.count ?? 0);

              const totalSla = slaLogs.length;
              const overdueSla = slaLogs.filter((l) => l.isOverdue).length;
              const sla = totalSla > 0 ? Math.round(((totalSla - overdueSla) / totalSla) * 100) : 100;

              return {
                name: day.name,
                chats,
                atendidos,
                sla,
              };
            })
          );

          // ── 2. Distribuição por Canal (WhatsApp, Instagram, Messenger) ─────
          const allContacts = await db
            .select({ mainChannel: contacts.mainChannel })
            .from(contacts)
            .where(eq(contacts.tenantId, tenantId));

          const channelCounts: Record<string, number> = {
            WhatsApp: 0,
            Instagram: 0,
            Messenger: 0,
          };

          allContacts.forEach((c) => {
            const ch = (c.mainChannel || "whatsapp").toLowerCase();
            if (ch.includes("whatsapp")) channelCounts.WhatsApp += 1;
            else if (ch.includes("instagram")) channelCounts.Instagram += 1;
            else if (ch.includes("messenger")) channelCounts.Messenger += 1;
            else channelCounts.WhatsApp += 1;
          });

          const channels = [
            { name: "WhatsApp", value: channelCounts.WhatsApp, color: "#10b981" },
            { name: "Instagram", value: channelCounts.Instagram, color: "#a855f7" },
            { name: "Messenger", value: channelCounts.Messenger, color: "#3b82f6" },
          ];

          // ── 3. Desempenho por Setor/Departamento ───────────────────────────
          const allSectors = await db
            .select()
            .from(sectors)
            .where(eq(sectors.tenantId, tenantId));

          const sectorMetrics = await Promise.all(
            allSectors.map(async (sec) => {
              const [closedRes, slaLogs] = await Promise.all([
                db
                  .select({ count: count() })
                  .from(conversations)
                  .where(
                    and(
                      eq(conversations.tenantId, tenantId),
                      eq(conversations.sectorId, sec.id),
                      eq(conversations.queueState, "finalizados")
                    )
                  ),
                db
                  .select({
                    avgSeconds: avg(responseTimeLogs.responseTimeSeconds),
                    isOverdue: responseTimeLogs.isOverdue,
                  })
                  .from(responseTimeLogs)
                  .innerJoin(conversations, eq(responseTimeLogs.conversationId, conversations.id))
                  .where(
                    and(
                      eq(responseTimeLogs.tenantId, tenantId),
                      eq(conversations.sectorId, sec.id),
                      isNotNull(responseTimeLogs.responseTimeSeconds)
                    )
                  ),
              ]);

              const completed = Number(closedRes[0]?.count ?? 0);
              const validLogs = slaLogs.filter((l) => l.avgSeconds !== null);
              const avgResponse = validLogs.length > 0
                ? Math.round(validLogs.reduce((acc, curr) => acc + Number(curr.avgSeconds || 0), 0) / validLogs.length)
                : 0;

              const totalSla = slaLogs.length;
              const overdueSla = slaLogs.filter((l) => l.isOverdue).length;
              const slaPct = totalSla > 0 ? Math.round(((totalSla - overdueSla) / totalSla) * 100) : 100;

              return {
                name: sec.name,
                completed,
                avgResponse,
                slaPct,
              };
            })
          );

          return new Response(
            JSON.stringify({
              volumes,
              channels,
              sectors: sectorMetrics,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          console.error("[gestao/performance] Erro GET:", e);
          return new Response(
            JSON.stringify({
              volumes: [],
              channels: [],
              sectors: [],
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});
