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

          // Busca os campos customizados configurados no CRM
          const allCrmFields = await rdRequest<any[]>(tenantId, "GET", "/custom_fields").catch((err) => {
            console.error("[RD Deal API] Erro ao buscar custom_fields:", err.message);
            return [];
          });

          // Busca o negócio na API do RD CRM
          try {
            const deal = await rdRequest(tenantId, "GET", `/deals/${contact.rdCrmDealId}`);
            
            // Resolve os IDs dos campos com base no label
            const fieldsSchema = {
              qualificadoSdr: allCrmFields.find((f) => f.label?.trim().toUpperCase() === "QUALIFICADO POR SDR (VALEM)"),
              projetosDesenvolvimento: allCrmFields.find((f) => f.label?.trim().toUpperCase() === "PROJETOS / DESENVOLVIMENTO"),
              tipoProduto: allCrmFields.find((f) => f.label?.trim().toUpperCase() === "QUAL O TIPO DE PRODUTO (VALEM)"),
              infoComplementar: allCrmFields.find((f) => f.label?.trim().toUpperCase() === "INFORMAÇÕES COMPLEMENTARES"),
              feitoPor: allCrmFields.find((f) => f.label?.trim().toUpperCase() === "FEITO POR"),
            };

            return new Response(
              JSON.stringify({
                linked: true,
                dealId: contact.rdCrmDealId,
                dealLink: contact.rdCrmDealLink,
                deal,
                fieldsSchema,
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

          // 2. Atualiza o Negócio (Deal) no CRM
          const dealPayload: Record<string, any> = {
            name: body.name,
            value: body.value,
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
