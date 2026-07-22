import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../../db";
import { contacts } from "../../../../db/schema";
import { eq } from "drizzle-orm";
import { rdRequest } from "../../../../lib/rdCrmService";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ============================================================================
// CONFIGURAÇÃO DOS IDS REAIS DO SEU RD CRM (VALEM)
// Acesse a URL: /api/settings/rd-crm/fields?tenantId=valem no seu navegador
// Cole os IDs corretos obtidos para os respectivos campos nas constantes abaixo:
// ============================================================================
const VALEM_FIELD_IDS = {
  qualificadoSdr: "696ba913a1aef400136910f7", // ID real de "QUALIFICADO POR SDR (VALEM)"
  projetosDesenvolvimento: "696bb0eb4d002d0014b3cd3e", // ID real de "PROJETOS / DESENVOLVIMENTO"
  tipoProduto: "696ba80ed2dcbf001474aaf9", // ID real de "QUAL O TIPO DE PRODUTO (VALEM)"
  infoComplementar: "696bd749b44b6d00179417a0", // ID real de "INFORMAÇÕES COMPLEMENTARES"
  feitoPor: "69b1638eb0e1180014224ca3", // ID real de "FEITO POR"
};

export const Route = createFileRoute("/api/contacts/$contactId/rd-deal")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // GET — Recupera informações do deal do contato atual
      GET: async ({ params }) => {
        try {
          const { contactId } = params as { contactId: string };
          const [contact] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, contactId));

          if (!contact) {
            return new Response(JSON.stringify({ error: "Contato não encontrado" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (!contact.rdCrmDealId) {
            return new Response(JSON.stringify({ linked: false }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const tenantId = contact.tenantId;

          // Busca os campos customizados configurados oficialmente no RD CRM via API
          const rawFieldsRes = await rdRequest<any>(tenantId, "GET", "/custom_fields?limit=100").catch((err) => {
            console.error("[RD Deal API] Erro ao buscar custom_fields:", err.message);
            return [];
          });

          const allCrmFields: any[] = Array.isArray(rawFieldsRes)
            ? rawFieldsRes
            : (rawFieldsRes && Array.isArray(rawFieldsRes.custom_fields)
                ? rawFieldsRes.custom_fields
                : (rawFieldsRes && Array.isArray(rawFieldsRes.data) ? rawFieldsRes.data : []));

          console.log("[RD Deal API] Quantidade de campos recuperados da API do CRM:", allCrmFields.length);

          // Busca o negócio na API do RD CRM
          try {
            const deal = await rdRequest(tenantId, "GET", `/deals/${contact.rdCrmDealId}`);
            
            // Normaliza o valor retornado
            if (deal) {
              deal.value = deal.value !== undefined ? deal.value : 
                           (deal.total_price !== undefined ? deal.total_price : 
                           (deal.price !== undefined ? deal.price : 
                           (deal.amount_total !== undefined ? deal.amount_total : 0)));
              deal.deal_custom_fields = deal.deal_custom_fields || deal.custom_fields || [];

              // Se a organizacao for uma string (ID) ou tiver organization_id mas nao tiver .name, busca na API de organizacao
              const orgId = deal.organization_id || (typeof deal.organization === "string" ? deal.organization : deal.organization?.id);
              if (orgId && !deal.organization?.name) {
                try {
                  const orgData = await rdRequest<any>(tenantId, "GET", `/organizations/${orgId}`);
                  if (orgData && orgData.name) {
                    deal.organization = { id: orgId, name: orgData.name };
                  }
                } catch (e: any) {
                  console.warn("[RD Deal API] Aviso ao buscar organização:", e?.message);
                }
              }
            }

            // Normalização flexível apenas para ligar o nome do campo ao objeto exato retornado da API
            const normalizeStr = (str: string) => {
              return str
                ? str
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "") // remove acentos
                    .replace(/[^a-z0-9]/g, "") // remove pontuações e espaços
                : "";
            };

            const findField = (configuredId: string, labelPattern: string) => {
              // 1. Tenta buscar pelo ID configurado
              const foundById = allCrmFields.find((f) => f.id === configuredId || f._id === configuredId);
              if (foundById) return foundById;

              // 2. Busca pelo nome exato do campo vindo da API do RD CRM
              const target = normalizeStr(labelPattern);
              return allCrmFields.find((f) => {
                const normLabel = normalizeStr(f.label || f.name || f.api_identifier || f.slug || "");
                return normLabel === target || normLabel.includes(target) || target.includes(normLabel);
              });
            };

            // Slugs de fallback padrão do Valem
            const VALEM_FIELD_SLUGS = {
              qualificadoSdr: "qualificado-por-sdr-valem",
              projetosDesenvolvimento: "projetos-desenvolvimento",
              tipoProduto: "qual-o-tipo-de-produto-valem",
              infoComplementar: "estudo-de-caso-escopo-do-projeto",
              feitoPor: "feito-por",
            };

            // Associa cada campo ao objeto exato retornado pelo endpoint oficial
            const getFieldWithFallback = (key: keyof typeof VALEM_FIELD_IDS, label: string) => {
              const id = VALEM_FIELD_IDS[key];
              const found = findField(id, label);
              const slug = VALEM_FIELD_SLUGS[key];
              return found 
                ? { 
                    id: found.id || found._id || id,
                    label: found.label || found.name || label,
                    slug: found.slug || found.api_identifier || slug,
                    type: found.type || (key === "infoComplementar" ? "text" : "multiple_choice"),
                    options: found.options || found.custom_field_options || []
                  }
                : { id, label, slug, type: key === "infoComplementar" ? "text" : "multiple_choice", options: [] };
            };

            const fieldsSchema = {
              qualificadoSdr: getFieldWithFallback("qualificadoSdr", "QUALIFICADO POR SDR (VALEM)"),
              projetosDesenvolvimento: getFieldWithFallback("projetosDesenvolvimento", "PROJETOS / DESENVOLVIMENTO"),
              tipoProduto: getFieldWithFallback("tipoProduto", "QUAL O TIPO DE PRODUTO (VALEM)"),
              infoComplementar: getFieldWithFallback("infoComplementar", "INFORMAÇÕES COMPLEMENTARES"),
              feitoPor: getFieldWithFallback("feitoPor", "FEITO POR"),
            };

            console.log("[RD Deal API] Fields Schema resolvido:", Object.keys(fieldsSchema).reduce((acc, key) => ({
              ...acc,
              [key]: (fieldsSchema as any)[key] ? { id: (fieldsSchema as any)[key].id, label: (fieldsSchema as any)[key].label } : "NÃO ENCONTRADO"
            }), {}));

            return new Response(
              JSON.stringify({
                linked: true,
                dealId: contact.rdCrmDealId,
                dealLink: contact.rdCrmDealLink,
                deal,
                fieldsSchema,
                debug: {
                  dealKeys: Object.keys(deal || {}),
                  dealCustomFieldsType: typeof (deal?.deal_custom_fields || deal?.custom_fields),
                  dealCustomFieldsIsArray: Array.isArray(deal?.deal_custom_fields || deal?.custom_fields),
                  dealCustomFieldsRaw: deal?.deal_custom_fields || deal?.custom_fields || null,
                }
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          } catch (err: any) {
            console.error("[RD Deal API] Erro ao buscar deal no CRM:", err.message);
            return new Response(
              JSON.stringify({
                linked: true,
                dealId: contact.rdCrmDealId,
                dealLink: contact.rdCrmDealLink,
                error: "Negócio não encontrado no RD Station CRM. Pode ter sido excluído.",
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // POST — Vincula um negócio ao contato com base no link do deal
      POST: async ({ request, params }) => {
        try {
          const { contactId } = params as { contactId: string };
          const body = (await request.json()) as { dealLink: string };
          const { dealLink } = body;

          if (!dealLink) {
            return new Response(JSON.stringify({ error: "Link do deal é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Regex para extrair o ID de 24 caracteres hexadecimais do deal
          // Ex: https://crm.rdstation.com/app/deals/6a553bf01ababc00016b9a4e?view=pipeline
          const match = dealLink.match(/deals\/([a-f0-9]{24})/i);
          if (!match) {
            return new Response(
              JSON.stringify({
                error:
                  "Link do deal inválido. Cole uma URL do tipo: https://crm.rdstation.com/app/deals/ID",
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const dealId = match[1];

          // Busca o contato para obter o tenantId
          const [contact] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, contactId));

          if (!contact) {
            return new Response(JSON.stringify({ error: "Contato não encontrado" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const tenantId = contact.tenantId;

          // Valida a existência do deal na API do RD CRM
          let deal;
          try {
            deal = await rdRequest(tenantId, "GET", `/deals/${dealId}`);
          } catch (err: any) {
            return new Response(
              JSON.stringify({
                error: `Negócio não encontrado no RD CRM. Detalhes: ${err.message}`,
              }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Salva no banco de dados local
          await db
            .update(contacts)
            .set({
              rdCrmDealId: dealId,
              rdCrmDealLink: dealLink,
            })
            .where(eq(contacts.id, contactId));

          return new Response(
            JSON.stringify({
              success: true,
              dealId,
              dealLink,
              deal,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // PATCH — Atualiza informações do deal no RD CRM
      PATCH: async ({ request, params }) => {
        try {
          const { contactId } = params as { contactId: string };
          const body = (await request.json()) as {
            name: string;
            value: number;
            companyName?: string;
            organizationId?: string;
            deal_custom_fields?: Array<{ custom_field_id: string; value: any }>;
          };

          const [contact] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, contactId));

          if (!contact) {
            return new Response(JSON.stringify({ error: "Contato não encontrado" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (!contact.rdCrmDealId) {
            return new Response(JSON.stringify({ error: "Contato não possui vínculo com o RD CRM" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const tenantId = contact.tenantId;
          const dealId = contact.rdCrmDealId;

          // 1. Atualiza a Empresa (Organization) no CRM, se id e nome estiverem presentes
          if (body.companyName && body.organizationId) {
            try {
              await rdRequest(tenantId, "PUT", `/organizations/${body.organizationId}`, {
                name: body.companyName,
              });
            } catch (orgErr: any) {
              console.error("[RD Deal API] Erro ao atualizar empresa no CRM:", orgErr.message);
            }
          }

          // 2. Atualiza o Negócio (Deal) no CRM (v2 espera total_price, v1/outros aceitam value)
          const dealPayload: Record<string, any> = {
            name: body.name,
            value: body.value,
            total_price: body.value,
            price: body.value,
            amount_total: body.value,
          };

          if (body.deal_custom_fields) {
            dealPayload.deal_custom_fields = body.deal_custom_fields;
          }

          const updatedDeal = await rdRequest(tenantId, "PUT", `/deals/${dealId}`, dealPayload);

          return new Response(JSON.stringify({ success: true, deal: updatedDeal }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[RD Deal API] Erro no PATCH:", e.message);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // DELETE — Remove o vínculo local com o deal do RD CRM
      DELETE: async ({ params }) => {
        try {
          const { contactId } = params as { contactId: string };

          const [contact] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, contactId));

          if (!contact) {
            return new Response(JSON.stringify({ error: "Contato não encontrado" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Limpa os campos de vínculo no banco local
          await db
            .update(contacts)
            .set({
              rdCrmDealId: null,
              rdCrmDealLink: null,
            })
            .where(eq(contacts.id, contactId));

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
