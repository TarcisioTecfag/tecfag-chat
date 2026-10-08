import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { commercialSettings, crmPipelines } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import type { PipelineByDivision, PipelineDivision } from "../../../lib/commercial/pipeline-scope";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export const Route = createFileRoute("/api/commercial/pipeline-mapping")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin") {
          return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "JSON inválido." }, 400);
        }
        if (!body || typeof body !== "object") return json({ error: "Dados inválidos." }, 400);
        const input = body as Record<string, unknown>;
        if (input.division !== "personnalite" && input.division !== "maquinas") {
          return json({ error: "Equipe inválida." }, 400);
        }
        const division = input.division as PipelineDivision;
        const pipelineId = input.pipelineId;
        if (pipelineId !== null && (typeof pipelineId !== "string" || !pipelineId.trim())) {
          return json({ error: "Funil inválido." }, 400);
        }

        try {
          if (pipelineId) {
            const [pipeline] = await db
              .select({ id: crmPipelines.id })
              .from(crmPipelines)
              .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, pipelineId)))
              .limit(1);
            if (!pipeline) return json({ error: "Funil não encontrado neste tenant." }, 404);
          }

          const result = await db.transaction(async (tx) => {
            await tx.insert(commercialSettings).values({ tenantId }).onConflictDoNothing();
            const [current] = await tx
              .select({ pipelineByDivision: commercialSettings.pipelineByDivision })
              .from(commercialSettings)
              .where(eq(commercialSettings.tenantId, tenantId))
              .for("update")
              .limit(1);
            const mapping: PipelineByDivision = { ...(current?.pipelineByDivision || {}) };
            if (pipelineId) mapping[division] = pipelineId;
            else delete mapping[division];
            if (mapping.personnalite && mapping.personnalite === mapping.maquinas) {
              return { error: "Selecione funis diferentes para as duas equipes." };
            }
            await tx
              .update(commercialSettings)
              .set({
                pipelineByDivision: mapping,
                updatedByOperatorId: session.operator.id,
                updatedAt: new Date(),
              })
              .where(eq(commercialSettings.tenantId, tenantId));
            return { pipelineByDivision: mapping };
          });
          return "error" in result ? json(result, 409) : json(result);
        } catch (error) {
          console.error("[commercial/pipeline-mapping] POST:", error);
          return json({ error: "Falha ao configurar funil comercial." }, 500);
        }
      },
    },
  },
});
