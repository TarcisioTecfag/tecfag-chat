// src/routes/api/voice-objectives.ts
// CRUD para Objetivos da Valentina — sem emojis, 100% icones lucide-react

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { voiceObjectives } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireSession } from "../../lib/auth-session";
import { recordCrmAction } from "../../lib/crm/action-history";

const corsHeaders = { "Content-Type": "application/json" };
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

// ── Templates pre-definidos com icones Lucide profissionais ───────────────────
const TEMPLATES = [
  {
    emoji: "star",
    name: "Valentina NPS",
    description: "Coleta NPS pós-compra: avaliação da experiência com a Valem em nota de 1 a 10 e feedback livre.",
    prompt: `Você é a Valentina, representante de relacionamento da Valem Válvulas e Embalagens.
Seu objetivo nesta ligação é coletar o NPS (Net Promoter Score) do cliente sobre a experiência recente de compra.

ROTEIRO:
1. Apresente-se cordialmente: "Olá! Aqui é a Valentina, da Valem Válvulas. Tudo bem?"
2. Explique o motivo: "Estou ligando para saber como foi sua experiência com a nossa empresa."
3. Pergunte a nota: "De 0 a 10, qual nota você daria para a Valem? Sendo 0 péssimo e 10 excelente."
4. Colete o feedback: "O que motivou essa nota? Tem algo que podemos melhorar?"
5. Agradeça e finalize: "Muito obrigada pelo seu feedback! Ele é muito importante para nós."

REGRAS:
- Tom amigável, empático e breve (máximo 5 minutos)
- Se nota < 7: demonstre preocupação e pergunte o que podemos fazer melhor
- Se nota >= 9: pergunte se indicaria a Valem para algum conhecido
- Nunca tente vender nada nesta ligação`,
    collectFields: [
      { key: "rating", label: "Nota NPS (0-10)", type: "number", required: true },
      { key: "feedback", label: "Feedback do cliente", type: "text", required: false },
      { key: "recommendation", label: "Indicaria a Valem?", type: "boolean", required: false },
    ],
    actions: ["collect_nps", "schedule_callback"],
    isTemplate: true,
  },
  {
    emoji: "rotate-ccw",
    name: "Valentina Requalificação",
    description: "Re-engaja leads que demonstraram interesse mas não converteram. Identifica objeções e retoma a negociação.",
    prompt: `Você é a Valentina, consultora comercial da Valem Válvulas e Embalagens.
Seu objetivo é retomar contato com um cliente que anteriormente demonstrou interesse em produtos Valem mas não avançou na compra.

ROTEIRO:
1. Apresentação: "Olá! Aqui é a Valentina, da Valem Válvulas. Tudo bem?"
2. Contextualize: "Notei que conversamos anteriormente sobre embalagens. Queria saber como está o andamento desse projeto."
3. Identifique objeções: "O que fez você não avançar na época? Preço, prazo, especificação técnica?"
4. Requalifique: "Esse projeto ainda está ativo? Qual seria o volume e o prazo ideal?"
5. Proponha próximo passo: "Posso te enviar uma proposta atualizada pelo WhatsApp agora?"

REGRAS:
- Tom consultivo e sem pressão
- Se cliente não tem mais interesse: registre o motivo e agradeça
- Se cliente tem interesse: colete produto, volume e prazo para proposta
- Máximo 7 minutos`,
    collectFields: [
      { key: "motivation", label: "Motivo da desistência anterior", type: "text", required: false },
      { key: "project_active", label: "Projeto ainda ativo?", type: "boolean", required: true },
      { key: "product_interest", label: "Produto de interesse", type: "text", required: false },
      { key: "volume", label: "Volume estimado", type: "text", required: false },
      { key: "timeline", label: "Prazo desejado", type: "text", required: false },
    ],
    actions: ["create_rd_deal", "send_whatsapp_catalog", "schedule_callback"],
    isTemplate: true,
  },
  {
    emoji: "user-plus",
    name: "Valentina Prospecção Fria",
    description: "Primeiro contato com potenciais clientes. Qualifica empresa, identifica necessidade e gera oportunidade no CRM.",
    prompt: `Você é a Valentina, consultora comercial da Valem Válvulas e Embalagens.
Esta é uma ligação de primeiro contato (prospecção ativa).

ROTEIRO:
1. Apresente a Valem em 15 segundos: especialista em válvulas, frascos e embalagens industriais
2. Identifique o decisor: "Você é o responsável pelas compras de embalagens da empresa?"
3. Qualifique a empresa: "Qual o principal produto que vocês embalam atualmente? Em qual volume aproximado?"
4. Apresente valor: "A Valem pode otimizar seu custo de embalagem com escala e entrega ágil. Posso te enviar uma simulação?"
5. Capture contato: "Posso enviar nosso catálogo completo pelo WhatsApp agora?"

REGRAS:
- Seja direta, profissional e objetiva — máximo 4 minutos
- Se não é o decisor: pergunte o nome do responsável
- Sempre tente conseguir um próximo passo claro`,
    collectFields: [
      { key: "is_decision_maker", label: "É o decisor de compras?", type: "boolean", required: true },
      { key: "product_packaged", label: "Produto que embalam", type: "text", required: false },
      { key: "volume", label: "Volume mensal estimado", type: "text", required: false },
      { key: "current_supplier", label: "Fornecedor atual", type: "text", required: false },
      { key: "interest_level", label: "Nível de interesse (1-5)", type: "number", required: false },
    ],
    actions: ["enrich_cnpj", "create_rd_deal", "send_whatsapp_catalog", "schedule_callback"],
    isTemplate: true,
  },
  {
    emoji: "calendar-days",
    name: "Valentina Agendamento de Visita",
    description: "Agenda visita técnica ou comercial presencial. Confirma endereço, horário e decisores presentes.",
    prompt: `Você é a Valentina, assistente comercial da Valem Válvulas e Embalagens.
Seu objetivo é agendar uma visita técnica ou comercial com o cliente.

ROTEIRO:
1. Contextualize: "Nosso consultor comercial gostaria de visitar sua empresa para apresentar nossas soluções e amostras."
2. Confirme disponibilidade: "Qual seria o melhor dia e horário para vocês? Atendemos de segunda a sexta."
3. Confirme endereço: "Qual o endereço completo da unidade?"
4. Confirme presença do decisor: "O responsável pelas compras estará presente no momento da visita?"
5. Resuma o agendamento e confirme todos os detalhes com clareza.

REGRAS:
- Confirme todos os dados antes de encerrar
- Se cliente não tem disponibilidade imediata: ofereça opções flexíveis
- Envie confirmação pelo WhatsApp ao término da ligação`,
    collectFields: [
      { key: "visit_date", label: "Data da visita", type: "text", required: true },
      { key: "visit_time", label: "Horário da visita", type: "text", required: true },
      { key: "address", label: "Endereço confirmado", type: "text", required: false },
      { key: "decision_maker_present", label: "Decisor estará presente?", type: "boolean", required: false },
      { key: "decision_maker_name", label: "Nome do decisor", type: "text", required: false },
    ],
    actions: ["schedule_callback", "send_whatsapp_catalog"],
    isTemplate: true,
  },
  {
    emoji: "wallet",
    name: "Valentina Cobrança Amigável",
    description: "Lembrete cordial de faturas em aberto. Foco em alinhamento de prazos, 2ª via e conciliação financeira.",
    prompt: `Você é a Valentina, do setor financeiro da Valem Válvulas e Embalagens.
Seu objetivo é entrar em contato sobre uma fatura pendente de forma cordial, profissional e transparente.

ROTEIRO:
1. Apresente-se: "Olá! Aqui é a Valentina, do financeiro da Valem. Tudo bem?"
2. Informe o motivo: "Identifiquei uma fatura em aberto no sistema. O pagamento já foi realizado ou houve algum desencontro?"
3. Se já pagou: agradeça cordialmente e peça o envio do comprovante
4. Se não pagou: "Quando seria possível realizar a liquidação? Posso te enviar a 2ª via atualizada pelo WhatsApp."
5. Registre o compromisso de data acordado.

REGRAS:
- Tom sempre cortês e construtivo — trate como possível esquecimento ou atraso bancário
- Se o cliente relatar dificuldades: anote proposta para análise interna
- Máximo 5 minutos`,
    collectFields: [
      { key: "already_paid", label: "Cliente afirma que já pagou?", type: "boolean", required: true },
      { key: "payment_date", label: "Data prometida de pagamento", type: "text", required: false },
      { key: "installments_requested", label: "Solicitou negociação/parcelamento?", type: "boolean", required: false },
      { key: "notes", label: "Observações financeiras", type: "text", required: false },
    ],
    actions: ["send_whatsapp_catalog", "schedule_callback"],
    isTemplate: true,
  },
];

