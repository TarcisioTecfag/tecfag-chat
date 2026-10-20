import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { agentConfigs } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";
import { normalizeWhatsappNumber, parseSiteChannelSettings } from "../../../lib/livechat/site-channel-policy";

/**
 * Habilitação do canal Site (widget) no núcleo industrial.
 * Admin + perfil industrial; tenant sempre da sessão. Grava apenas as duas chaves do canal
 * dentro da configuração SDR existente, preservando os demais campos.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function authenticate(request: Request) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth;
  if (auth.session.operator.role !== "admin")
    return { response: json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403) };
  if (getAiPersona(auth.session.tenantId).triagePolicy !== "industrial")
    return { response: json({ error: "Configuração indisponível para este perfil." }, 404) };
  return auth;
}

async function readSdrConfig(tenantId: string) {
  const [row] = await db
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "sdr")))
    .limit(1);
  return row ?? null;
}

const bodySchema = z
  .object({
    siteChannelEnabled: z.boolean(),
    siteAllowedOrigins: z.array(z.string().max(300)).max(20),
    siteWhatsappNumber: z.string().max(30).optional(),
  })
  .strict();

export const Route = createFileRoute("/api/valentina/site-channel")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticate(request);
        if ("response" in auth) return auth.response;
        const row = await readSdrConfig(auth.session.tenantId);
        const config = (row?.config as Record<string, unknown>) || {};
        const settings = parseSiteChannelSettings(true, config);
        return json({
          sdrConfigured: Boolean(row),
          sdrEnabled: row?.enabled === 1,
          siteChannelEnabled: settings.enabled,
          siteAllowedOrigins: settings.allowedOrigins,
          siteWhatsappNumber: settings.whatsappNumber,
        });
      },
      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if ("response" in auth) return auth.response;
        const tenantId = auth.session.tenantId;
        let body: z.infer<typeof bodySchema>;
        try {
          body = bodySchema.parse(await request.json());
        } catch {
          return json({ error: "Dados inválidos." }, 400);
        }
        const provided = body.siteAllowedOrigins.map((o) => o.trim()).filter(Boolean);
        if (provided.some((o) => !parseSiteChannelSettings(true, { siteAllowedOrigins: [o] }).allowedOrigins.length))
          return json({ error: "Informe origens no formato https://dominio.com.br." }, 400);
        const origins = parseSiteChannelSettings(true, { siteAllowedOrigins: provided }).allowedOrigins;
        const rawNumber = (body.siteWhatsappNumber || "").trim();
        const whatsappNumber = normalizeWhatsappNumber(rawNumber);
        if (rawNumber && !whatsappNumber)
          return json({ error: "Informe o WhatsApp com DDI e DDD, ex.: 5514999999999." }, 400);
        const row = await readSdrConfig(tenantId);
        // Sem configuração SDR não há atendimento automático: não cria nem habilita o SDR aqui.
        if (!row) return json({ error: "Configure e habilite o SDR antes de ativar o canal do site." }, 409);
        const config = {
          ...((row.config as Record<string, unknown>) || {}),
          siteChannelEnabled: body.siteChannelEnabled,
          siteAllowedOrigins: origins,
          siteWhatsappNumber: whatsappNumber,
        };
        await db
          .update(agentConfigs)
          .set({ config, updatedAt: new Date() })
          .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.id, row.id)));
        return json({
          siteChannelEnabled: body.siteChannelEnabled,
          siteAllowedOrigins: origins,
          siteWhatsappNumber: whatsappNumber,
          sdrEnabled: row.enabled === 1,
        });
      },
    },
  },
});
