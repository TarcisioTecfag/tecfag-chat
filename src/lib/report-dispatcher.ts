/**
 * report-dispatcher.ts — Serviço de dispatch de relatórios (WhatsApp + E-mail)
 *
 * Extraído do SlaEngine para ser reutilizável em:
 *  - Disparo automático pelo cron (SlaEngine)
 *  - Disparo manual pelo operador ao clicar "Enviar à diretoria" (report-workflow)
 *
 * REGRA: tenantId é sempre obrigatório. Nunca hardcode.
 */

import { db } from "../db";
import { channelConfigs, aiReports, aiReportVersions } from "../db/schema";
import { eq, and } from "drizzle-orm";
import type { StoredReport } from "./report-builder";

export type DispatchResult = {
  whatsappSent: string[];  // números enviados com sucesso
  emailSent: string[];     // e-mails enviados com sucesso
  errors: string[];        // erros ocorridos
  skipped: string[];       // motivos de pulo (ex: sessão inativa)
};

export class ReportDispatcher {
  /**
   * Busca a config do tenant e dispara o relatório por todos os canais configurados.
   * Se approval gate estiver ativo, NÃO deve ser chamado pelo cron — apenas pelo operador.
   */
  static async dispatch(
    tenantId: string,
    storedReport: StoredReport,
    markdownReport: string,
  ): Promise<DispatchResult> {
    const result: DispatchResult = {
      whatsappSent: [],
      emailSent: [],
      errors: [],
      skipped: [],
    };

    const config = await db.query.channelConfigs.findFirst({
      where: eq(channelConfigs.tenantId, tenantId),
    });

    if (!config) {
      result.errors.push("channel_configs não encontrado para o tenant");
      return result;
    }

    const type = storedReport.kind === "Semanal" ? "weekly" : "daily";

    // ── WhatsApp ─────────────────────────────────────────────────────────────
    const wantWhatsapp =
      (type === "daily" && config.reportDailyWhatsapp) ||
      (type === "weekly" && config.reportWeeklyWhatsapp);

    if (wantWhatsapp && config.reportWhatsappNumbers) {
      const numbers = config.reportWhatsappNumbers
        .split(",")
        .map((n: string) => n.trim())
        .filter(Boolean);

      const whatsappText = ReportDispatcher.buildWhatsAppText(storedReport, type);

      for (const num of numbers) {
        try {
          await ReportDispatcher.sendWhatsApp(tenantId, num, whatsappText);
          result.whatsappSent.push(num);
        } catch (err: any) {
          result.errors.push(`WhatsApp ${num}: ${err.message}`);
        }
      }
    } else if (!wantWhatsapp) {
      result.skipped.push("WhatsApp desativado nas configurações");
    } else if (!config.reportWhatsappNumbers) {
      result.skipped.push("Nenhum número de WhatsApp configurado");
    }

    // ── E-mail ────────────────────────────────────────────────────────────────
    const wantEmail =
      (type === "daily" && config.reportDailyEmail) ||
      (type === "weekly" && config.reportWeeklyEmail);

    if (wantEmail && config.reportEmailAddresses && config.smtpHost && config.smtpPort) {
      const emails = config.reportEmailAddresses
        .split(",")
        .map((e: string) => e.trim())
        .filter(Boolean);

      const subject = `Valem Chat — Relatório ${type === "weekly" ? "Semanal" : "Diário"} de Performance (${storedReport.code})`;
      const html = ReportDispatcher.buildEmailHtml(markdownReport, storedReport, type);

      try {
        await ReportDispatcher.sendEmail(emails, subject, html, config);
        result.emailSent.push(...emails);
      } catch (err: any) {
        result.errors.push(`E-mail SMTP: ${err.message}`);
      }
    } else if (!wantEmail) {
      result.skipped.push("E-mail desativado nas configurações");
    } else if (!config.smtpHost || !config.smtpPort) {
      result.skipped.push("SMTP não configurado");
    } else if (!config.reportEmailAddresses) {
      result.skipped.push("Nenhum e-mail de destino configurado");
    }

    return result;
  }

  /**
   * Marca o relatório como "enviado" no banco e registra a versão de dispatch.
   */
  static async markAsEnviado(reportId: string, tenantId: string, operatorId = "system") {
    const pad = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const nowStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}, ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    await db
      .update(aiReports)
      .set({ stage: "enviado" })
      .where(and(eq(aiReports.id, reportId), eq(aiReports.tenantId, tenantId)));

