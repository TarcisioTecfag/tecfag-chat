import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  internalMessages,
  conversations,
  messages,
  contacts,
  operators,
  responseTimeLogs,
  operatorDailyMetrics,
  aiConversationAudits,
} from "../../../db/schema";
import { eq, and, desc, sql, gte, isNull, ne } from "drizzle-orm";
import crypto from "crypto";

// ── Headers CORS padrão ──────────────────────────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Extrai texto de arquivo anexado (PDF, DOCX, XLSX, TXT) ────────────────────────────
async function extractFileText(name: string, mimeType: string, base64: string): Promise<string> {
  const buf = Buffer.from(base64, "base64");
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  // TXT — decode direto
  if (mimeType === "text/plain" || ext === "txt") {
    return buf.toString("utf-8").slice(0, 12000);
  }

  // PDF
  if (mimeType === "application/pdf" || ext === "pdf") {
    try {
      const pdfParse = await import("pdf-parse");
      const pdfFn = (pdfParse as any).default || pdfParse;
      const result = await pdfFn(buf);
      return result.text.slice(0, 12000);
    } catch {
      return `[PDF recebido: ${name} — conteúdo não extraído automaticamente]`;
    }
  }

  // DOCX / DOC
  if (mimeType.includes("wordprocessingml") || mimeType.includes("msword") || ext === "docx" || ext === "doc") {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value.slice(0, 12000);
    } catch {
      return `[Documento Word recebido: ${name} — conteúdo não extraído automaticamente]`;
    }
  }

  // XLSX / XLS
  if (mimeType.includes("spreadsheetml") || mimeType.includes("ms-excel") || ext === "xlsx" || ext === "xls") {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "buffer" });
      const texts: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
        texts.push(`[Planilha: ${sheetName}]\n${csv}`);
      }
      return texts.join("\n\n").slice(0, 12000);
    } catch {
      return `[Planilha Excel recebida: ${name} — conteúdo não extraído automaticamente]`;
    }
  }

  return `[Arquivo recebido: ${name}]`;
}

