import {
  hashIdempotencyPayload,
  lookupMcpIdempotency,
  saveMcpIdempotency,
} from "./mcp-idempotency";
import type {
  McpToolDefinition,
  McpWriteActorContext,
} from "./valem-tecfag-mcp-write-tools";
import {
  listOperatorWhispers,
  sendOperatorWhisper,
} from "../valentina/operator-whisper-service";

const TENANT_ID_PROP = {
  type: "string",
  enum: ["tecfag", "valem"],
  default: "tecfag",
  description:
    "Tenant alvo ('tecfag' ou 'valem'). Ignorado quando a chave MCP está travada em um tenant.",
};

export const MCP_WHISPER_TOOLS: McpToolDefinition[] = [
  {
    name: "send_operator_whisper",
    access: "write",
    description:
      "[ESCRITA] Envia um sussurro/cobrança para um vendedor (ou grupo/setor) via chat interno do Fagner/Valentina (com alerta sonoro, toast e botão 'Ciente') e, quando houver conversa vinculada em envio individual, também espelha como nota interna de supervisão invisível ao cliente. Aceita lead (dealId), conversa (conversationId), ambos ou texto livre; sem efeitos colaterais na fila por padrão.",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: {
        tenantId: TENANT_ID_PROP,
        message: {
          type: "string",
          description:
            "Texto da cobrança/orientação para o vendedor (1 a 4000 caracteres). Se rewriteWithAi=true, funciona como instrução/motivo que o Fagner/Valentina reescreve.",
        },
        title: {
          type: "string",
          description: "Título curto opcional exibido no cabeçalho do card e toast (máx. 140 chars).",
        },
        operatorId: {
          type: "string",
          description:
            "ID exato do vendedor destinatário (opcional se informar operatorName, operatorEmail, operatorIds, sectorId/sectorName ou se for inferível via dealId/conversationId).",
        },
        operatorName: {
          type: "string",
          description: "Nome (ou trecho único) do vendedor destinatário.",
        },
        operatorEmail: {
          type: "string",
          description: "E-mail exato do vendedor destinatário.",
        },
        operatorIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Lista de IDs de vendedores para disparo em grupo/aviso geral (até 50 vendedores). Não combina com assignConversation=true.",
        },
        sectorId: {
          type: "string",
          description: "ID de setor para disparar aviso/cobrança para todos os vendedores humanos do setor.",
        },
        sectorName: {
          type: "string",
          description: "Nome do setor para disparo em grupo (ex: 'Máquinas', 'Personnalité').",
        },
        dealId: {
          type: "string",
          description:
            "ID da negociação/lead no CRM (opcional). Adiciona atalho 'Abrir Negociação', descobre conversa vinculada automaticamente e infere o vendedor dono do card se omitido.",
        },
        conversationId: {
          type: "string",
          description:
            "ID da conversa no chat (opcional). Adiciona atalho 'Abrir Conversa', espelha nota interna de supervisão (invisível ao cliente) e infere o vendedor se omitido.",
        },
        priority: {
          type: "string",
          enum: ["normal", "alta", "urgente"],
          default: "normal",
          description: "Nível de urgência visual do sussurro ('normal', 'alta' ou 'urgente').",
        },
        senderName: {
          type: "string",
          description:
            "Nome do gestor/remetente exibido no cabeçalho (padrão: 'Gestão Comercial' ou label da chave MCP).",
        },
        asAiOnly: {
          type: "boolean",
          default: false,
          description:
            "Modo discreto: se true, aparece para o vendedor como cobrança do próprio Fagner/Valentina (sem citar gestor/supervisão na tela; autoria real fica salva em auditoria).",
        },
        rewriteWithAi: {
          type: "boolean",
          default: false,
          description:
            "Se true, usa Google Vertex AI na persona do tenant (Fagner/Valentina) para redigir a cobrança de forma natural a partir de 'message'. Padrão false (texto literal).",
        },
        tone: {
          type: "string",
          enum: ["consultivo", "direto", "urgente"],
          default: "consultivo",
          description: "Tom usado quando rewriteWithAi=true ('consultivo', 'direto' ou 'urgente').",
        },
        mirrorInConversation: {
          type: "boolean",
          description:
            "Se true (padrão em envio individual com conversa), também grava nota interna de supervisão dentro da conversa do cliente (invisível ao cliente). Passe false para enviar apenas no chat do Fagner/Valentina.",
        },
        assignConversation: {
          type: "boolean",
          default: false,
          description:
            "Efeito colateral explícito: se true (apenas em envio individual com conversa vinculada), atribui a conversa ao vendedor em 'Meus Atendimentos'. Padrão false (não altera fila nem dono).",
        },
        idempotencyKey: {
          type: "string",
          description:
            "Chave única opcional (ex: 'cobrar-deal-123-2026-11-24') para evitar disparo duplicado em retries ou rotinas automáticas.",
        },
      },
    },
  },
  {
    name: "list_operator_whispers",
    access: "read",
    description:
      "[LEITURA] Consulta o histórico de sussurros/cobranças enviados aos vendedores do tenant, com status de leitura (read), confirmação de ciência ('Ciente' + timestamp), vínculo de lead/conversa e resumo de pendências.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        operatorId: {
          type: "string",
          description: "Filtrar por ID do vendedor destinatário (opcional).",
        },
        operatorName: {
          type: "string",
          description: "Filtrar por nome do vendedor destinatário (opcional).",
        },
        dealId: {
          type: "string",
          description: "Filtrar sussurros vinculados a uma negociação CRM específica (opcional).",
        },
        conversationId: {
          type: "string",
          description: "Filtrar sussurros vinculados a uma conversa específica (opcional).",
        },
        priority: {
          type: "string",
          enum: ["normal", "alta", "urgente"],
          description: "Filtrar por prioridade (opcional).",
        },
        status: {
          type: "string",
          enum: ["all", "pending", "read", "acknowledged"],
          default: "all",
          description:
            "Filtrar por status: 'all' (todos), 'pending' (aguardando confirmação 'Ciente'), 'acknowledged' (vendedor clicou 'Ciente') ou 'read' (lidos).",
        },
        dateFrom: {
          type: "string",
          description: "Data/hora inicial ISO 8601 (opcional).",
        },
        dateTo: {
          type: "string",
          description: "Data/hora final ISO 8601 (opcional).",
        },
        limit: {
          type: "number",
          default: 30,
          description: "Quantidade máxima de registros (1 a 100, padrão 30).",
        },
      },
    },
  },
];

