import { and, eq, or } from "drizzle-orm";
import { db } from "../../db";
import { agentConfigs, metaMessageTemplates } from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import {
  normalizeWhatsappNumber,
  parseSiteChannelSettings,
} from "../livechat/site-channel-policy";
import type { McpToolDefinition } from "./valem-tecfag-mcp-write-tools";

const TENANT_ID_PROP = {
  type: "string",
  enum: ["tecfag", "valem"],
  default: "tecfag",
  description:
    "Tenant alvo ('tecfag' ou 'valem'). Ignorado quando a chave MCP está travada em um tenant.",
};

export const MCP_SITE_CHANNEL_TOOLS: McpToolDefinition[] = [
  {
    name: "get_site_channel_config",
    access: "read",
    description:
      "[LEITURA] Retorna a configuração atual do canal Live Chat (Site) no perfil industrial (status ativo, origens CORS, WhatsApp de continuidade e template oficial Meta pós-triagem).",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
      },
    },
  },
  {
    name: "update_site_channel_config",
    access: "write",
    description:
      "[ESCRITA] Atualiza parcialmente a configuração do canal Live Chat (Site) no perfil industrial — preserva campos não informados e valida que o template pós-triagem está APPROVED na Meta.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        siteChannelEnabled: {
          type: "boolean",
          description: "Habilita ou pausa o atendimento do widget no site (opcional).",
        },
        siteAllowedOrigins: {
          type: "array",
          items: { type: "string" },
          description: "Lista de origens https:// autorizadas (opcional; preserva atual se omitido).",
        },
        siteWhatsappNumber: {
          type: "string",
          description: "Número oficial WhatsApp DDI+DDD+número (opcional; preserva atual se omitido).",
        },
        siteWhatsappTemplateId: {
          type: "string",
          description:
            "ID, metaTemplateId ou nome exato de um template Meta APPROVED para disparo automático pós-triagem no site (passe '' para desativar o disparo automático).",
        },
      },
    },
  },
];

export const MCP_SITE_CHANNEL_TOOL_LABELS_PT: Record<string, string> = {
  get_site_channel_config: "Consultar Configuração do Canal Site",
  update_site_channel_config: "Atualizar Configuração do Canal Site",
};

const SITE_CHANNEL_TOOL_NAMES = new Set(MCP_SITE_CHANNEL_TOOLS.map((t) => t.name));

export function isSiteChannelMcpTool(name: string): boolean {
  return SITE_CHANNEL_TOOL_NAMES.has(name);
}

async function resolveApprovedTemplateInTenant(tenantId: string, rawRef: string) {
  const clean = rawRef.trim();
  if (!clean) return null;
  const [tpl] = await db
    .select({
      id: metaMessageTemplates.id,
      metaTemplateId: metaMessageTemplates.metaTemplateId,
      name: metaMessageTemplates.name,
      language: metaMessageTemplates.language,
      category: metaMessageTemplates.category,
      status: metaMessageTemplates.status,
      bodyText: metaMessageTemplates.bodyText,
    })
    .from(metaMessageTemplates)
    .where(
      and(
        eq(metaMessageTemplates.tenantId, tenantId),
        eq(metaMessageTemplates.status, "APPROVED"),
        or(
          eq(metaMessageTemplates.id, clean),
          eq(metaMessageTemplates.metaTemplateId, clean),
          eq(metaMessageTemplates.name, clean),
        ),
      ),
    )
    .limit(1);
  return tpl ?? null;
}

