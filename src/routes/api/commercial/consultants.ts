import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { commercialConsultantProfiles, operators } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/commercial/consultants")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin")
          return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        try {
          const consultants = await db
            .select({
              operatorId: operators.id,
              name: operators.name,
              email: operators.email,
              avatar: operators.avatar,
              division: commercialConsultantProfiles.division,
              activeOnTv: commercialConsultantProfiles.activeOnTv,
            })
            .from(operators)
            .leftJoin(
              commercialConsultantProfiles,
              and(
                eq(commercialConsultantProfiles.operatorId, operators.id),
                eq(commercialConsultantProfiles.tenantId, tenantId),
              ),
            )
            .where(eq(operators.tenantId, tenantId))
            .orderBy(operators.name);
          return json({ consultants });
        } catch (error) {
          console.error("[commercial/consultants] GET:", error);
          return json({ error: "Falha ao listar consultores." }, 500);
        }
      },
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin")
          return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        try {
          const body = await request.json();
          const operatorId = typeof body.operatorId === "string" ? body.operatorId.trim() : "";
          const division = body.division;
          if (
            !operatorId ||
            !["personnalite", "maquinas"].includes(division) ||
            typeof body.activeOnTv !== "boolean"
          ) {
            return json(
              { error: "Consultor, divisão e visibilidade na TV são obrigatórios." },
              400,
            );
          }
          const [operator] = await db
            .select({ id: operators.id })
            .from(operators)
            .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId)))
            .limit(1);
          if (!operator) return json({ error: "Operador não encontrado neste tenant." }, 404);
          const [profile] = await db
            .insert(commercialConsultantProfiles)
            .values({
              id: crypto.randomUUID(),
              tenantId,
              operatorId,
              division,
              activeOnTv: body.activeOnTv,
            })
            .onConflictDoUpdate({
              target: [
                commercialConsultantProfiles.tenantId,
                commercialConsultantProfiles.operatorId,
              ],
              set: { division, activeOnTv: body.activeOnTv, updatedAt: new Date() },
            })
            .returning();
          return json({ profile });
        } catch (error) {
          console.error("[commercial/consultants] POST:", error);
          return json({ error: "Falha ao salvar consultor." }, 500);
        }
      },
    },
  },
});