// ── Respostas mock contextuais com suporte a blocos visuais ────────────────────
function generateMockResponse(userMessage: string): { text: string; blocks?: any[] }[] {
  const msg = userMessage.toLowerCase();

  if (/(gráfic|grafic|funil|evolu|comparat|tend|barras)/.test(msg)) {
    return [
      {
        text: "Analisei o funil de vendas dos últimos 7 dias. Abaixo está o gráfico representativo das etapas do atendimento:",
        blocks: [
          {
            type: "chart",
            chart: "bar",
            title: "Leads por etapa do funil",
            subtitle: "Últimos 7 dias",
            unit: "leads",
            data: [
              { label: "Novo", value: 248 },
              { label: "Contato", value: 186 },
              { label: "Qualificado", value: 121 },
              { label: "Proposta", value: 64 },
              { label: "Fechado", value: 31 },
            ],
          },
        ],
      },
    ];
  }

  if (/(relat|export|planilha|tabela|vendedor|ranking)/.test(msg)) {
    return [
      {
        text: "Gerei o relatório consolidado com o desempenho da equipe comercial:",
        blocks: [
          {
            type: "report",
            title: "Desempenho por Vendedor",
            columns: ["Vendedor", "Leads", "Atendidos", "Conversão", "Receita"],
            rows: [
              ["Carla Menezes", "84", "80", "16,7%", "R$ 58.900"],
              ["Diego Alves", "76", "69", "13,0%", "R$ 41.200"],
              ["Paula Ribeiro", "71", "71", "11,3%", "R$ 33.450"],
              ["Rafael Souza", "63", "52", "7,9%", "R$ 20.100"],
            ],
            footnote: "Período: 01/08 a 11/08 · Origem: Banco de dados",
          },
        ],
      },
    ];
  }

  if (/(conversa|objeç|objec|lead|cliente|atendimento)/.test(msg)) {
    return [
      {
        text: "Mapeei os trechos de conversas dos leads com mais recorrência de objeções:",
        blocks: [
          {
            type: "excerpt",
            title: "Trechos de conversas monitoradas",
            conversations: [
              {
                lead: "Marcos Tavares",
                channel: "WhatsApp",
                when: "Hoje, 14:02",
                sentiment: "negativo",
                lines: [
                  { from: "lead", text: "O valor ficou bem acima do que eu esperava." },
                  { from: "agente", text: "Consigo montar um plano parcelado em 12x, posso enviar?" },
                  { from: "lead", text: "Manda que eu avalio com o sócio." },
                ],
              },
              {
                lead: "Fernanda Lima",
                channel: "Instagram",
                when: "Ontem, 18:41",
                sentiment: "positivo",
                lines: [
                  { from: "lead", text: "Gostei da demonstração, qual o próximo passo?" },
                  { from: "agente", text: "Envio a proposta hoje ainda e agendamos a implantação." },
                ],
              },
            ],
          },
        ],
      },
    ];
  }

  if (/(insight|métric|metric|desempenho|resultado|resumo|kpi|tma|sla)/.test(msg)) {
    return [
      {
        text: "Consolidei os principais indicadores e insights da operação hoje:",
        blocks: [
          {
            type: "insight",
            title: "Insights da Operação",
            items: [
              { label: "Taxa de Conversão", value: "12,5%", delta: "+2,4 p.p.", trend: "up", hint: "vs. semana anterior" },
              { label: "TMA Média", value: "3m 12s", delta: "-48s", trend: "up", hint: "meta: 5 min" },
              { label: "Leads sem Follow-up", value: "37", delta: "+9", trend: "down", hint: "parados >48h" },
              { label: "Ticket Médio", value: "R$ 4.180", delta: "estável", trend: "flat" },
            ],
            recommendation: "Priorize os 37 leads parados há mais de 48h para evitar perda de oportunidade.",
          },
        ],
      },
    ];
  }

  return [
    {
      text: "Entendi sua solicitação! Posso analisar métricas, gerar gráficos de vendas, puxar relatórios da equipe ou verificar trechos de conversas dos leads. É só me pedir!",
    },
  ];
}

async function getOperatorContext(tenantId: string, operatorId: string): Promise<string> {
  try {
    const sections: string[] = [];

    const activeConvs = await db
      .select({
        id: conversations.id,
        contactName: contacts.name,
        lastMessage: conversations.lastMessageText,
        lastTime: conversations.lastMessageTime,
        queueState: conversations.queueState,
        unread: conversations.unreadCount,
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.operatorId, operatorId),
          ne(conversations.queueState, "finalizados")
        )
      )
      .orderBy(desc(conversations.lastMessageTime))
      .limit(15);

    if (activeConvs.length > 0) {
      const convList = activeConvs.map((c) => {
        const ago = Math.floor((Date.now() - new Date(c.lastTime).getTime()) / 60_000);
        return `  • ${c.contactName} (${c.queueState}) — última msg ${ago}min atrás${c.unread > 0 ? ` [${c.unread} não lidas]` : ""}: "${(c.lastMessage || "").slice(0, 80)}"`;
      }).join("\n");
      sections.push(`📋 CONVERSAS ATIVAS DO OPERADOR (${activeConvs.length}):\n${convList}`);
    } else {
      sections.push("📋 O operador não tem conversas ativas no momento.");
    }

    const slaIssues = await db
      .select({
        conversationId: responseTimeLogs.conversationId,
        contactName: contacts.name,
        clientMsgAt: responseTimeLogs.clientMessageAt,
        isOverdue: responseTimeLogs.isOverdue,
      })
      .from(responseTimeLogs)
      .innerJoin(conversations, eq(conversations.id, responseTimeLogs.conversationId))
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(
        and(
          eq(responseTimeLogs.tenantId, tenantId),
          eq(responseTimeLogs.operatorId, operatorId),
          isNull(responseTimeLogs.agentResponseId)
        )
      )
      .orderBy(desc(responseTimeLogs.clientMessageAt))
      .limit(10);

    if (slaIssues.length > 0) {
      const slaList = slaIssues.map((s) => {
        const waitMin = Math.floor((Date.now() - new Date(s.clientMsgAt).getTime()) / 60_000);
        return `  • ${s.contactName} — aguardando há ${waitMin}min${s.isOverdue ? " 🚨 ESTOURADO" : ""}`;
      }).join("\n");
      sections.push(`⏱️ SLA PENDENTES:\n${slaList}`);
    }

    const today = new Date().toISOString().split("T")[0];
    const dailyMetrics = await db
      .select()
      .from(operatorDailyMetrics)
      .where(
        and(
          eq(operatorDailyMetrics.tenantId, tenantId),
          eq(operatorDailyMetrics.operatorId, operatorId),
          eq(operatorDailyMetrics.date, today)
        )
      )
      .limit(1);

    if (dailyMetrics.length > 0) {
      const m = dailyMetrics[0];
      const tma = m.avgResponseTimeSeconds ? `${Math.floor(m.avgResponseTimeSeconds / 60)}min ${m.avgResponseTimeSeconds % 60}s` : "N/A";
      sections.push(`📊 MÉTRICAS DE HOJE DO OPERADOR:\n  • Total conversas: ${m.totalConversations}\n  • TMA: ${tma}\n  • SLA estourados: ${m.overdueCount}\n  • Score médio IA: ${m.avgPerformanceScore || "N/A"}/100`);
    }

    return sections.join("\n\n");
  } catch (err: any) {
    return "⚠️ Não foi possível carregar dados operacionais do banco neste momento.";
  }
}

