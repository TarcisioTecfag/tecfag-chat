/**
 * seed-mock-report.ts — Insere um relatório mock v2 para validação visual
 *
 * Executar com: npx tsx src/scripts/seed-mock-report.ts
 */

import { db } from "../db";
import { aiReports, aiReportVersions } from "../db/schema";
import { and, eq } from "drizzle-orm";

const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const fmtBR = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
const fmtBRTime = `${fmtBR}, ${pad(now.getHours())}:${pad(now.getMinutes())}`;
const dateIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const mockReport = {
  id: `d-${dateIso}`,
  kind: "Diário" as const,
  code: dateIso,
  date: dateIso,
  period: `${pad(now.getDate())} de agosto de ${now.getFullYear()}`,
  generatedAt: fmtBR,
  syncedAt: fmtBRTime,
  confidence: 93,
  headline: "Operação estável com SLA de 94,2% — volume 18% acima da média semanal",
  summary: "A operação registrou 47 conversas no período, superando a média semanal de 39,8 atendimentos. O SLA ficou em 94,2%, acima da meta de 92%. O tempo médio de primeira resposta caiu para 1m 42s, reflexo da escalação matutina reforçada. O sentimento predominante foi positivo (72% satisfeitos), com queda de 3pp nos clientes frustrados.",
  metrics: [
    {
      label: "Conversas atendidas",
      value: "47",
      delta: 18.3,
      deltaLabel: "vs. dia anterior",
      goodWhen: "up" as const,
    },
    {
      label: "1ª resposta (média)",
      value: "1m 42s",
      delta: -12.1,
      deltaLabel: "vs. dia anterior",
      goodWhen: "down" as const,
      target: "Meta 15m",
    },
    {
      label: "SLA cumprido",
      value: "94,2",
      unit: "%",
      delta: 2.4,
      goodWhen: "up" as const,
      progress: 94.2,
      target: "Meta 92%",
    },
    {
      label: "Nota média de QA",
      value: "8,7",
      unit: "/10",
      delta: 1.2,
      goodWhen: "up" as const,
      progress: 87,
    },
  ],
  sentiment: [
    { label: "Satisfeito", value: 72, signal: "positive" as const },
    { label: "Neutro", value: 19, signal: "info" as const },
    { label: "Frustrado", value: 9, signal: "critical" as const },
  ],
  volumeSeries: [
    { label: "08h", value: 3 },
    { label: "10h", value: 8 },
    { label: "12h", value: 12 },
    { label: "14h", value: 9 },
    { label: "16h", value: 7 },
    { label: "18h", value: 5 },
    { label: "20h", value: 3 },
  ],
  highlights: [
    {
      title: "SLA acima da meta pelo 3º dia consecutivo",
      detail: "A equipe manteve 94,2% de conformidade, refletindo a melhoria no escalonamento de turnos implementada na segunda-feira.",
      signal: "positive" as const,
      tag: "Processo",
      impact: "+2,4pp acima da meta de 92%",
    },
    {
      title: "Redução significativa no tempo de 1ª resposta",
      detail: "O FRT caiu 12% comparado ao dia anterior (1m 42s vs. 1m 56s), indicando efetividade do reforço matutino.",
      signal: "positive" as const,
      tag: "Suporte",
      impact: "FRT 32% abaixo do limite SLA",
    },
    {
      title: "Volume de conversas 18% acima da média",
      detail: "47 conversas atendidas contra média semanal de 39,8. A campanha promocional de agosto está gerando tráfego incremental.",
      signal: "positive" as const,
      tag: "Comercial",
      impact: "+7,2 conversas/dia vs. média",
    },
  ],
  gaps: [
    {
      title: "3 objeções comerciais não tratadas",
      detail: "A IA detectou que 3 leads com interesse em válvulas aerossol mencionaram preocupação com prazo de entrega, mas os operadores não abordaram a objeção diretamente.",
      signal: "warning" as const,
      tag: "Comercial",
      impact: "Potencial perda de R$ 12.400 em pedidos",
    },
    {
      title: "2 atendimentos encerrados sem follow-up",
      detail: "Conversas #4821 e #4837 foram finalizadas sem agendamento de próximo contato. Ambas eram leads qualificados pelo SDR.",
      signal: "critical" as const,
      tag: "Processo",
      impact: "2 oportunidades em risco de churn",
    },
  ],
  actions: [
    {
      title: "Treinamento relâmpago: tratamento de objeções de prazo",
      detail: "Realizar sessão de 15 minutos com a equipe de vendas sobre como responder objeções de prazo usando o script de urgência + garantia.",
      owner: "Supervisão Comercial",
      horizon: "Amanhã",
      priority: "Alta" as const,
      expected: "Reduzir objeções não tratadas para zero nos próximos 5 dias",
    },
    {
      title: "Implementar checklist de encerramento obrigatório",
      detail: "Adicionar validação no sistema que impede finalizar conversa sem registrar próximo passo quando o lead é qualificado.",
      owner: "Supervisão Operacional",
      horizon: "Esta semana",
      priority: "Crítica" as const,
      expected: "Eliminar 100% dos encerramentos sem follow-up",
    },
    {
      title: "Monitorar impacto da campanha de agosto no volume",
      detail: "O volume está 18% acima da média. Se a tendência se mantiver, considerar escalar mais um operador para o turno da tarde.",
      owner: "Gerência de Operações",
      horizon: "Próximo ciclo",
      priority: "Média" as const,
      expected: "Manter SLA acima de 92% mesmo com volume crescente",
    },
  ],
  sources: [
    "47 conversas",
    "12 auditorias de QA",
    "SLA do dia",
    "Sentimento por IA",
  ],
  stage: "rascunho" as const,
  currentVersion: "v1",
  versions: [
    {
      version: "v1",
      createdAt: fmtBRTime,
      author: "IA · sla_advisor",
      note: "Primeira síntese automática do ciclo.",
      stage: "rascunho" as const,
    },
  ],
  review: [
    { role: "Geração", name: "IA · Gemini 2.5 Pro", stage: "rascunho" as const, at: fmtBRTime },
    { role: "Revisão operacional", name: "Supervisor", stage: "revisao" as const },
    { role: "Aprovação executiva", name: "Administrador", stage: "aprovado" as const },
    { role: "Distribuição", name: "Diretoria · WhatsApp + e-mail", stage: "enviado" as const },
  ],
  themes: ["Comercial", "Processo"],
  kpis: {
    volume: 47,
    sla: 94.2,
    frt: 102,
    qa: 8.7,
    satisfied: 72,
  },
  feedbackSummary: { up: 0, down: 0, comments: 0 },
};