export const MCP_WHISPER_TOOL_LABELS_PT: Record<string, string> = {
  send_operator_whisper: "Enviar Sussurro / Cobrança ao Operador",
  list_operator_whispers: "Listar Histórico de Sussurros Enviados",
};

const WHISPER_TOOL_NAMES = new Set(MCP_WHISPER_TOOLS.map((t) => t.name));

export function isWhisperMcpTool(name: string): boolean {
  return WHISPER_TOOL_NAMES.has(name);
}

export async function executeWhisperMcpTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: string,
  actor?: McpWriteActorContext,
): Promise<unknown> {
  if (name === "list_operator_whispers") {
    return listOperatorWhispers({
      tenantId,
      operatorId: typeof args.operatorId === "string" ? args.operatorId : null,
      operatorName: typeof args.operatorName === "string" ? args.operatorName : null,
      dealId: typeof args.dealId === "string" ? args.dealId : null,
      conversationId: typeof args.conversationId === "string" ? args.conversationId : null,
      priority: typeof args.priority === "string" ? args.priority : null,
      status: typeof args.status === "string" ? args.status : "all",
      dateFrom: typeof args.dateFrom === "string" ? args.dateFrom : null,
      dateTo: typeof args.dateTo === "string" ? args.dateTo : null,
      limit: typeof args.limit === "number" ? args.limit : Number(args.limit) || 30,
    });
  }

  if (name === "send_operator_whisper") {
    const idempotencyKey =
      typeof args.idempotencyKey === "string" ? args.idempotencyKey.trim() : "";

    if (idempotencyKey) {
      const cached = await lookupMcpIdempotency(tenantId, "send_operator_whisper", idempotencyKey);
      if (cached) {
        return { ...cached, idempotentReplay: true };
      }
    }

    const senderName =
      typeof args.senderName === "string" && args.senderName.trim()
        ? args.senderName.trim()
        : "Gestão Comercial";

    const result = await sendOperatorWhisper({
      tenantId,
      message: String(args.message ?? ""),
      title: typeof args.title === "string" ? args.title : null,
      operatorId: typeof args.operatorId === "string" ? args.operatorId : null,
      operatorName: typeof args.operatorName === "string" ? args.operatorName : null,
      operatorEmail: typeof args.operatorEmail === "string" ? args.operatorEmail : null,
      operatorIds: Array.isArray(args.operatorIds)
        ? args.operatorIds.filter((v): v is string => typeof v === "string")
        : null,
      sectorId: typeof args.sectorId === "string" ? args.sectorId : null,
      sectorName: typeof args.sectorName === "string" ? args.sectorName : null,
      dealId: typeof args.dealId === "string" ? args.dealId : null,
      conversationId: typeof args.conversationId === "string" ? args.conversationId : null,
      priority: typeof args.priority === "string" ? args.priority : "normal",
      senderName,
      asAiOnly: args.asAiOnly === true,
      rewriteWithAi: args.rewriteWithAi === true,
      tone: typeof args.tone === "string" ? args.tone : "consultivo",
      mirrorInConversation:
        typeof args.mirrorInConversation === "boolean" ? args.mirrorInConversation : undefined,
      assignConversation: args.assignConversation === true,
      source: "mcp",
      actorMeta: {
        keyId: actor?.keyId ?? null,
        keyLabel: actor?.keyLabel ?? null,
        clientName: actor?.clientName ?? null,
      },
    });

    if (idempotencyKey) {
      const payloadHash = hashIdempotencyPayload({
        tenantId,
        operatorId: args.operatorId ?? null,
        operatorName: args.operatorName ?? null,
        operatorIds: args.operatorIds ?? null,
        sectorId: args.sectorId ?? null,
        dealId: args.dealId ?? null,
        conversationId: args.conversationId ?? null,
        message: args.message ?? "",
      });
      await saveMcpIdempotency(
        tenantId,
        "send_operator_whisper",
        idempotencyKey,
        result as unknown as Record<string, unknown>,
        payloadHash,
      );
    }

    return result;
  }

  throw new Error(`Ferramenta de sussurro MCP desconhecida: '${name}'.`);
}