async function seedTemplates(tenantId: string) {
  try {
    const existing = await db
      .select({ id: voiceObjectives.id })
      .from(voiceObjectives)
      .where(and(eq(voiceObjectives.tenantId, tenantId), eq(voiceObjectives.isTemplate, true)));
    if (existing.length > 0) return;

    const rows = TEMPLATES.map((t, idx) => ({
      id: `obj_tpl_${idx + 1}_${tenantId}`,
      tenantId,
      name: t.name,
      description: t.description,
      emoji: t.emoji,
      prompt: t.prompt,
      collectFields: t.collectFields as any,
      actions: t.actions as any,
      isActive: true,
      isTemplate: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await db.insert(voiceObjectives).values(rows);
    console.log(`[VoiceObjectives] ${rows.length} templates profissionais criados para ${tenantId}`);
  } catch (err: any) {
    console.warn("[VoiceObjectives] Seed falhou:", err?.message);
  }
}

export const Route = createFileRoute("/api/voice-objectives")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return json({ error: "tenantId e obrigatorio" }, 400);
        await seedTemplates(tenantId);
        const list = await db
          .select()
          .from(voiceObjectives)
          .where(eq(voiceObjectives.tenantId, tenantId));
        return json({ objectives: list });
      },

      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId, ...data } = body;
          if (!tenantId) return json({ error: "tenantId e obrigatorio" }, 400);
          if (!data.name || !data.prompt) return json({ error: "name e prompt sao obrigatorios" }, 400);
          const row = {
            id: `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            tenantId,
            name: data.name,
            description: data.description || null,
            emoji: data.emoji || data.icon || "target",
            prompt: data.prompt,
            collectFields: (data.collectFields || []) as any,
            actions: (data.actions || []) as any,
            isActive: data.isActive !== false,
            isTemplate: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          const [inserted] = await db.insert(voiceObjectives).values(row).returning();
          return json({ success: true, objective: inserted }, 201);
        } catch (err: any) {
          return json({ error: err?.message ?? "Erro ao criar objetivo" }, 500);
        }
      },

      PUT: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId, id, ...updates } = body;
          if (!tenantId) return json({ error: "tenantId e obrigatorio" }, 400);
          if (!id) return json({ error: "id e obrigatorio" }, 400);
          await db
            .update(voiceObjectives)
            .set({ ...updates, updatedAt: new Date() })
            .where(and(eq(voiceObjectives.id, id), eq(voiceObjectives.tenantId, tenantId)));
          return json({ success: true });
        } catch (err: any) {
          return json({ error: err?.message ?? "Erro ao atualizar" }, 500);
        }
      },

      DELETE: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const url = new URL(request.url);
          const tenantId = session.tenantId;
          const id = url.searchParams.get("id");
          if (!id) return json({ error: "id e obrigatorio" }, 400);
          const [deleted] = await db
            .delete(voiceObjectives)
            .where(and(eq(voiceObjectives.id, id), eq(voiceObjectives.tenantId, tenantId)))
            .returning({ id: voiceObjectives.id, name: voiceObjectives.name });
          if (!deleted) return json({ error: "Objetivo não encontrado." }, 404);
          await recordCrmAction({ tenantId, operatorId: session.operator.id, operatorName: session.operator.name,
            action: "delete_voice_objective", entityType: "voice_objective", itemCount: 1,
            details: { id: deleted.id, name: deleted.name } });
          return json({ success: true });
        } catch (err: any) {
          return json({ error: err?.message ?? "Erro ao remover" }, 500);
        }
      },
    },
  },
});