async function seed() {
  const tenantId = "valem";
  const reportId = mockReport.id;

  console.log(`[Seed] Inserindo relatório mock "${reportId}" para tenant "${tenantId}"...`);

  // Verifica se já existe para evitar duplicata
  const existing = await db.select().from(aiReports).where(
    and(
      eq(aiReports.id, reportId),
      eq(aiReports.tenantId, tenantId),
    )
  );

  if (existing.length > 0) {
    console.log(`[Seed] ⚠ Relatório "${reportId}" já existe. Atualizando...`);
    await db.update(aiReports)
      .set({
        reportData: mockReport as any,
        headline: mockReport.headline,
        summary: mockReport.summary,
        confidence: mockReport.confidence,
        stage: "rascunho",
        currentVersion: "v1",
      })
      .where(eq(aiReports.id, reportId));
  } else {
    await db.insert(aiReports).values({
      id: reportId,
      tenantId,
      type: "daily",
      period: dateIso,
      reportMarkdown: "## Mock Report\nEste é um relatório de teste.",
      reportData: mockReport as any,
      stage: "rascunho",
      currentVersion: "v1",
      headline: mockReport.headline,
      summary: mockReport.summary,
      confidence: mockReport.confidence,
      generatedAt: now,
    });

    // Cria versão v1
    await db.insert(aiReportVersions).values({
      id: `rev-mock-${Date.now()}`,
      reportId,
      tenantId,
      version: "v1",
      createdAt: fmtBRTime,
      author: "IA · sla_advisor",
      note: "Primeira síntese automática do ciclo.",
      stage: "rascunho",
      reportData: mockReport as any,
    });
  }

  console.log(`[Seed] ✅ Relatório mock inserido com sucesso!`);
  console.log(`[Seed] → Abra o painel > Estatísticas > aba "Relatórios IA" para visualizar.`);
  process.exit(0);
}

seed().catch((e) => {
  console.error("[Seed] ❌ Erro:", e);
  process.exit(1);
});
