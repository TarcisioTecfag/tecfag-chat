import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { aiReports } from "../../../db/schema";
import { eq, desc, and } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/reports")({
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
          const reports = await db
            .select()
            .from(aiReports)
            .where(eq(aiReports.tenantId, tenantId))
            .orderBy(desc(aiReports.generatedAt))
            .limit(30);

          return new Response(JSON.stringify(reports), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[gestao/reports] Erro GET:", e);
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