async function getOperatorName(operatorId: string): Promise<string> {
  try {
    const [op] = await db
      .select({ name: operators.name })
      .from(operators)
      .where(eq(operators.id, operatorId))
      .limit(1);
    return op?.name || "Operador";
  } catch {
    return "Operador";
  }
}

export const Route = createFileRoute("/api/valentina/messages")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const operatorId = url.searchParams.get("operatorId");

        if (!tenantId || !operatorId) {
          return new Response(
            JSON.stringify({ error: "tenantId e operatorId são obrigatórios" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const scope = url.searchParams.get("scope") || "operator";

        try {
          const msgs = await db
            .select()
            .from(internalMessages)
            .where(
              and(
                eq(internalMessages.tenantId, tenantId),
                eq(internalMessages.operatorId, operatorId),
                sql`(${internalMessages.metadata}->>'scope' = ${scope} OR (${scope} = 'operator' AND (${internalMessages.metadata}->>'scope' IS NULL AND (${internalMessages.metadata}->>'type' IS NULL OR ${internalMessages.metadata}->>'isChat' = 'true'))))`
              )
            )
            .orderBy(desc(internalMessages.createdAt))
            .limit(100);

          const sorted = msgs.reverse();

          return new Response(JSON.stringify(sorted), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId, operatorId, content, scope = "operator", knowledgeBase, attachment, imageBase64 } = body;

          if (!tenantId || !operatorId) {
            return new Response(
              JSON.stringify({ error: "tenantId e operatorId são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          if (!content && !attachment && !imageBase64) {
            return new Response(
              JSON.stringify({ error: "content, attachment ou imageBase64 são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const contextTenantId = knowledgeBase === "all" ? tenantId : (knowledgeBase || tenantId);
          const now = new Date();

          const userMsgId = `val-msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          await db.insert(internalMessages).values({
            id: userMsgId,
            tenantId,
            operatorId,
            direction: "to_agent",
            agentType: "supervisor",
            content: content || `[Arquivo: ${attachment?.name ?? "imagem"}]`,
            metadata: {
              isChat: true,
              scope,
              knowledgeBase,
              attachedFileInfo: attachment ? { name: attachment.name, mimeType: attachment.mimeType } : undefined,
              attachedImageInfo: imageBase64 ? { name: "Imagem", dataUrl: imageBase64 } : undefined,
            },
            read: 1,
            createdAt: now,
          });

          const operatorName = await getOperatorName(operatorId);
          const operatorContext = await getOperatorContext(contextTenantId, operatorId);

          let fileContext = "";
          if (attachment?.base64 && attachment?.name) {
            const extracted = await extractFileText(attachment.name, attachment.mimeType || "", attachment.base64);
            fileContext = `\n\n📎 ARQUIVO ANEXADO: "${attachment.name}"\n${extracted}`;
          }

          let fragments: { text: string; delay?: number; blocks?: any[] }[] = [];
          let alerts: any[] = [];

          try {
            const { vertexAi } = await import("../../../lib/vertex-ai");

            if (vertexAi.isReady()) {
              const systemPrompt = `Você é a Valentina, I.A. Master e Assistente de Gestão & Business Intelligence (BI).
Você está conversando com o gestor "${operatorName}".

## SEU PAPEL:
- Você tem visão completa das operações: banco de dados, desempenho da equipe, TMA, métricas e base de conhecimento.
- Se o usuário pedir gráficos, relatórios, métricas ou trechos de conversas, forneça o bloco estruturado correspondente em "blocks".

## ESTRUTURA DE BLOCOS SUPORTADOS ("blocks"):
1. ChartBlock: { "type": "chart", "chart": "bar"|"line"|"pie", "title": "...", "subtitle": "...", "data": [{ "label": "X", "value": 10 }] }
2. InsightBlock: { "type": "insight", "title": "...", "items": [{ "label": "...", "value": "...", "delta": "+5%", "trend": "up"|"down"|"flat" }], "recommendation": "..." }
3. ReportBlock: { "type": "report", "title": "...", "columns": ["A","B"], "rows": [["1","2"]], "footnote": "..." }
4. ExcerptBlock: { "type": "excerpt", "title": "...", "conversations": [{ "lead": "...", "channel": "WhatsApp", "when": "Hoje", "sentiment": "positivo"|"neutro"|"negativo", "lines": [{ "from": "lead"|"agente", "text": "..." }] }] }

## DADOS REAIS DA OPERAÇÃO:
${operatorContext}
${fileContext}

## FORMATO OBRIGATÓRIO DE RESPOSTA (JSON):
{
  "fragments": [
    {
      "text": "mensagem explicativa em texto",
      "delay": 0,
      "blocks": [ ... ]
    }
  ]
}`;

              const aiRes = await vertexAi.generateStructuredJson<{
                fragments: { text: string; delay?: number; blocks?: any[] }[];
                alerts?: any[];
              }>(systemPrompt, "gemini-2.5-pro", undefined, {
                tenantId,
                feature: "valentina_chat",
                metadata: { operatorId, operatorName },
              });

              if (aiRes?.fragments && aiRes.fragments.length > 0) {
                fragments = aiRes.fragments;
                alerts = aiRes.alerts || [];
              }
            }
          } catch (aiErr: any) {
            console.warn("[valentina/messages] Vertex AI fallback:", aiErr?.message);
          }

          if (fragments.length === 0) {
            fragments = generateMockResponse(content);
          }

          const savedFragments: any[] = [];
          for (let i = 0; i < fragments.length; i++) {
            const frag = fragments[i];
            const fragId = `val-ai-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
            const fragTimestamp = new Date(now.getTime() + 600 + (i * 500));

            await db.insert(internalMessages).values({
              id: fragId,
              tenantId,
              operatorId,
              direction: "from_agent",
              agentType: "supervisor",
              content: frag.text,
              metadata: {
                isChat: true,
                scope,
                fragmentIndex: i,
                totalFragments: fragments.length,
                blocks: frag.blocks || undefined,
              },
              read: 0,
              createdAt: fragTimestamp,
            });

            savedFragments.push({
              id: fragId,
              content: frag.text,
              blocks: frag.blocks || undefined,
              direction: "from_agent",
              createdAt: fragTimestamp,
            });
          }

          return new Response(
            JSON.stringify({
              success: true,
              userMessage: { id: userMsgId, content, direction: "to_agent", createdAt: now },
              fragments: savedFragments.map((f, i) => ({
                ...f,
                delay: fragments[i]?.delay || i * 600,
              })),
              alerts,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
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
