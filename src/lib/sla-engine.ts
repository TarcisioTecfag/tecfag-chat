/**
 * SLA Engine — Motor de Monitoramento de Tempo de Resposta e Relatórios Automáticos
 *
 * Singleton que roda jobs em background:
 *  - Job 1 (a cada 60s): Varre ciclos SLA pendentes e marca como overdue
 *    quando o cliente aguarda mais do que o threshold configurado.
 *  - Job 2 (a cada 15min): Varre configurações de tenants e dispara relatórios
 *    analíticos executivos diários/semanais gerados por IA para WhatsApp e E-mail.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "../db";
import {
  responseTimeLogs,
  operatorDailyMetrics,
  operators,
  tenants,
  channelConfigs,
  conversations,
  aiConversationAudits,
  aiReports
} from "../db/schema";
import { eq, isNull, and, sql, gte, desc } from "drizzle-orm";

// Helper para obter a semana em formato YYYY-WNN
function getWeekString(d: Date) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export class SlaEngine {
  private static instance: SlaEngine;
  private overdueJobInterval: ReturnType<typeof setInterval> | null = null;
  private reportJobInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  private constructor() {}

  static getInstance(): SlaEngine {
    if (!SlaEngine.instance) {
      SlaEngine.instance = new SlaEngine();
    }
    return SlaEngine.instance;
  }

  /**
   * Inicia todos os jobs da engine. Idempotente — chamar várias vezes não duplica os jobs.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log("[SlaEngine] Iniciando jobs de monitoramento e relatórios...");

    // Job 1: Verificar overdue a cada 60 segundos
    this.overdueJobInterval = setInterval(() => {
      this.runOverdueCheck().catch((e) =>
        console.error("[SlaEngine] Erro no job de overdue:", e)
      );
    }, 60_000);

    // Job 2: Verificar e gerar relatórios executivos a cada 15 minutos
    this.reportJobInterval = setInterval(() => {
      this.runReportEngine().catch((e) =>
        console.error("[SlaEngine] Erro no job de relatórios:", e)
      );
    }, 15 * 60 * 1000);

    // Roda imediatamente na inicialização
    this.runOverdueCheck().catch((e) =>
      console.error("[SlaEngine] Erro na verificação inicial de overdue:", e)
    );

    this.runReportEngine().catch((e) =>
      console.error("[SlaEngine] Erro na geração inicial de relatórios:", e)
    );

    console.log("[SlaEngine] ✓ Jobs iniciados (overdue check: 60s, report engine: 15min)");
  }

  stop() {
    if (this.overdueJobInterval) {
      clearInterval(this.overdueJobInterval);
      this.overdueJobInterval = null;
    }
    if (this.reportJobInterval) {
      clearInterval(this.reportJobInterval);
      this.reportJobInterval = null;
    }
    this.isRunning = false;
    console.log("[SlaEngine] Jobs encerrados.");
  }

  /**
   * Varre todos os ciclos SLA ainda sem resposta.
   * Marca como overdue quando o tempo de espera excede o threshold.
   * Também atualiza o overdueCount nas métricas diárias do operador.
   */
  private async runOverdueCheck() {
    const now = new Date();

    // Busca ciclos pendentes que ainda não foram marcados como overdue
    // e cujo tempo de espera já excedeu o threshold
    const pendingLogs = await db
      .select()
      .from(responseTimeLogs)
      .where(
        and(
          isNull(responseTimeLogs.agentResponseId),    // Ainda sem resposta
          eq(responseTimeLogs.isOverdue, false),        // Ainda não marcado como overdue
          // Verifica: (now - clientMessageAt) > overdueThresholdSeconds
          sql`EXTRACT(EPOCH FROM (NOW() - ${responseTimeLogs.clientMessageAt})) > ${responseTimeLogs.overdueThresholdSeconds}`
        )
      );

    if (pendingLogs.length === 0) return;

    console.log(`[SlaEngine] ${pendingLogs.length} ciclo(s) SLA marcado(s) como overdue.`);

    for (const log of pendingLogs) {
      // Marca como overdue
      await db
        .update(responseTimeLogs)
        .set({
          isOverdue: true,
          overdueNotifiedAt: now,
        })
        .where(eq(responseTimeLogs.id, log.id));

      // Atualiza o overdueCount nas métricas diárias do operador (se houver um atribuído)
      if (log.operatorId) {
        const today = now.toISOString().split("T")[0];
        await this.incrementOperatorOverdue(log.tenantId, log.operatorId, today);
      }
    }
  }

  /**
   * Varre todos os tenants cadastrados e verifica a necessidade de emitir relatórios
   * com base nas configurações em channel_configs.
   */
  private async runReportEngine() {
    const activeTenants = await db.select().from(tenants);

    for (const t of activeTenants) {
      const config = await db.query.channelConfigs.findFirst({
        where: eq(channelConfigs.tenantId, t.id),
      });

      if (!config) continue;

      const now = new Date();
      // O processamento ocorre após as 18h
      const isPast6PM = now.getHours() >= 18;

      if (isPast6PM) {
        const todayStr = now.toISOString().split("T")[0]; // YYYY-MM-DD

        // 1. Relatório Diário
        if (config.reportDailyWhatsapp || config.reportDailyEmail) {
          const exists = await db.query.aiReports.findFirst({
            where: and(
              eq(aiReports.tenantId, t.id),
              eq(aiReports.type, "daily"),
              eq(aiReports.period, todayStr)
            ),
          });

          if (!exists) {
            console.log(`[SlaEngine] Iniciando geração de Relatório Diário para o tenant: ${t.id} (${todayStr})`);
            await this.generateAndSendReport(t.id, "daily", todayStr, config);
          }
        }

        // 2. Relatório Semanal (dispara na Sexta-feira após as 18h)
        const isFriday = now.getDay() === 5;
        if (isFriday && (config.reportWeeklyWhatsapp || config.reportWeeklyEmail)) {
          const weekStr = getWeekString(now);
          const exists = await db.query.aiReports.findFirst({
            where: and(
              eq(aiReports.tenantId, t.id),
              eq(aiReports.type, "weekly"),
              eq(aiReports.period, weekStr)
            ),
          });

          if (!exists) {
            console.log(`[SlaEngine] Iniciando geração de Relatório Semanal para o tenant: ${t.id} (${weekStr})`);
            await this.generateAndSendReport(t.id, "weekly", weekStr, config);
          }
        }
      }
    }
  }

  /**
   * Reúne dados consolidados do período, invoca a IA para gerar o relatório Markdown
   * e envia por e-mail (SMTP) e/ou WhatsApp (Baileys/Meta) para múltiplos destinatários.
   */
  private async generateAndSendReport(tenantId: string, type: "daily" | "weekly", period: string, config: any) {
    try {
      const now = new Date();
      // Define a janela histórica de busca de dados
      const startTime = type === "daily"
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
        : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 dias

      // ── Consulta e agregação de volumetria ──
      const convs = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            gte(conversations.createdAt, startTime)
          )
        );
      
      const totalChats = convs.length;
      const closedChats = convs.filter((c) => c.queueState === "finalizados").length;

      // ── Consulta e agregação de tempos e SLA ──
      const slaLogs = await db
        .select()
        .from(responseTimeLogs)
        .where(
          and(
            eq(responseTimeLogs.tenantId, tenantId),
            gte(responseTimeLogs.clientMessageAt, startTime)
          )
        );

      const totalSla = slaLogs.length;
      const overdueSla = slaLogs.filter((l) => l.isOverdue).length;
      const metSlaPct = totalSla > 0 ? Math.round(((totalSla - overdueSla) / totalSla) * 100) : 100;
      const validResponseTimes = slaLogs.map((l) => l.responseTimeSeconds).filter(Boolean) as number[];
      const avgResponseSeconds = validResponseTimes.length > 0
        ? Math.round(validResponseTimes.reduce((sum, val) => sum + val, 0) / validResponseTimes.length)
        : 0;

      // ── Consulta de auditorias e sentimentos ──
      const audits = await db
        .select()
        .from(aiConversationAudits)
        .where(
          and(
            eq(aiConversationAudits.tenantId, tenantId),
            gte(aiConversationAudits.auditedAt, startTime)
          )
        );

      const scores = audits.map((a) => a.performanceScore).filter(Boolean) as number[];
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((sum, val) => sum + val, 0) / scores.length) : 80;
      const satisfiedCount = audits.filter((a) => a.clientSentiment === "satisfeito").length;
      const neutralCount = audits.filter((a) => a.clientSentiment === "neutro").length;
      const frustratedCount = audits.filter((a) => a.clientSentiment === "frustrado").length;

      // ── Chamada da LLM (Gemini) para formatar o relatório executivo ──
      const apiKey = process.env.GEMINI_API_KEY || "";
      let markdownReport = "";

      if (apiKey) {
        try {
          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
          
          const prompt = `
            Você é a Inteligência Artificial encarregada de consolidar os relatórios analíticos de BI para a diretoria.
            Gere um relatório analítico e executivo ${type === "weekly" ? "semanal" : "diário"} completo formatado em Markdown com base nas seguintes estatísticas reais da nossa plataforma de atendimento (Tenant: ${tenantId}, Período: ${period}):

            Estatísticas do Período:
            - Total de conversas iniciadas: ${totalChats}
            - Conversas finalizadas com sucesso: ${closedChats}
            - Total de interações monitoradas pelo motor de SLA: ${totalSla}
            - Porcentagem de conformidade de SLA (Respostas em menos de 15 minutos): ${metSlaPct}%
            - Tempo médio de primeira resposta da equipe: ${avgResponseSeconds} segundos
            - Score médio de qualidade estimado pela I.A: ${avgScore}/100
            - Humor final dos clientes: ${satisfiedCount} Satisfeito(s), ${neutralCount} Neutro(s), ${frustratedCount} Frustrado(s).
            - Alertas de não-conformidade levantados pela I.A.:
              * Respostas com demora crítica: ${audits.filter(a => a.hadLongResponseGap).length}
              * Objeções comerciais ignoradas: ${audits.filter(a => a.hadMissedObjection).length}
              * Tom de linguagem inadequada: ${audits.filter(a => a.hadRudeLanguage).length}
              * Atendimentos fechados sem agendar próximo passo: ${audits.filter(a => a.hadNoFollowUp).length}

            Formate o relatório em seções claras e estruturadas usando Markdown padrão:
            ## Relatório Analítico Executivo (${type === "weekly" ? "Semanal" : "Diário"})
            
            ### 1. Visão Geral da Operação
            (Apresente um resumo dos números agregados com análise profissional)

            ### 2. Destaques Positivos (Pontos Fortes)
            (Aponte onde a equipe se sobressaiu com base nos dados qualitativos e conformidade)

            ### 3. Oportunidades de Melhoria (Falhas e Gargalos)
            (Detone os maiores erros e áreas de fricção observadas pelo motor de IA no período)

            ### 4. Plano de Ação & Recomendações Críticas da IA
            (Apresente recomendações práticas para a gerência aplicar na equipe de vendas/suporte.
            Obrigatório iniciar a recomendação principal usando caixas de destaque do github, por exemplo:
            > [!NOTE]
            > Recomendação prioritária do dia...)
          `;

          const result = await model.generateContent(prompt);
          markdownReport = result.response.text();
        } catch (e: any) {
          console.error("[SlaEngine] Erro ao chamar LLM para relatório:", e.message);
        }
      }

      if (!markdownReport) {
        // Fallback básico na ausência da LLM ou erro
        markdownReport = `## Relatório Executivo de BI (${type === "weekly" ? "Semanal" : "Diário"})
Período: ${period}

### 1. Resumo Quantitativo
* **Volume de Chats:** ${totalChats} conversas registradas.
* **Conformidade de SLA:** ${metSlaPct}% das mensagens respondidas dentro do limite de 15min.
* **Tempo Médio de Resposta:** ${avgResponseSeconds}s de espera.
* **Score IA Médio:** ${avgScore}/100.

> [!NOTE]
> Relatório gerado com dados brutos em fallback. Ative a chave GEMINI_API_KEY para habilitar os insights automáticos da inteligência artificial.
`;
      }

      // ── Salvar o relatório na tabela aiReports ──
      const reportId = `rep-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      await db.insert(aiReports).values({
        id: reportId,
        tenantId,
        type,
        period,
        reportMarkdown: markdownReport,
        reportData: {
          totalChats,
          closedChats,
          metSlaPct,
          avgResponseSeconds,
          avgScore,
          satisfiedCount,
          frustratedCount
        },
        generatedAt: new Date(),
      });

      console.log(`[SlaEngine] ✓ Relatório salvo em ai_reports (${reportId})`);

      // ── Disparo por WhatsApp para Múltiplos Contatos ──
      const wantWhatsapp = (type === "daily" && config.reportDailyWhatsapp) || (type === "weekly" && config.reportWeeklyWhatsapp);
      if (wantWhatsapp && config.reportWhatsappNumbers) {
        const numbers = config.reportWhatsappNumbers.split(",").map((n: string) => n.trim()).filter(Boolean);
        const whatsappText = `📊 *VALEM CHAT — RELATÓRIO ${type === "weekly" ? "SEMANAL" : "DIÁRIO"} DE PERFORMANCE*\n\nPeríodo: ${period}\n\n*Resumo dos KPIs:*\n• Total de Conversas: ${totalChats}\n• SLA Cumprido: ${metSlaPct}%\n• Tempo Médio de Resposta: ${avgResponseSeconds}s\n• Score Geral da Equipe: ${avgScore}/100\n• Clientes Satisfeitos: ${satisfiedCount} | Frustrados: ${frustratedCount}\n\n_Acesse o painel administrativo para visualizar o relatório completo gerado por Inteligência Artificial._`;
        
        await this.sendReportViaWhatsapp(tenantId, numbers, whatsappText);
      }

      // ── Disparo por E-mail SMTP para Múltiplos Contatos ──
      const wantEmail = (type === "daily" && config.reportDailyEmail) || (type === "weekly" && config.reportWeeklyEmail);
      if (wantEmail && config.reportEmailAddresses && config.smtpHost && config.smtpPort) {
        const emails = config.reportEmailAddresses.split(",").map((e: string) => e.trim()).filter(Boolean);
        const subject = `Valem Chat — Relatório ${type === "weekly" ? "Semanal" : "Diário"} de Performance (${period})`;
        
        const html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff;">
            <h2 style="color: #6366f1; font-weight: 800; margin-bottom: 5px;">Valem Chat & BI</h2>
            <p style="color: #64748b; font-size: 13px; margin-top: 0;">Relatório de Performance Executiva (${type === "weekly" ? "Semanal" : "Diário"})</p>
            <p style="font-size: 14px;">Período: <strong>${period}</strong></p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <div style="font-size: 14px; line-height: 1.6; color: #1e293b;">
              ${markdownReport
                .replace(/\n/g, "<br/>")
                .replace(/### (.*)/g, "<h4 style='color: #4f46e5; margin: 15px 0 5px 0;'>$1</h4>")
                .replace(/## (.*)/g, "<h3 style='color: #6366f1; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin: 20px 0 10px 0;'>$1</h3>")
                .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
                .replace(/>\s*\[!NOTE\](.*)/gi, "<div style='background-color: #f8fafc; border-left: 4px solid #6366f1; padding: 12px; margin: 15px 0; border-radius: 6px; color: #334155;'><strong>Recomendação da IA:</strong>$1</div>")
              }
            </div>
            <div style="margin-top: 30px; font-size: 11px; text-align: center; color: #94a3b8; border-t: 1px solid #eee; padding-top: 15px;">
              Este é um e-mail automático disparado pelo motor analítico do Valem Chat.
            </div>
          </div>
        `;

        await this.sendReportViaEmail(emails, subject, html, config);
      }
    } catch (e: any) {
      console.error("[SlaEngine] Erro fatal no gerador de relatório:", e.message);
    }
  }

  /**
   * Envia o texto de WhatsApp para uma lista de telefones.
   */
  private async sendReportViaWhatsapp(tenantId: string, numbers: string[], text: string) {
    if (tenantId === "valem") {
      try {
        const { SessionManager, resolveRealJid } = await import("./baileys/session-manager");
        const sessionManager = SessionManager.getInstance();
        const sock = sessionManager.getSession(tenantId);

        if (sock && sessionManager.getStatus(tenantId) === "connected") {
          for (const num of numbers) {
            try {
              const jid = await resolveRealJid(sock, num);
              if (jid) {
                await sock.sendMessage(jid, { text });
                console.log(`[SlaEngine] WhatsApp de relatório enviado para o número ${num}`);
              }
            } catch (err: any) {
              console.error(`[SlaEngine] Erro ao enviar WhatsApp para ${num}:`, err.message);
            }
          }
        } else {
          console.warn("[SlaEngine] Sessão Baileys não ativa. Relatório WhatsApp pulado.");
        }
      } catch (err: any) {
        console.error("[SlaEngine] Erro ao carregar dependência do Baileys:", err.message);
      }
    } else {
      console.log(`[SlaEngine] [MOCK Meta API Send] WhatsApp de relatório para ${numbers.join(", ")}`);
    }
  }

  /**
   * Envia o corpo HTML de e-mail por SMTP.
   */
  private async sendReportViaEmail(emails: string[], subject: string, html: string, config: any) {
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: parseInt(config.smtpPort),
        secure: parseInt(config.smtpPort) === 465,
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass,
        },
      });

      const info = await transporter.sendMail({
        from: config.smtpFrom || config.smtpUser,
        to: emails.join(", "),
        subject,
        html,
      });

      console.log(`[SlaEngine] E-mail de relatório enviado: ${info.messageId}`);
    } catch (err: any) {
      console.error("[SlaEngine] Erro ao enviar SMTP real:", err.message);
    }
  }

  /**
   * Incrementa o contador de overdue do operador nas métricas do dia.
   * Cria o registro se ainda não existir.
   */
  private async incrementOperatorOverdue(tenantId: string, operatorId: string, date: string) {
    const existing = await db
      .select()
      .from(operatorDailyMetrics)
      .where(
        and(
          eq(operatorDailyMetrics.tenantId, tenantId),
          eq(operatorDailyMetrics.operatorId, operatorId),
          eq(operatorDailyMetrics.date, date)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(operatorDailyMetrics)
        .set({
          overdueCount: (existing[0].overdueCount ?? 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(operatorDailyMetrics.id, existing[0].id));
    } else {
      // Busca o nome do operador para desnormalizar
      const op = await db
        .select({ name: operators.name })
        .from(operators)
        .where(eq(operators.id, operatorId))
        .limit(1);

      await db.insert(operatorDailyMetrics).values({
        id: `odm-${tenantId}-${operatorId}-${date}`,
        tenantId,
        operatorId,
        operatorName: op[0]?.name ?? "Desconhecido",
        date,
        overdueCount: 1,
        totalConversations: 0,
        updatedAt: new Date(),
      });
    }
  }

  /**
   * Atualiza as métricas de tempo de resposta de um operador após cada resposta dada.
   * Chamado externamente após fechar um ciclo SLA.
   */
  async updateResponseMetrics(tenantId: string, operatorId: string, responseTimeSeconds: number) {
    const today = new Date().toISOString().split("T")[0];

    const existing = await db
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

    if (existing.length > 0) {
      const m = existing[0];
      const prevAvg = m.avgResponseTimeSeconds ?? 0;
      const prevMax = m.maxResponseTimeSeconds ?? 0;
      const prevTotal = m.totalConversations ?? 0;

      // Média acumulada incremental: newAvg = (prevAvg * n + newValue) / (n + 1)
      const newAvg = Math.floor((prevAvg * prevTotal + responseTimeSeconds) / (prevTotal + 1));
      const newMax = Math.max(prevMax, responseTimeSeconds);

      await db
        .update(operatorDailyMetrics)
        .set({
          avgResponseTimeSeconds: newAvg,
          maxResponseTimeSeconds: newMax,
          totalConversations: prevTotal + 1,
          updatedAt: new Date(),
        })
        .where(eq(operatorDailyMetrics.id, existing[0].id));
    } else {
      const op = await db
        .select({ name: operators.name })
        .from(operators)
        .where(eq(operators.id, operatorId))
        .limit(1);

      await db.insert(operatorDailyMetrics).values({
        id: `odm-${tenantId}-${operatorId}-${today}`,
        tenantId,
        operatorId,
        operatorName: op[0]?.name ?? "Desconhecido",
        date: today,
        totalConversations: 1,
        avgResponseTimeSeconds: responseTimeSeconds,
        maxResponseTimeSeconds: responseTimeSeconds,
        overdueCount: 0,
        updatedAt: new Date(),
      });
    }
  }
}
