import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "../../../db";
import { commercialConsultantProfiles } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";
import { getCommercialHome } from "../../../lib/commercial/home-service";

export const Route = createFileRoute("/api/commercial/home")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const permError = requireCrmPermission(session, "canViewCrm");
        if (permError) return permError;

        const url = new URL(request.url);
        const queryOperatorId = url.searchParams.get("operatorId")?.trim();

        let targetOperatorId = session.operator.id;

        // Se solicitou operatorId diferente da sessão, exige privilégio de admin
        if (queryOperatorId && queryOperatorId !== session.operator.id) {
          if (session.operator.role !== "admin") {
            return new Response(
              JSON.stringify({
                error: "Permissão insuficiente para visualizar o perfil de outro consultor.",
                code: "FORBIDDEN",
              }),
              { status: 403, headers: { "Content-Type": "application/json" } },
            );
          }
          targetOperatorId = queryOperatorId;
        }

        // Validação estrita: apenas consultores cadastrados no Gestão Comercial possuem tela de Início válida
        const [consultantProfile] = await db
          .select({
            division: commercialConsultantProfiles.division,
          })
          .from(commercialConsultantProfiles)
          .where(
            and(
              eq(commercialConsultantProfiles.tenantId, tenantId),
              eq(commercialConsultantProfiles.operatorId, targetOperatorId),
              isNotNull(commercialConsultantProfiles.division),
              ne(commercialConsultantProfiles.division, ""),
            ),
          )
          .limit(1);

        if (!consultantProfile || !consultantProfile.division) {
          return new Response(
            JSON.stringify({
              error: "A tela de Início é exclusiva para consultores comerciais cadastrados no Gestão Comercial.",
              code: "NOT_A_CONSULTANT",
              isConsultant: false,
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        try {
          const home = await getCommercialHome(tenantId, targetOperatorId);
          return new Response(JSON.stringify(home), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (error) {
          console.error("[commercial/home] Falha ao carregar dados:", error);
          return new Response(
            JSON.stringify({ error: "Não foi possível carregar o início comercial." }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      },
    },
  },
});