export async function executeSiteChannelMcpTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: string,
) {
  if (getAiPersona(tenantId).triagePolicy !== "industrial") {
    throw new Error(`Configuração do canal Site industrial indisponível para o tenant '${tenantId}'.`);
  }

  const [row] = await db
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "sdr")))
    .limit(1);

  if (name === "get_site_channel_config") {
    const config = ((row?.config as Record<string, unknown>) || {}) as Record<string, unknown>;
    const settings = parseSiteChannelSettings(true, config);
    const activeTemplate = settings.whatsappTemplateId
      ? await resolveApprovedTemplateInTenant(tenantId, settings.whatsappTemplateId)
      : null;
    return {
      tenantId,
      sdrConfigured: Boolean(row),
      sdrEnabled: row?.enabled === 1,
      siteChannelEnabled: settings.enabled,
      siteAllowedOrigins: settings.allowedOrigins,
      siteWhatsappNumber: settings.whatsappNumber,
      siteWhatsappTemplateId: settings.whatsappTemplateId,
      activeTemplate,
    };
  }

  if (name === "update_site_channel_config") {
    if (!row) {
      throw new Error("Configure e habilite o agente SDR antes de atualizar o canal do site.");
    }

    const prevConfig = ((row.config as Record<string, unknown>) || {}) as Record<string, unknown>;
    const prevSettings = parseSiteChannelSettings(true, prevConfig);

    const nextEnabled =
      typeof args.siteChannelEnabled === "boolean"
        ? args.siteChannelEnabled
        : prevSettings.enabled;

    let nextOrigins = prevSettings.allowedOrigins;
    if (Array.isArray(args.siteAllowedOrigins)) {
      const provided = args.siteAllowedOrigins
        .filter((o): o is string => typeof o === "string")
        .map((o) => o.trim())
        .filter(Boolean);
      if (
        provided.some(
          (o) => !parseSiteChannelSettings(true, { siteAllowedOrigins: [o] }).allowedOrigins.length,
        )
      ) {
        throw new Error("Informe origens válidas no formato https://dominio.com.br.");
      }
      nextOrigins = parseSiteChannelSettings(true, { siteAllowedOrigins: provided }).allowedOrigins;
    }

    let nextWhatsappNumber = prevSettings.whatsappNumber;
    if (typeof args.siteWhatsappNumber === "string") {
      const rawNum = args.siteWhatsappNumber.trim();
      if (!rawNum) {
        nextWhatsappNumber = "";
      } else {
        const norm = normalizeWhatsappNumber(rawNum);
        if (!norm) {
          throw new Error("Informe o WhatsApp com DDI e DDD, ex.: 5514999999999.");
        }
        nextWhatsappNumber = norm;
      }
    }

    let nextTemplateId = prevSettings.whatsappTemplateId;
    let resolvedTemplate = nextTemplateId
      ? await resolveApprovedTemplateInTenant(tenantId, nextTemplateId)
      : null;

    if (typeof args.siteWhatsappTemplateId === "string") {
      const rawTpl = args.siteWhatsappTemplateId.trim();
      if (!rawTpl) {
        nextTemplateId = "";
        resolvedTemplate = null;
      } else {
        const found = await resolveApprovedTemplateInTenant(tenantId, rawTpl);
        if (!found) {
          throw new Error(
            `Template Meta '${rawTpl}' não encontrado ou não está com status APPROVED no tenant '${tenantId}'.`,
          );
        }
        nextTemplateId = found.metaTemplateId || found.name;
        resolvedTemplate = found;
      }
    }

    const nextConfig: Record<string, unknown> = {
      ...prevConfig,
      siteChannelEnabled: nextEnabled,
      siteAllowedOrigins: nextOrigins,
      siteWhatsappNumber: nextWhatsappNumber,
      siteWhatsappTemplateId: nextTemplateId,
    };

    await db
      .update(agentConfigs)
      .set({ config: nextConfig, updatedAt: new Date() })
      .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.id, row.id)));

    return {
      success: true,
      tenantId,
      sdrEnabled: row.enabled === 1,
      siteChannelEnabled: nextEnabled,
      siteAllowedOrigins: nextOrigins,
      siteWhatsappNumber: nextWhatsappNumber,
      siteWhatsappTemplateId: nextTemplateId,
      activeTemplate: resolvedTemplate,
    };
  }

  throw new Error(`Ferramenta de canal Site desconhecida: '${name}'.`);
}
