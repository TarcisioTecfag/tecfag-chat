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
              status: operators.status,
              role: operators.role,
              isOnline: operators.isOnline,
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
          if (!operatorId) {
            return json({ error: "Consultor (operatorId) é obrigatório." }, 400);
          }

          const [operator] = await db
            .select({ id: operators.id })
            .from(operators)
            .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId)))
            .limit(1);
          if (!operator) return json({ error: "Operador não encontrado neste tenant." }, 404);

          // Buscar perfil atual se existir
          const [existingProfile] = await db
            .select({
              id: commercialConsultantProfiles.id,
              division: commercialConsultantProfiles.division,
              activeOnTv: commercialConsultantProfiles.activeOnTv,
            })
            .from(commercialConsultantProfiles)
            .where(
              and(
                eq(commercialConsultantProfiles.tenantId, tenantId),
                eq(commercialConsultantProfiles.operatorId, operatorId),
              ),
            )
            .limit(1);

          let division = existingProfile?.division ?? null;
          if (body.division !== undefined) {
            if (body.division === null || body.division === "") {
              division = null;
            } else if (["personnalite", "maquinas"].includes(body.division)) {
              division = body.division;
            } else {
              return json(
                { error: "Divisão inválida. Escolha 'personnalite' ou 'maquinas'." },
                400,
              );
            }
          }

          let activeOnTv = existingProfile?.activeOnTv ?? true;
          if (typeof body.activeOnTv === "boolean") {
            activeOnTv = body.activeOnTv;
          }

          const [profile] = await db
            .insert(commercialConsultantProfiles)
            .values({
              id: crypto.randomUUID(),
              tenantId,
              operatorId,
              division,
              activeOnTv,
            })
            .onConflictDoUpdate({
              target: [
                commercialConsultantProfiles.tenantId,
                commercialConsultantProfiles.operatorId,
              ],
              set: {
                division,
                activeOnTv,
                updatedAt: new Date(),
              },
            })
            .returning();
          return json({ profile });
        } catch (error) {
          console.error("[commercial/consultants] POST:", error);
          return json({ error: "Falha ao salvar consultor." }, 500);
        }
      },
      DELETE: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin")
          return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        try {
          const url = new URL(request.url);
          const operatorId = url.searchParams.get("operatorId");
          if (!operatorId) return json({ error: "operatorId é obrigatório." }, 400);

          await db
            .delete(commercialConsultantProfiles)
            .where(
              and(
                eq(commercialConsultantProfiles.tenantId, tenantId),
                eq(commercialConsultantProfiles.operatorId, operatorId),
              ),
            );
          return json({ success: true });
        } catch (error) {
          console.error("[commercial/consultants] DELETE:", error);
          return json({ error: "Falha ao desvincular consultor da equipe." }, 500);
        }
      },
    },
  },
});
