/**
 * seed-mock-report.ts — Insere relatórios mock v2 (diários e semanais) para valem e tecfag
 *
 * Executar com: npx tsx --env-file=.env src/scripts/seed-mock-report.ts
 */

import { db } from "../db";
import { aiReports, aiReportVersions } from "../db/schema";
import { and, eq } from "drizzle-orm";

const pad = (n: number) => String(n).padStart(2, "0");
const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

function buildReport(kind: "Diário" | "Semanal", dateOffsetDays: number, tenant: string) {
  const d = new Date();
  d.setDate(d.getDate() - dateOffsetDays);

  const dateIso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtBR = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const fmtBRTime = `${fmtBR}, 18:00`;
  const periodLabel = kind === "Diário"
    ? `${pad(d.getDate())} de ${MONTH_NAMES[d.getMonth()]} de ${d.getFullYear()}`
    : `Semana ${pad(d.getDate())} a ${pad(d.getDate() + 6)} de ${MONTH_NAMES[d.getMonth()]} de ${d.getFullYear()}`;

  const reportId = kind === "Diário" ? `d-${dateIso}` : `2026-W32-${tenant}`;
  const code = kind === "Diário" ? dateIso : `2026-W32`;

  const isValem = tenant === "valem";
  const companyName = isValem ? "Valem Válvulas e Embalagens" : "Tecfag Informática";
  const personaName = isValem ? "Valentina (SDR)" : "Fagner (Suporte Técnico)";

  const volume = isValem ? 47 - dateOffsetDays * 3 : 32 - dateOffsetDays * 2;
  const sla = Number((94.2 - dateOffsetDays * 0.8).toFixed(1));
  const frtSeconds = 102 + dateOffsetDays * 15;
  const frtText = `${Math.floor(frtSeconds / 60)}m ${frtSeconds % 60}s`;
  const qa = Number((8.7 - dateOffsetDays * 0.2).toFixed(1));
  const satisfied = 72 - dateOffsetDays * 2;
  const neutral = 19 + dateOffsetDays;
  const frustrated = 100 - satisfied - neutral;

  return {
    id: reportId,
    kind,
    code,
    date: dateIso,
    period: periodLabel,
    generatedAt: fmtBR,
    syncedAt: fmtBRTime,
    confidence: 93 - dateOffsetDays,
    headline: kind === "Diário"
      ? `Operação ${companyName} estável com SLA de ${sla}% — volume ${18 - dateOffsetDays * 2}% acima da média`
      : `Balanço Semanal ${companyName}: SLA consolidado em ${sla}% com 240+ atendimentos`,
    summary: `A operação da ${companyName} registrou ${volume} conversas no período (${kind.toLowerCase()}). O SLA de resposta ficou em ${sla}%, superando a meta estabelecida de 92%. O tempo médio de primeira resposta pelo agente ${personaName} foi de ${frtText}. O índice de satisfação do cliente fechou em ${satisfied}% com nota média de QA de ${qa}/10.`,
    metrics: [
      {
        label: "Conversas atendidas",
        value: String(volume),
        delta: Number((18.3 - dateOffsetDays * 1.5).toFixed(1)),
        deltaLabel: kind === "Diário" ? "vs. dia anterior" : "vs. semana anterior",
        goodWhen: "up" as const,
      },
      {
        label: "1ª resposta (média)",
        value: frtText,
        delta: Number((-12.1 + dateOffsetDays * 2).toFixed(1)),
        deltaLabel: kind === "Diário" ? "vs. dia anterior" : "vs. semana anterior",
        goodWhen: "down" as const,
        target: "Meta 15m",
      },
      {
        label: "SLA cumprido",
        value: String(sla).replace(".", ","),
        unit: "%",
        delta: Number((2.4 - dateOffsetDays * 0.5).toFixed(1)),
        goodWhen: "up" as const,
        progress: sla,
        target: "Meta 92%",
      },
      {
        label: "Nota média de QA",
        value: String(qa).replace(".", ","),
        unit: "/10",
        delta: 1.2,
        goodWhen: "up" as const,
        progress: qa * 10,
      },
    ],
    sentiment: [
      { label: "Satisfeito", value: satisfied, signal: "positive" as const },
      { label: "Neutro", value: neutral, signal: "info" as const },
      { label: "Frustrado", value: frustrated, signal: "critical" as const },
    ],
    volumeSeries: kind === "Diário" ? [
      { label: "08h", value: Math.round(volume * 0.08) },
      { label: "10h", value: Math.round(volume * 0.20) },
      { label: "12h", value: Math.round(volume * 0.28) },
      { label: "14h", value: Math.round(volume * 0.22) },
      { label: "16h", value: Math.round(volume * 0.14) },
      { label: "18h", value: Math.round(volume * 0.08) },
    ] : [
      { label: "Seg", value: 45 },
      { label: "Ter", value: 52 },
      { label: "Qua", value: 48 },
      { label: "Qui", value: 50 },
      { label: "Sex", value: 41 },
      { label: "Sáb", value: 12 },
    ],
    highlights: [
      {
        title: "SLA acima da meta de 92%",
        detail: `A equipe manteve ${sla}% de conformidade, demonstrando alta eficiência no atendimento.`,
        signal: "positive" as const,
        tag: "Processo",
        impact: `+${(sla - 92).toFixed(1)}pp acima da meta`,
      },
      {
        title: "Redução no tempo de 1ª resposta",
        detail: `Tempo médio de primeira resposta fixado em ${frtText}, garantindo resposta rápida aos leads.`,
        signal: "positive" as const,
        tag: "Suporte",
        impact: "FRT 35% abaixo do limite SLA",
      },
    ],
    gaps: [
      {
        title: "Objeções comerciais necessitando atenção",
        detail: "Identificados leads qualificados que levantaram dúvidas sobre prazos de entrega não sanadas imediatamente.",
        signal: "warning" as const,
        tag: "Comercial",
        impact: "Risco de fricção na conversão",
      },
    ],
    actions: [
      {
        title: "Reforço no alinhamento de prazos",
        detail: "Orientações para a equipe responder prontamente sobre prazos de entrega no primeiro contato.",
        owner: "Supervisão Operacional",
        horizon: "Esta semana",
        priority: "Alta" as const,
        expected: "Manter SLA > 92% e conversão alta",
      },
    ],
    sources: [
      `${volume} conversas`,
      `${Math.round(volume * 0.3)} auditorias QA`,
      "SLA em tempo real",
      "Sentimento IA",
    ],
    stage: (dateOffsetDays === 0 ? "rascunho" : dateOffsetDays === 1 ? "revisao" : "aprovado") as const,
    currentVersion: "v1",
    versions: [
      {
        version: "v1",
        createdAt: fmtBRTime,
        author: "IA · sla_advisor",
        note: "Síntese automática de BI gerada pela IA.",
        stage: (dateOffsetDays === 0 ? "rascunho" : dateOffsetDays === 1 ? "revisao" : "aprovado") as const,
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
      volume,
      sla,
      frt: frtSeconds,
      qa,
      satisfied,
    },
    feedbackSummary: { up: 2, down: 0, comments: 1 },
  };
}

async function seed() {
  const tenants = ["valem", "tecfag"];

  for (const tenantId of tenants) {
    console.log(`\n[Seed] Processando tenant: ${tenantId.toUpperCase()}`);

    // Gera 4 diários e 1 semanal
    const reportsToInsert = [
      { kind: "Diário" as const, offset: 0 },
      { kind: "Diário" as const, offset: 1 },
      { kind: "Diário" as const, offset: 2 },
      { kind: "Diário" as const, offset: 3 },
      { kind: "Semanal" as const, offset: 0 },
    ];

    for (const item of reportsToInsert) {
      const rep = buildReport(item.kind, item.offset, tenantId);
      const reportId = `${rep.id}-${tenantId}`;
      rep.id = reportId;

      console.log(`[Seed] Inserindo/atualizando relatório "${reportId}" (${rep.kind}) ...`);

      const existing = await db
        .select()
        .from(aiReports)
        .where(and(eq(aiReports.id, reportId), eq(aiReports.tenantId, tenantId)));

      if (existing.length > 0) {
        await db
          .update(aiReports)
          .set({
            reportData: rep as any,
            headline: rep.headline,
            summary: rep.summary,
            confidence: rep.confidence,
            stage: rep.stage,
            currentVersion: rep.currentVersion,
          })
          .where(eq(aiReports.id, reportId));
      } else {
        await db.insert(aiReports).values({
          id: reportId,
          tenantId,
          type: item.kind === "Diário" ? "daily" : "weekly",
          period: rep.code,
          reportMarkdown: `## Relatório ${rep.kind}\n${rep.summary}`,
          reportData: rep as any,
          stage: rep.stage,
          currentVersion: rep.currentVersion,
          headline: rep.headline,
          summary: rep.summary,
          confidence: rep.confidence,
          generatedAt: new Date(Date.now() - item.offset * 86400000),
        });

        await db.insert(aiReportVersions).values({
          id: `rev-${reportId}-v1`,
          reportId,
          tenantId,
          version: "v1",
          createdAt: rep.syncedAt,
          author: "IA · sla_advisor",
          note: "Síntese automática gerada pela IA.",
          stage: rep.stage,
          reportData: rep as any,
        });
      }
    }
  }

  console.log("\n[Seed] ✅ Relatórios mock inseridos com sucesso para AMBOS os tenants (valem & tecfag)!");
  process.exit(0);
}

seed().catch((e) => {
  console.error("[Seed] ❌ Erro ao popular relatórios mock:", e);
  process.exit(1);
});
