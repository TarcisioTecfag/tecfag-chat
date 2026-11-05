import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../../../../../db";
import { crmDeals } from "../../../../../db/schema";
import { requireCrmDealAccess } from "../../../../../lib/access-control/crm-record-access";
import { requireSession } from "../../../../../lib/auth-session";
import { crmService } from "../../../../../lib/crm/crm-service";
import {
  calculateFreightVolumesTotals,
  deleteDealFreightQuote,
  executeIntelipostQuote,
  getSavedDealFreightQuotes,
  readIntelipostConfig,
  saveDealFreightQuote,
  toPublicIntelipostConfig,
  type FreightCarrierOption,
  type FreightDestinationInput,
  type FreightQuoteVolumeInput,
  type IntelipostOriginAddress,
  type SavedDealFreightQuote,
} from "../../../../../lib/intelipost/intelipost-service";
import { requireCrmPermission } from "../../../../../lib/rbac";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/crm/deals/$dealId/freight-quotes")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const { dealId } = params as { dealId: string };

          const recordDenied = await requireCrmDealAccess(session, dealId);
          if (recordDenied) return recordDenied;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const [deal] = await db
            .select({ id: crmDeals.id })
            .from(crmDeals)
            .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
            .limit(1);

          if (!deal) {
            return jsonResponse(
              { error: "Negociação não encontrada para este tenant.", code: "NOT_FOUND" },
              404,
            );
          }

          const [quotes, storedConfig] = await Promise.all([
            getSavedDealFreightQuotes(tenantId, dealId),
            readIntelipostConfig(tenantId),
          ]);

          return jsonResponse({
            ok: true,
            quotes,
            intelipostConfig: toPublicIntelipostConfig(storedConfig),
          });
        } catch (err: any) {
          console.error("[CRM Deal Freight Quotes GET] Erro:", err);
          return jsonResponse(
            { error: err?.message || "Erro ao carregar cotações de frete da negociação." },
            500,
          );
        }
      },

      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const { dealId } = params as { dealId: string };

          const recordDenied = await requireCrmDealAccess(session, dealId);
          if (recordDenied) return recordDenied;

          const [deal] = await db
            .select({ id: crmDeals.id })
            .from(crmDeals)
            .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
            .limit(1);

          if (!deal) {
            return jsonResponse(
              { error: "Negociação não encontrada para este tenant.", code: "NOT_FOUND" },
              404,
            );
          }

          const body = (await request.json().catch(() => ({}))) as Record<string, any>;
          const action = String(body.action || "quote");

          if (action === "quote") {
            const permError = requireCrmPermission(session, "canViewCrm");
            if (permError) return permError;

            const destination = body.destination as FreightDestinationInput;
            const volumes = (Array.isArray(body.volumes) ? body.volumes : []) as FreightQuoteVolumeInput[];
            const originOverride = body.originOverride as Partial<IntelipostOriginAddress> | undefined;

            const result = await executeIntelipostQuote({
              tenantId,
              originOverride,
              destination,
              volumes,
              signal: request.signal,
            });

            return jsonResponse({
              ok: true,
              ...result,
            });
          }

          if (action === "save") {
            const permError = requireCrmPermission(session, "canEditDeals");
            if (permError) return permError;

            const selectedOption = body.selectedOption as FreightCarrierOption;
            const destination = body.destination as FreightDestinationInput;
            const volumes = (Array.isArray(body.volumes) ? body.volumes : []) as FreightQuoteVolumeInput[];
            const origin = body.origin as IntelipostOriginAddress;
            const totals = calculateFreightVolumesTotals(volumes);

            const savedQuote: SavedDealFreightQuote = {
              id: `fq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              dealId,
              quoteId: String(body.quoteId || selectedOption?.quoteId || `IP-${Date.now()}`),
              source: body.source === "intelipost_live" ? "intelipost_live" : "simulation",
              origin,
              destination,
              volumes,
              totals,
              selectedOption,
              allOptionsCount: Number(body.allOptionsCount || 1),
              notes: typeof body.notes === "string" ? body.notes.trim() : undefined,
              createdByOperatorId: session.operator.id,
              createdByOperatorName: session.operator.name || "Consultor",
              createdAt: new Date().toISOString(),
            };

            const quotes = await saveDealFreightQuote({
              tenantId,
              dealId,
              quote: savedQuote,
            });

            if (body.recordInTimeline !== false) {
              const itemsText = volumes
                .map(
                  (v) =>
                    `- **${v.name}** (${v.quantity}x) • ${v.weightKg} kg • ${v.heightCm}x${v.widthCm}x${v.lengthCm} cm • NF R$ ${Number(v.unitPrice).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
                )
                .join("\n");

              const formattedFreight = Number(selectedOption.finalShippingCost || 0).toLocaleString(
                "pt-BR",
                { style: "currency", currency: "BRL" },
              );

              const noteDescription = [
                `**Cotação de Frete Registrada (${selectedOption.carrierName} — ${selectedOption.serviceName})**`,
                `- **Valor do Frete:** ${formattedFreight} | **Prazo Estimado:** ${selectedOption.deliveryEstimateBusinessDays} dia(s) útil(eis)`,
                `- **Origem:** CEP ${origin.zipCode} (${origin.city}/${origin.state}) -> **Destino:** CEP ${destination.zipCode}${destination.city ? ` (${destination.city}/${destination.state || ""})` : ""}`,
                `- **Cubagem / Peso:** Peso Bruto ${totals.totalGrossWeightKg} kg | Peso Taxado ${totals.totalTaxedWeightKg} kg (${totals.totalCubicMeters} m³)`,
                itemsText,
                savedQuote.notes ? `- **Observações:** ${savedQuote.notes}` : null,
              ]
                .filter(Boolean)
                .join("\n");

              try {
                await crmService.createDealActivity(tenantId, dealId, session.operator.id, {
                  type: "note",
                  title: `Cotação de Frete: ${selectedOption.carrierName} (${formattedFreight})`,
                  description: noteDescription,
                  status: "completed",
                  completed: true,
                });
              } catch (noteErr) {
                console.warn("[CRM Deal Freight Quotes] Aviso ao gravar nota no histórico:", noteErr);
              }
            }

            return jsonResponse({
              ok: true,
              savedQuote,
              quotes,
            });
          }

          return jsonResponse({ error: "Ação inválida." }, 400);
        } catch (err: any) {
          console.error("[CRM Deal Freight Quotes POST] Erro:", err);
          return jsonResponse(
            { error: err?.message || "Erro ao processar cotação de frete." },
            500,
          );
        }
      },

      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const { dealId } = params as { dealId: string };

          const recordDenied = await requireCrmDealAccess(session, dealId);
          if (recordDenied) return recordDenied;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const url = new URL(request.url);
          const quoteId = url.searchParams.get("quoteId") || "";
          if (!quoteId) {
            return jsonResponse({ error: "Informe o ID da cotação para excluir." }, 400);
          }

          const quotes = await deleteDealFreightQuote({
            tenantId,
            dealId,
            quoteId,
          });

          return jsonResponse({
            ok: true,
            quotes,
          });
        } catch (err: any) {
          console.error("[CRM Deal Freight Quotes DELETE] Erro:", err);
          return jsonResponse(
            { error: err?.message || "Erro ao remover cotação de frete." },
            500,
          );
        }
      },
    },
  },
});