    await db.insert(aiReportVersions).values({
      id: `rev-dispatch-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      reportId,
      tenantId,
      version: "dispatch",
      createdAt: nowStr,
      author: operatorId === "system" ? "Sistema (cron)" : operatorId,
      note: "Relatório enviado à diretoria via WhatsApp e/ou E-mail.",
      stage: "enviado",
      reportData: null,
    });
  }

  // ── Helpers privados ───────────────────────────────────────────────────────

  private static buildWhatsAppText(report: StoredReport, type: string): string {
    return (
      `📊 *VALEM CHAT — RELATÓRIO ${type === "weekly" ? "SEMANAL" : "DIÁRIO"} DE PERFORMANCE*\n\n` +
      `Período: ${report.period}\n\n` +
      `*${report.headline}*\n\n` +
      `*Resumo dos KPIs:*\n` +
      `• Total de Conversas: ${report.kpis.volume}\n` +
      `• SLA Cumprido: ${report.kpis.sla}%\n` +
      `• Tempo Médio de Resposta: ${report.kpis.frt}s\n` +
      `• Score Geral da Equipe: ${report.kpis.qa}/10\n` +
      `• Clientes Satisfeitos: ${report.kpis.satisfied}%\n\n` +
      `_Acesse o painel administrativo para visualizar o relatório completo gerado por Inteligência Artificial._`
    );
  }

  private static buildEmailHtml(markdown: string, report: StoredReport, type: string): string {
    return `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff;">
        <h2 style="color: #6366f1; font-weight: 800; margin-bottom: 5px;">Valem Chat &amp; BI</h2>
        <p style="color: #64748b; font-size: 13px; margin-top: 0;">Relatório de Performance Executiva (${type === "weekly" ? "Semanal" : "Diário"})</p>
        <p style="font-size: 14px;">Período: <strong>${report.period}</strong></p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <div style="font-size: 14px; line-height: 1.6; color: #1e293b;">
          ${markdown
            .replace(/\n/g, "<br/>")
            .replace(/### (.*)/g, "<h4 style='color: #4f46e5; margin: 15px 0 5px 0;'>$1</h4>")
            .replace(/## (.*)/g, "<h3 style='color: #6366f1; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin: 20px 0 10px 0;'>$1</h3>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/>\s*\[!NOTE\](.*)/gi, "<div style='background-color: #f8fafc; border-left: 4px solid #6366f1; padding: 12px; margin: 15px 0; border-radius: 6px; color: #334155;'><strong>Recomendação da IA:</strong>$1</div>")
          }
        </div>
        <div style="margin-top: 30px; font-size: 11px; text-align: center; color: #94a3b8; border-top: 1px solid #eee; padding-top: 15px;">
          Este é um e-mail automático disparado pelo motor analítico do Valem Chat.
        </div>
      </div>
    `;
  }

  private static async sendWhatsApp(tenantId: string, num: string, text: string): Promise<void> {
    if (tenantId === "valem") {
      const { SessionManager, resolveRealJid } = await import("./baileys/session-manager");
      const sessionManager = SessionManager.getInstance();
      const sock = sessionManager.getSession(tenantId);

      if (sock && sessionManager.getStatus(tenantId) === "connected") {
        const jid = await resolveRealJid(sock, num);
        if (jid) {
          await sock.sendMessage(jid, { text });
          console.log(`[ReportDispatcher] ✓ WhatsApp enviado para ${num}`);
        } else {
          throw new Error(`JID não resolvido para ${num}`);
        }
      } else {
        throw new Error("Sessão Baileys não conectada");
      }
    } else {
      // Tecfag — Meta API (mock enquanto inativo)
      console.log(`[ReportDispatcher] [MOCK Meta API] WhatsApp para ${num} (tecfag inativo)`);
    }
  }

  private static async sendEmail(
    emails: string[],
    subject: string,
    html: string,
    config: any,
  ): Promise<void> {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: parseInt(config.smtpPort),
      secure: parseInt(config.smtpPort) === 465,
      auth: { user: config.smtpUser, pass: config.smtpPass },
    });

    const info = await transporter.sendMail({
      from: config.smtpFrom || config.smtpUser,
      to: emails.join(", "),
      subject,
      html,
    });

    console.log(`[ReportDispatcher] ✓ E-mail enviado: ${info.messageId}`);
  }
}
