import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { requireSession } from "../../../lib/auth-session";
import { runSdrSweep, type SdrSweepPeriod } from "../../../lib/triage/sdr-sweep";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

export const Route = createFileRoute("/api/valentina/sdr-sweep")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const canAccessSdr =
          session.operator.role === "admin" ||
          session.permissions?.valentina?.canAccessSdr === true;

        if (!canAccessSdr) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para executar varredura do SDR.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers },
          );
        }

        try {
          const url = new URL(request.url);
          const rawPeriod = (url.searchParams.get("period") || "today").toLowerCase();
          const period: SdrSweepPeriod =
            rawPeriod === "today" || rawPeriod === "range" || rawPeriod === "all"
              ? rawPeriod
              : "today";
          const startDate = url.searchParams.get("startDate");
          const endDate = url.searchParams.get("endDate");

          const result = await runSdrSweep(db, tenantId, {
            period,
            startDate,
            endDate,
          });

          return new Response(JSON.stringify(result), { status: 200, headers });
        } catch (err: any) {
          console.error("[api/valentina/sdr-sweep] Erro ao executar varredura:", err);
          return new Response(
            JSON.stringify({
              error: "Não foi possível executar a varredura de triagens agora.",
            }),
            { status: 500, headers },
          );
        }
      },
    },
  },
});
