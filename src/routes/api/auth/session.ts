import { createFileRoute } from "@tanstack/react-router";
import { getAuthSession } from "../../../lib/auth-session.js";
import { db } from "../../../db/index.js";
import { channelConfigs, commercialConsultantProfiles } from "../../../db/schema.js";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { canManagePlatformAccess } from "../../../lib/platform-access.js";

export const Route = createFileRoute("/api/auth/session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await getAuthSession(request);
          if (!session) {
            return new Response(
              JSON.stringify({
                success: false,
                error: "Sessão inválida ou expirada. Efetue login.",
                code: "UNAUTHORIZED",
              }),
              { status: 401, headers: { "Content-Type": "application/json" } }
            );
          }

          // Buscar configuração pública do canal para o tenant da sessão (sem segredos!)
          const channel = await db.query.channelConfigs.findFirst({
            where: eq(channelConfigs.tenantId, session.tenantId),
          });

          const publicChannel = channel
            ? {
                activeProvider: channel.activeProvider,
                connectionStatus: channel.connectionStatus,
                baileysSessionStatus: channel.baileysSessionStatus,
                baileysPairedPhone: channel.baileysPairedPhone,
                metaPhoneNumberId: channel.metaPhoneNumberId,
                lastError: channel.lastError,
              }
            : null;

          // Verificar se o operador é consultor cadastrado no Gestão Comercial
          const [consultantProfile] = await db
            .select({
              division: commercialConsultantProfiles.division,
            })
            .from(commercialConsultantProfiles)
            .where(
              and(
                eq(commercialConsultantProfiles.tenantId, session.tenantId),
                eq(commercialConsultantProfiles.operatorId, session.operator.id),
                isNotNull(commercialConsultantProfiles.division),
                ne(commercialConsultantProfiles.division, ""),
              ),
            )
            .limit(1);

          const isCommercialConsultant = Boolean(consultantProfile?.division);
          const commercialDivision = consultantProfile?.division ?? null;

          return new Response(
            JSON.stringify({
              success: true,
              tenantId: session.tenantId,
              availableTenants: session.availableTenants,
              canManagePlatformAccess: await canManagePlatformAccess(session.operator).catch(() => false),
              operator: session.operator,
              isCommercialConsultant,
              commercialDivision,
              permissions: session.permissions,
              accessGroup: {
                id: session.accessGroup.id,
                name: session.accessGroup.name,
              },
              channelConfig: publicChannel,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[Session API] Erro ao consultar sessão:", e);
          return new Response(
            JSON.stringify({ success: false, error: "Erro interno no servidor ao consultar sessão." }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
