import { runtimeSingleton } from "./runtime-singleton";
/**
 * Audit Service — Pipeline de Auditoria Executiva de Atendimentos por IA
 *
 * Singleton que processa auditorias de atendimentos comerciais via Vertex AI (Gemini),
 * cruzando transcrição completa (incluindo transcrições de áudio), métricas de SLA e
 * contexto da negociação no CRM.
 */

import { db } from "../db";
import crypto from "node:crypto";
import {
  aiConversationAudits,
  messages,
  conversations,
  contacts,
  operators,
  responseTimeLogs,
  operatorDailyMetrics,
  tenants,
} from "../db/schema";
import { eq, and, isNotNull, sql, or, isNull, lte } from "drizzle-orm";
import { isSdrTenant } from "./ai-persona";
import { getAuditPlaybook, AUDIT_JSON_SCHEMA } from "./audit-playbook";
import { getBrtDateKey } from "./operator-presence";

export type AuditPillarScores = {
  agility: number;
  qualification: number;
  objectionHandling: number;
  closingNextStep: number;
};

export type AuditResult = {
  performanceScore: number;
  clientSentiment: "satisfeito" | "neutro" | "frustrado";
  hadLongResponseGap: boolean;
  hadMissedObjection: boolean;
  hadRudeLanguage: boolean;
  hadNoFollowUp: boolean;
  pillarScores?: AuditPillarScores;
  detectedStage?: string;
  commercialRiskLevel?: "baixo" | "medio" | "alto" | "critico";
  summary: string;
  strengths: string;
  weaknesses: string;
  actionableInsight: string;
  coachingMessageSuggestion?: string;
};

function extractRows<T = any>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as any).rows)) {
    return (result as any).rows as T[];
  }
  return [];
}

function clampScore(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function computeFallbackPillarScores(params: {
  performanceScore: number | null;
  hadLongResponseGap: boolean;
  hadMissedObjection: boolean;
  hadRudeLanguage: boolean;
  hadNoFollowUp: boolean;
  rawAiResponse?: any;
}): AuditPillarScores {
  const base = clampScore(params.performanceScore, 75);
  const rawPillars = params.rawAiResponse?.pillarScores;

  const defaultAgility = params.hadLongResponseGap ? Math.max(25, base - 22) : Math.min(100, base + 6);
  const defaultQual = params.hadRudeLanguage ? Math.max(30, base - 18) : base;
  const defaultObj = params.hadMissedObjection ? Math.max(25, base - 24) : Math.min(100, base + 4);
  const defaultClosing = params.hadNoFollowUp ? Math.max(25, base - 22) : Math.min(100, base + 5);

  return {
    agility: clampScore(rawPillars?.agility, defaultAgility),
    qualification: clampScore(rawPillars?.qualification, defaultQual),
    objectionHandling: clampScore(rawPillars?.objectionHandling, defaultObj),
    closingNextStep: clampScore(rawPillars?.closingNextStep, defaultClosing),
  };
}

export class AuditService {
  private static instance: AuditService;
  private jobInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private isProcessing = false;
  private pendingImmediateRun = false;
  private initialAutoScanDoneByTenant = new Set<string>();

  private constructor() {
    console.log("[AuditService] Inicializado. Usará Vertex AI para auditorias multi-tenant.");
  }

  static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = runtimeSingleton("AuditService", () => new AuditService());
    }
    return AuditService.instance;
  }

  /** Inicia o job de auditoria. Idempotente. */
  start() {
    if (this.isRunning) {
      this.triggerImmediateRun();
      return;
    }
    this.isRunning = true;

    console.log("[AuditService] Iniciando job de auditoria (intervalo: 3min)...");

    // Libera eventuais auditorias que ficaram em 'processing' de um container anterior
    void db
      .update(aiConversationAudits)
      .set({
        status: "pending",
        leaseToken: null,
        leaseUntil: null,
      })
      .where(eq(aiConversationAudits.status, "processing"))
      .then(() => {
        this.triggerImmediateRun();
      })
      .catch(() => {
        this.triggerImmediateRun();
      });

    this.jobInterval = setInterval(
      () => {
        this.runAuditBatch().catch((e) =>
          console.error("[AuditService] Erro no batch periódico:", e),
        );
      },
      3 * 60 * 1000,
    );

    console.log("[AuditService] ✓ Job iniciado.");
  }

  stop() {
    if (this.jobInterval) clearInterval(this.jobInterval);
    this.isRunning = false;
  }

  /** Dispara um ciclo de processamento imediatamente em background sem bloquear a requisição. */
  triggerImmediateRun() {
    if (this.isProcessing) {
      this.pendingImmediateRun = true;
      return;
    }
    void this.runAuditBatch().catch((e) =>
      console.error("[AuditService] Erro no batch imediato:", e),
    );
  }

  /**
   * Auto-descoberta inicial por tenant: se o tenant ainda não possui nenhuma auditoria
   * registrada, varre automaticamente os atendimentos recentes elegíveis para popular
   * o painel da Diretoria sem exigir clique manual em "Finalizar".
   */
  async ensureInitialTenantScan(tenantId: string) {
    if (!isSdrTenant(tenantId)) return;
    if (this.initialAutoScanDoneByTenant.has(tenantId)) return;
    this.initialAutoScanDoneByTenant.add(tenantId);

    try {
      const existingCountRes = await db.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM ai_conversation_audits
        WHERE tenant_id = ${tenantId}
      `);
      const cnt = Number(extractRows<{ cnt: number }>(existingCountRes)[0]?.cnt ?? 0);
      if (cnt === 0) {
        await this.scanAndEnqueueEligibleConversations(tenantId, { limit: 12 });
      }
    } catch (e: any) {
      console.warn(`[AuditService] Falha no ensureInitialTenantScan(${tenantId}):`, e?.message);
    }
  }

  /**
   * Processa até 5 auditorias pendentes por ciclo por tenant.
   */
  private async runAuditBatch() {
    if (this.isProcessing) {
      this.pendingImmediateRun = true;
      return;
    }
    this.isProcessing = true;

    try {
      const companies = await db.select({ id: tenants.id }).from(tenants);
      for (const { id: tenantId } of companies.filter((company) => isSdrTenant(company.id))) {
        const eligible = or(
          eq(aiConversationAudits.status, "pending"),
          and(
            eq(aiConversationAudits.status, "processing"),
            or(
              isNull(aiConversationAudits.leaseUntil),
              lte(aiConversationAudits.leaseUntil, new Date()),
            ),
          ),
        );
        const pending = await db
          .select()
          .from(aiConversationAudits)
          .where(and(eq(aiConversationAudits.tenantId, tenantId), eligible))
          .orderBy(aiConversationAudits.createdAt)
          .limit(6);

        if (pending.length === 0) {
          continue;
        }

        if (pending.length >= 6) {
          // Há mais itens na fila: agenda próximo lote contínuo ao término deste
          this.pendingImmediateRun = true;
        }

        console.log(`[AuditService] Processando ${pending.length} auditoria(s) no tenant ${tenantId}...`);

        const claimedAudits: Array<{
          audit: (typeof pending)[number];
          token: string;
        }> = [];

        for (const audit of pending) {
          const token = crypto.randomUUID();
          const [claimed] = await db
            .update(aiConversationAudits)
            .set({
              status: "processing",
              leaseToken: token,
              leaseUntil: new Date(Date.now() + 2 * 60_000),
            })
            .where(
              and(
                eq(aiConversationAudits.tenantId, tenantId),
                eq(aiConversationAudits.id, audit.id),
                eligible,
              ),
            )
            .returning({ id: aiConversationAudits.id });
          if (!claimed) continue;
          claimedAudits.push({ audit, token });
        }

        // Processa em sub-lotes paralelos de até 3 auditorias simultâneas
        const CONCURRENCY = 3;
        for (let i = 0; i < claimedAudits.length; i += CONCURRENCY) {
          const chunk = claimedAudits.slice(i, i + CONCURRENCY);
          await Promise.all(
            chunk.map(({ audit, token }) =>
              this.processAudit(
                audit.id,
                audit.conversationId,
                audit.tenantId,
                audit.operatorId,
                audit.contactName,
                token,
              ),
            ),
          );
        }
      }
    } finally {
      this.isProcessing = false;
      if (this.pendingImmediateRun) {
        this.pendingImmediateRun = false;
        setTimeout(() => this.triggerImmediateRun(), 250);
      }
    }
  }

  /**
   * Hidrata nome do contato e operador real da conversa quando ausentes.
   */
  private async resolveConversationMetadata(
    tenantId: string,
    conversationId: string,
    currentOperatorId: string | null,
    currentContactName: string | null,
  ): Promise<{ operatorId: string | null; contactName: string | null; contactId: string | null }> {
    let operatorId = currentOperatorId;
    let contactName =
      currentContactName && currentContactName.trim() !== "" && currentContactName !== "Desconhecido"
        ? currentContactName.trim()
        : null;
    let contactId: string | null = null;

    try {
      const metaRes = await db.execute(sql`
        SELECT
          c.operator_id AS conv_operator_id,
          c.contact_id AS contact_id,
          ct.name AS contact_name,
          ct.wallet_operator_id AS wallet_operator_id
        FROM conversations c
        LEFT JOIN contacts ct
          ON ct.id = c.contact_id AND ct.tenant_id = c.tenant_id
        WHERE c.id = ${conversationId}
          AND c.tenant_id = ${tenantId}
        LIMIT 1
      `);
      const row = extractRows<{
        conv_operator_id: string | null;
        contact_id: string | null;
        contact_name: string | null;
        wallet_operator_id: string | null;
      }>(metaRes)[0];

      if (row) {
        contactId = row.contact_id ?? null;
        if (!contactName && row.contact_name) {
          contactName = row.contact_name;
        }
        if (!operatorId) {
          operatorId = row.conv_operator_id || row.wallet_operator_id || null;
        }
      }

      if (!operatorId) {
        // Fallback: descobre o operador que mais enviou mensagens na conversa
        const opFromMsgRes = await db.execute(sql`
          SELECT o.id AS operator_id
          FROM messages m
          JOIN operators o
            ON o.tenant_id = m.tenant_id
           AND LOWER(TRIM(o.name)) = LOWER(TRIM(m.sender_name))
          WHERE m.tenant_id = ${tenantId}
            AND m.conversation_id = ${conversationId}
            AND m.sender_type = 'agent'
            AND m.is_internal_note = false
          GROUP BY o.id
          ORDER BY COUNT(*) DESC
          LIMIT 1
        `);
        const msgOp = extractRows<{ operator_id: string }>(opFromMsgRes)[0];
        if (msgOp?.operator_id) {
          operatorId = msgOp.operator_id;
        }
      }
    } catch (e: any) {
      console.warn("[AuditService] Erro ao resolver metadata da conversa:", e?.message);
    }

    return { operatorId, contactName, contactId };
  }

  /**
   * Coleta contexto de CRM (Negociação, Empresa, Valor, Funil, Etapa, Status) para enriquecer o prompt da IA.
   */
  private async buildCrmContextForPrompt(
    tenantId: string,
    conversationId: string,
    contactId: string | null,
  ): Promise<string> {
    try {
      const contactClause = contactId
        ? sql`OR EXISTS (
            SELECT 1 FROM crm_deal_contacts dc
            WHERE dc.tenant_id = d.tenant_id
              AND dc.deal_id = d.id
              AND dc.contact_id = ${contactId}
          )`
        : sql``;

      const dealRes = await db.execute(sql`
        SELECT
          d.title,
          d.value,
          d.status,
          d.loss_reason,
          p.name AS pipeline_name,
          s.name AS stage_name,
          acc.name AS account_name
        FROM crm_deals d
        LEFT JOIN crm_pipelines p
          ON p.id = d.pipeline_id AND p.tenant_id = d.tenant_id
        LEFT JOIN crm_stages s
          ON s.id = d.stage_id AND s.tenant_id = d.tenant_id
        LEFT JOIN crm_accounts acc
          ON acc.id = d.account_id AND acc.tenant_id = d.tenant_id
        WHERE d.tenant_id = ${tenantId}
          AND (
            EXISTS (
              SELECT 1 FROM conversation_deal_contexts cdc
              WHERE cdc.tenant_id = d.tenant_id
                AND cdc.conversation_id = ${conversationId}
                AND cdc.current_deal_id = d.id
            )
            OR EXISTS (
              SELECT 1 FROM crm_conversation_deals ccd
              WHERE ccd.tenant_id = d.tenant_id
                AND ccd.conversation_id = ${conversationId}
                AND ccd.deal_id = d.id
                AND ccd.is_active = true
            )
            ${contactClause}
          )
        ORDER BY
          CASE d.status WHEN 'open' THEN 0 WHEN 'won' THEN 1 WHEN 'lost' THEN 2 ELSE 3 END,
          d.updated_at DESC
        LIMIT 2
      `);

      const rows = extractRows<{
        title: string;
        value: string | number | null;
        status: string;
        loss_reason: string | null;
        pipeline_name: string | null;
        stage_name: string | null;
        account_name: string | null;
      }>(dealRes);

      if (rows.length === 0) {
        return "Nenhuma negociação ativa vinculada no CRM para este atendimento.";
      }

      return rows
        .map((d, idx) => {
          const amountNum = Number(d.value ?? 0);
          const amountFmt =
            amountNum > 0
              ? amountNum.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
              : "Valor ainda não preenchido";
          const statusPt =
            d.status === "won"
              ? "VENDA GANHA"
              : d.status === "lost"
              ? `NEGOCIAÇÃO PERDIDA${d.loss_reason ? ` (Motivo: ${d.loss_reason})` : ""}`
              : d.status === "paused"
              ? "PAUSADA"
              : "EM ANDAMENTO";
          return (
            `Negociação ${idx + 1}: "${d.title}" | Empresa: ${d.account_name || "Não informada"} | ` +
            `Valor: ${amountFmt} | Funil: ${d.pipeline_name || "Padrão"} > Etapa: ${d.stage_name || "Inicial"} | Status CRM: ${statusPt}`
          );
        })
        .join("\n");
    } catch {
      return "Contexto de CRM indisponível.";
    }
  }

  /**
   * Coleta as regras aprendidas e correções registradas pela Diretoria no tenant
   * para calibrar continuamente as próximas avaliações da Vertex AI.
   */
  private async buildLearnedCalibrationContext(tenantId: string): Promise<string> {
    try {
      const rulesRes = await db.execute(sql`
        SELECT
          contact_name,
          performance_score,
          raw_ai_response->'directorReview'->>'verdict' AS verdict,
          raw_ai_response->'directorReview'->>'comment' AS comment,
          raw_ai_response->'directorReview'->>'learnedRule' AS learned_rule,
          (raw_ai_response->'directorReview'->>'originalAiScore')::int AS original_score,
          (raw_ai_response->'directorReview'->>'adjustedScore')::int AS adjusted_score,
          raw_ai_response->'directorReview'->>'reviewedByOperatorName' AS reviewer_name
        FROM ai_conversation_audits
        WHERE tenant_id = ${tenantId}
          AND status != 'dismissed_test'
          AND raw_ai_response->'directorReview' IS NOT NULL
          AND raw_ai_response->'directorReview'->>'verdict' IN ('rejected_wrong', 'approved_with_caveats')
          AND COALESCE(TRIM(raw_ai_response->'directorReview'->>'comment'), '') <> ''
        ORDER BY COALESCE(
          (raw_ai_response->'directorReview'->>'reviewedAt')::timestamptz,
          audited_at,
          created_at
        ) DESC
        LIMIT 15
      `);

      const rows = extractRows<{
        contact_name: string | null;
        performance_score: number | null;
        verdict: string;
        comment: string;
        learned_rule: string | null;
        original_score: number | null;
        adjusted_score: number | null;
        reviewer_name: string | null;
      }>(rulesRes);

      if (rows.length === 0) return "";

      const lines = rows.map((r, idx) => {
        const typeLabel =
          r.verdict === "rejected_wrong"
            ? "CORREÇÃO DE ERRO DA IA"
            : "RESSALVA DE CALIBRAÇÃO DA DIRETORIA";
        const scoreNote =
          r.original_score !== null &&
          r.adjusted_score !== null &&
          r.original_score !== r.adjusted_score
            ? ` (Nota corrigida pela Diretoria de ${r.original_score} para ${r.adjusted_score}/100)`
            : "";
        const ruleText = (r.learned_rule || r.comment || "").trim();
        return `${idx + 1}. [${typeLabel}${scoreNote} — Avaliador: ${r.reviewer_name || "Diretoria"}]: "${ruleText}"`;
      });

      return (
        `\n## MEMÓRIA DE APRENDIZADO & CALIBRAÇÃO DA DIRETORIA (REGRAS APRENDIDAS)\n` +
        `A Diretoria revisou auditorias anteriores e ensinou as seguintes diretrizes práticas de avaliação. ` +
        `Você DEVE absorver essas regras e nunca repetir os erros apontados abaixo:\n` +
        lines.join("\n") +
        `\n`
      );
    } catch (e: any) {
      console.warn("[AuditService] Aviso ao carregar regras aprendidas da Diretoria:", e?.message);
      return "";
    }
  }

  /**
   * Processa uma auditoria individual do início ao fim.
   */
  private async processAudit(
    auditId: string,
    conversationId: string,
    tenantId: string,
    initialOperatorId: string | null,
    initialContactName: string | null,
    leaseToken: string,
  ) {
    try {
      // Verifica se já existe revisão/calibração da Diretoria nesta auditoria (para preservá-la e usá-la na reavaliação)
      const existingAuditRows = await db
        .select({ rawAiResponse: aiConversationAudits.rawAiResponse })
        .from(aiConversationAudits)
        .where(
          and(
            eq(aiConversationAudits.id, auditId),
            eq(aiConversationAudits.tenantId, tenantId),
          ),
        )
        .limit(1);
      const existingDirectorReview = (existingAuditRows[0]?.rawAiResponse as any)?.directorReview ?? null;

      const resolved = await this.resolveConversationMetadata(
        tenantId,
        conversationId,
        initialOperatorId,
        initialContactName,
      );
      const operatorId = resolved.operatorId;
      const contactName = resolved.contactName;

      // 1. Coleta a transcrição completa
      const msgs = await db
        .select({
          senderType: messages.senderType,
          senderName: messages.senderName,
          content: messages.content,
          mediaInterpretation: messages.mediaInterpretation,
          sentAt: messages.sentAt,
          isInternalNote: messages.isInternalNote,
        })
        .from(messages)
        .where(and(eq(messages.tenantId, tenantId), eq(messages.conversationId, conversationId)))
        .orderBy(messages.sentAt);

      // Filtra apenas mensagens visíveis de cliente/operador (sem notas internas e sem eventos de sistema)
      const visibleMsgs = msgs.filter(
        (m) => !m.isInternalNote && m.senderType !== "system",
      );

      if (visibleMsgs.length < 3) {
        await db
          .update(aiConversationAudits)
          .set({
            operatorId,
            contactName,
            leaseToken: null,
            leaseUntil: null,
            status: "error",
            errorMessage: "Transcrição muito curta para auditoria (menos de 3 mensagens visíveis entre cliente e consultor).",
          })
          .where(
            and(
              eq(aiConversationAudits.id, auditId),
              eq(aiConversationAudits.tenantId, tenantId),
              eq(aiConversationAudits.leaseToken, leaseToken),
            ),
          );
        return;
      }

      // 2. Coleta métricas de SLA da conversa
      const slaLogs = await db
        .select({
          responseTimeSeconds: responseTimeLogs.responseTimeSeconds,
          isOverdue: responseTimeLogs.isOverdue,
        })
        .from(responseTimeLogs)
        .where(
          and(
            eq(responseTimeLogs.tenantId, tenantId),
            eq(responseTimeLogs.conversationId, conversationId),
            isNotNull(responseTimeLogs.responseTimeSeconds),
          ),
        );

      const validSlaLogs = slaLogs.filter((l) => (l.responseTimeSeconds ?? 0) > 0);
      const avgResponseSec =
        validSlaLogs.length > 0
          ? Math.floor(
              validSlaLogs.reduce((s, l) => s + (l.responseTimeSeconds ?? 0), 0) / validSlaLogs.length,
            )
          : null;
      const overdueCount = validSlaLogs.filter((l) => l.isOverdue || (l.responseTimeSeconds ?? 0) > 900).length;
      const maxResponseSec =
        validSlaLogs.length > 0 ? Math.max(...validSlaLogs.map((l) => l.responseTimeSeconds ?? 0)) : null;

      // 3. Monta a transcrição formatada (limitada às últimas 80 mensagens para preservar janela de contexto com precisão)
      const transcriptMsgs = visibleMsgs.slice(-80);
      const transcript = transcriptMsgs
        .map((m) => {
          const role = m.senderType === "client" ? "CLIENTE" : "CONSULTOR";
          const time = new Date(m.sentAt).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
          const rawContent = m.content || "";
          const formattedContent = m.mediaInterpretation
            ? rawContent.startsWith("[MEDIA:audio]") || rawContent.startsWith("[LOCAL_MEDIA:audio:")
              ? `[Áudio transcrito: "${m.mediaInterpretation}"]`
              : `${rawContent} [Transcrição/Interpretação de mídia: "${m.mediaInterpretation}"]`
            : rawContent;
          return `[${time}] ${role} (${m.senderName}): ${formattedContent}`;
        })
        .join("\n");

      // 4. Monta as métricas de SLA, Contexto CRM e Memória de Aprendizado da Diretoria
      const slaContext =
        avgResponseSec !== null
          ? `Tempo médio de resposta do consultor: ${Math.floor(avgResponseSec / 60)}min ${avgResponseSec % 60}s. ` +
            `Maior tempo de espera: ${maxResponseSec ? `${Math.floor(maxResponseSec / 60)}min ${maxResponseSec % 60}s` : "N/A"}. ` +
            `Respostas acima do SLA de 15min: ${overdueCount}.`
          : "Métricas de SLA baseadas nos horários das mensagens da transcrição.";

      const [crmContext, learnedCalibrationContext] = await Promise.all([
        this.buildCrmContextForPrompt(tenantId, conversationId, resolved.contactId),
        this.buildLearnedCalibrationContext(tenantId),
      ]);

      const specificDirectorInstruction =
        existingDirectorReview && existingDirectorReview.comment
          ? `\n## DIRETRIZ ESPECÍFICA DA DIRETORIA PARA ESTE ATENDIMENTO\n` +
            `O Diretor (${existingDirectorReview.reviewedByOperatorName || "Diretoria"}) revisou a avaliação anterior deste atendimento ` +
            `(${existingDirectorReview.verdict === "rejected_wrong" ? "apontando ERRO na avaliação anterior da IA" : "apontando RESSALVA importante"}) ` +
            `e registrou a seguinte orientação obrigatória: "${existingDirectorReview.comment}".` +
            (existingDirectorReview.adjustedScore !== null && existingDirectorReview.adjustedScore !== undefined
              ? ` Nota de referência indicada pelo Diretor: ${existingDirectorReview.adjustedScore}/100.`
              : "") +
            ` Refaça o diagnóstico absorvendo fielmente o apontamento do Diretor.\n`
          : "";

      // 5. Monta o prompt completo parametrizado por tenant + memória de calibração
      const prompt = buildAuditPrompt(
        tenantId,
        transcript,
        slaContext,
        crmContext,
        learnedCalibrationContext + specificDirectorInstruction,
      );

      // 6. Chama o Gemini passando o contexto de custo correto para o painel financeiro
      const result = await this.callGemini(prompt, tenantId, conversationId);
      if (!result) throw new Error("Vertex AI retornou resposta vazia ou inválida.");

      const finalPerformanceScore =
        existingDirectorReview?.adjustedScore !== null &&
        existingDirectorReview?.adjustedScore !== undefined
          ? clampScore(existingDirectorReview.adjustedScore, result.performanceScore)
          : result.performanceScore;

      const hadLongGap = Boolean(result.hadLongResponseGap || overdueCount > 0);
      const pillarScores = computeFallbackPillarScores({
        performanceScore: finalPerformanceScore,
        hadLongResponseGap: hadLongGap,
        hadMissedObjection: Boolean(result.hadMissedObjection),
        hadRudeLanguage: Boolean(result.hadRudeLanguage),
        hadNoFollowUp: Boolean(result.hadNoFollowUp),
        rawAiResponse: result,
      });

      const enrichedRawResponse: Record<string, any> = {
        ...result,
        pillarScores,
      };
      if (existingDirectorReview) {
        enrichedRawResponse.directorReview = existingDirectorReview;
      }

      // 7. Salva o resultado
      const completed = await db
        .update(aiConversationAudits)
        .set({
          operatorId,
          contactName,
          leaseToken: null,
          leaseUntil: null,
          status: "done",
          errorMessage: null,
          performanceScore: finalPerformanceScore,
          clientSentiment: result.clientSentiment,
          hadLongResponseGap: hadLongGap,
          hadMissedObjection: Boolean(result.hadMissedObjection),
          hadRudeLanguage: Boolean(result.hadRudeLanguage),
          hadNoFollowUp: Boolean(result.hadNoFollowUp),
          summary: result.summary,
          strengths: result.strengths,
          weaknesses: result.weaknesses,
          actionableInsight: result.actionableInsight,
          rawAiResponse: enrichedRawResponse as any,
          auditedAt: new Date(),
        })
        .where(
          and(
            eq(aiConversationAudits.id, auditId),
            eq(aiConversationAudits.tenantId, tenantId),
            eq(aiConversationAudits.leaseToken, leaseToken),
          ),
        )
        .returning({ id: aiConversationAudits.id });
      if (!completed.length) return;

      console.log(
        `[AuditService] ✓ Auditoria ${auditId} (${tenantId}) concluída — Score: ${finalPerformanceScore}/100`,
      );

      // 8. Atualiza métricas diárias do operador com cálculo real no banco
      if (operatorId) {
        await this.updateOperatorAuditMetrics(tenantId, operatorId).catch((metricErr: any) =>
          console.warn(
            `[AuditService] Aviso ao atualizar métricas diárias (${operatorId}):`,
            metricErr?.message,
          ),
        );
      }
    } catch (e: any) {
      console.error(`[AuditService] Erro ao processar auditoria ${auditId}:`, e?.message);
      await db
        .update(aiConversationAudits)
        .set({
          leaseToken: null,
          leaseUntil: null,
          status: "error",
          errorMessage: e?.message?.slice(0, 500) ?? "Erro desconhecido",
        })
        .where(
          and(
            eq(aiConversationAudits.id, auditId),
            eq(aiConversationAudits.tenantId, tenantId),
            eq(aiConversationAudits.leaseToken, leaseToken),
          ),
        );
    }
  }

  /**
   * Chama o Gemini via Vertex AI com suporte a JSON estruturado.
   */
  private async callGemini(
    prompt: string,
    tenantId: string,
    conversationId: string,
    attempt = 1,
  ): Promise<AuditResult | null> {
    try {
      const { vertexAi } = await import("./vertex-ai");
      const parsed = await vertexAi.generateStructuredJson<AuditResult>(
        prompt,
        "gemini-2.5-flash",
        undefined,
        {
          feature: "conversation_audit",
          tenantId,
          metadata: { conversationId },
        },
      );
      if (!parsed) {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000));
          return this.callGemini(prompt, tenantId, conversationId, attempt + 1);
        }
        return null;
      }

      parsed.performanceScore = clampScore(parsed.performanceScore, 70);

      if (
        parsed.clientSentiment !== "satisfeito" &&
        parsed.clientSentiment !== "neutro" &&
        parsed.clientSentiment !== "frustrado"
      ) {
        parsed.clientSentiment = "neutro";
      }

      return parsed;
    } catch (e: any) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000));
        return this.callGemini(prompt, tenantId, conversationId, attempt + 1);
      }
      throw e;
    }
  }

  /**
   * Método público para recalcular métricas do consultor imediatamente após
   * ajuste de nota pela Diretoria ou descarte de atendimento de teste.
   */
  async recalculateOperatorMetrics(tenantId: string, operatorId: string | null) {
    if (!operatorId) return;
    await this.updateOperatorAuditMetrics(tenantId, operatorId);
  }

  /**
   * Recalcula com exatidão o score médio e os contadores de sentimento do operador no dia BRT
   * diretamente a partir das auditorias concluídas em `ai_conversation_audits`.
   */
  private async updateOperatorAuditMetrics(tenantId: string, operatorId: string) {
    const todayBrt = getBrtDateKey(new Date());
    const dayStartIso = new Date(`${todayBrt}T00:00:00.000-03:00`).toISOString();
    const dayEndIso = new Date(`${todayBrt}T23:59:59.999-03:00`).toISOString();

    const statsRes = await db.execute(sql`
      SELECT
        ROUND(AVG(performance_score))::int AS avg_score,
        COUNT(*) FILTER (WHERE client_sentiment = 'satisfeito')::int AS satisfied_cnt,
        COUNT(*) FILTER (WHERE client_sentiment = 'neutro')::int AS neutral_cnt,
        COUNT(*) FILTER (WHERE client_sentiment = 'frustrado')::int AS frustrated_cnt,
        COUNT(*)::int AS total_audited
      FROM ai_conversation_audits
      WHERE tenant_id = ${tenantId}
        AND operator_id = ${operatorId}
        AND status = 'done'
        AND audited_at >= ${dayStartIso}::timestamptz
        AND audited_at <= ${dayEndIso}::timestamptz
    `);

    const stats = extractRows<{
      avg_score: number | null;
      satisfied_cnt: number;
      neutral_cnt: number;
      frustrated_cnt: number;
      total_audited: number;
    }>(statsRes)[0];

    const existing = await db
      .select()
      .from(operatorDailyMetrics)
      .where(
        and(
          eq(operatorDailyMetrics.tenantId, tenantId),
          eq(operatorDailyMetrics.operatorId, operatorId),
          eq(operatorDailyMetrics.date, todayBrt),
        ),
      )
      .limit(1);

    if (!stats || stats.total_audited === 0) {
      if (existing.length > 0) {
        await db
          .update(operatorDailyMetrics)
          .set({
            avgPerformanceScore: null,
            satisfiedCount: 0,
            neutralCount: 0,
            frustratedCount: 0,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(operatorDailyMetrics.id, existing[0].id),
              eq(operatorDailyMetrics.tenantId, tenantId),
            ),
          );
      }
      return;
    }

    if (existing.length > 0) {
      await db
        .update(operatorDailyMetrics)
        .set({
          avgPerformanceScore: stats.avg_score,
          satisfiedCount: stats.satisfied_cnt,
          neutralCount: stats.neutral_cnt,
          frustratedCount: stats.frustrated_cnt,
          totalConversations: Math.max(existing[0].totalConversations, stats.total_audited),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(operatorDailyMetrics.id, existing[0].id),
            eq(operatorDailyMetrics.tenantId, tenantId),
          ),
        );
    } else {
      const op = await db
        .select({ name: operators.name })
        .from(operators)
        .where(and(eq(operators.id, operatorId), eq(operators.tenantId, tenantId)))
        .limit(1);

      await db.insert(operatorDailyMetrics).values({
        id: `odm-${tenantId}-${operatorId}-${todayBrt}`,
        tenantId,
        operatorId,
        operatorName: op[0]?.name ?? "Desconhecido",
        date: todayBrt,
        totalConversations: stats.total_audited,
        avgPerformanceScore: stats.avg_score,
        satisfiedCount: stats.satisfied_cnt,
        neutralCount: stats.neutral_cnt,
        frustratedCount: stats.frustrated_cnt,
        overdueCount: 0,
        updatedAt: new Date(),
      });
    }
  }

  /**
   * Enfileira uma conversa para auditoria de IA (suporta `tecfag` e `valem`).
   * Se já houver auditoria anterior com erro, ou se houver mensagens novas após `auditedAt`,
   * ou se `force: true`, re-enfileira para atualizar o diagnóstico.
   * Nunca re-enfileira automaticamente atendimentos descartados como teste (`dismissed_test`).
   */
  async enqueueAudit(params: {
    tenantId: string;
    conversationId: string;
    operatorId?: string | null;
    contactName?: string | null;
    force?: boolean;
  }): Promise<{ enqueued: boolean; auditId?: string }> {
    if (!isSdrTenant(params.tenantId)) {
      return { enqueued: false };
    }

    const resolved = await this.resolveConversationMetadata(
      params.tenantId,
      params.conversationId,
      params.operatorId ?? null,
      params.contactName ?? null,
    );

    const existing = await db
      .select({
        id: aiConversationAudits.id,
        status: aiConversationAudits.status,
        auditedAt: aiConversationAudits.auditedAt,
      })
      .from(aiConversationAudits)
      .where(
        and(
          eq(aiConversationAudits.tenantId, params.tenantId),
          eq(aiConversationAudits.conversationId, params.conversationId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const curr = existing[0];
      if (curr.status === "dismissed_test" && !params.force) {
        return { enqueued: false, auditId: curr.id };
      }

      let shouldReaudit = Boolean(params.force) || curr.status === "error";

      if (!shouldReaudit && curr.status === "done" && curr.auditedAt) {
        // Verifica se houve novas mensagens reais após a última auditoria
        const auditedAtIso =
          curr.auditedAt instanceof Date
            ? curr.auditedAt.toISOString()
            : new Date(curr.auditedAt).toISOString();
        const newerMsgRes = await db.execute(sql`
          SELECT COUNT(*)::int AS cnt
          FROM messages m
          WHERE m.tenant_id = ${params.tenantId}
            AND m.conversation_id = ${params.conversationId}
            AND m.is_internal_note = false
            AND m.sender_type IN ('client', 'agent')
            AND m.sent_at > ${auditedAtIso}::timestamptz
        `);
        const newerCount = Number(extractRows<{ cnt: number }>(newerMsgRes)[0]?.cnt ?? 0);
        if (newerCount >= 2) {
          shouldReaudit = true;
        }
      }

      if (!shouldReaudit) {
        return { enqueued: false, auditId: curr.id };
      }

      await db
        .update(aiConversationAudits)
        .set({
          operatorId: resolved.operatorId,
          contactName: resolved.contactName,
          status: "pending",
          errorMessage: null,
          leaseToken: null,
          leaseUntil: null,
        })
        .where(
          and(
            eq(aiConversationAudits.id, curr.id),
            eq(aiConversationAudits.tenantId, params.tenantId),
          ),
        );

      this.triggerImmediateRun();
      return { enqueued: true, auditId: curr.id };
    }

    const auditId = `audit-${params.conversationId}-${Date.now()}`;
    await db.insert(aiConversationAudits).values({
      id: auditId,
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      operatorId: resolved.operatorId,
      contactName: resolved.contactName,
      status: "pending",
      createdAt: new Date(),
    });

    console.log(
      `[AuditService] Auditoria enfileirada para conversa ${params.conversationId} (tenant: ${params.tenantId})`,
    );

    this.triggerImmediateRun();
    return { enqueued: true, auditId };
  }

  /**
   * Enfileira automaticamente as conversas vinculadas a uma negociação do CRM quando ela é
   * marcada como Vendida (`won`) ou Perdida (`lost`).
   */
  async enqueueDealConversationsForAudit(params: {
    tenantId: string;
    dealId: string;
    operatorId?: string | null;
  }) {
    if (!isSdrTenant(params.tenantId)) return;
    try {
      const convsRes = await db.execute(sql`
        SELECT DISTINCT c.id AS conversation_id, c.operator_id, ct.name AS contact_name
        FROM conversations c
        LEFT JOIN contacts ct
          ON ct.id = c.contact_id AND ct.tenant_id = c.tenant_id
        WHERE c.tenant_id = ${params.tenantId}
          AND (
            EXISTS (
              SELECT 1 FROM conversation_deal_contexts cdc
              WHERE cdc.tenant_id = c.tenant_id
                AND cdc.conversation_id = c.id
                AND cdc.current_deal_id = ${params.dealId}
            )
            OR EXISTS (
              SELECT 1 FROM crm_conversation_deals ccd
              WHERE ccd.tenant_id = c.tenant_id
                AND ccd.conversation_id = c.id
                AND ccd.deal_id = ${params.dealId}
                AND ccd.is_active = true
            )
            OR EXISTS (
              SELECT 1 FROM crm_deal_contacts dc
              WHERE dc.tenant_id = c.tenant_id
                AND dc.deal_id = ${params.dealId}
                AND dc.contact_id = c.contact_id
            )
          )
          AND (
            SELECT COUNT(*)
            FROM messages m
            WHERE m.tenant_id = c.tenant_id
              AND m.conversation_id = c.id
              AND m.is_internal_note = false
              AND m.sender_type IN ('client', 'agent')
          ) >= 3
        ORDER BY c.updated_at DESC
        LIMIT 3
      `);

      const rows = extractRows<{
        conversation_id: string;
        operator_id: string | null;
        contact_name: string | null;
      }>(convsRes);

      for (const row of rows) {
        await this.enqueueAudit({
          tenantId: params.tenantId,
          conversationId: row.conversation_id,
          operatorId: row.operator_id || params.operatorId || null,
          contactName: row.contact_name,
          force: false,
        });
      }
    } catch (e: any) {
      console.warn("[AuditService] Erro ao enfileirar auditoria por fechamento de deal:", e?.message);
    }
  }

  /**
   * Varre conversas elegíveis do tenant (com diálogo real entre cliente e consultor >= 3 mensagens)
   * que ainda não possuem auditoria concluída (ou que receberam novas mensagens após a última auditoria)
   * e as enfileira para processamento imediato, ignorando atendimentos descartados como teste.
   */
  async scanAndEnqueueEligibleConversations(
    tenantId: string,
    options?: { limit?: number; operatorId?: string | null; force?: boolean },
  ): Promise<{ enqueuedCount: number; pendingTotal: number }> {
    if (!isSdrTenant(tenantId)) {
      return { enqueuedCount: 0, pendingTotal: 0 };
    }

    const limit = Math.min(Math.max(options?.limit ?? 15, 1), 40);
    const operatorFilterSql = options?.operatorId
      ? sql`AND c.operator_id = ${options.operatorId}`
      : sql``;

    const candidatesRes = await db.execute(sql`
      WITH conv_msg_stats AS (
        SELECT
          m.conversation_id,
          COUNT(*) FILTER (WHERE m.is_internal_note = false AND m.sender_type IN ('client', 'agent'))::int AS visible_cnt,
          COUNT(*) FILTER (WHERE m.is_internal_note = false AND m.sender_type = 'client')::int AS client_cnt,
          COUNT(*) FILTER (WHERE m.is_internal_note = false AND m.sender_type = 'agent')::int AS agent_cnt,
          MAX(m.sent_at) FILTER (WHERE m.is_internal_note = false AND m.sender_type IN ('client', 'agent')) AS last_msg_at
        FROM messages m
        WHERE m.tenant_id = ${tenantId}
        GROUP BY m.conversation_id
        HAVING COUNT(*) FILTER (WHERE m.is_internal_note = false AND m.sender_type IN ('client', 'agent')) >= 3
           AND COUNT(*) FILTER (WHERE m.is_internal_note = false AND m.sender_type = 'client') >= 1
           AND COUNT(*) FILTER (WHERE m.is_internal_note = false AND m.sender_type = 'agent') >= 1
      )
      SELECT
        c.id AS conversation_id,
        c.operator_id,
        ct.name AS contact_name,
        cms.last_msg_at,
        a.id AS existing_audit_id,
        a.status AS existing_status,
        a.audited_at AS existing_audited_at
      FROM conv_msg_stats cms
      JOIN conversations c
        ON c.id = cms.conversation_id AND c.tenant_id = ${tenantId}
      LEFT JOIN contacts ct
        ON ct.id = c.contact_id AND ct.tenant_id = c.tenant_id
      LEFT JOIN ai_conversation_audits a
        ON a.conversation_id = c.id AND a.tenant_id = c.tenant_id
      WHERE 1=1
        ${operatorFilterSql}
        AND COALESCE(a.status, '') != 'dismissed_test'
        AND LOWER(TRIM(COALESCE(ct.name, ''))) NOT IN ('teste', 'test', 'contato teste')
        AND (
          a.id IS NULL
          OR a.status = 'error'
          OR (${Boolean(options?.force)} = true AND a.status = 'done')
          OR (a.status = 'done' AND a.audited_at IS NOT NULL AND cms.last_msg_at > a.audited_at + INTERVAL '10 minutes')
        )
      ORDER BY
        CASE WHEN c.queue_state = 'finalizados' THEN 0 ELSE 1 END,
        cms.last_msg_at DESC NULLS LAST
      LIMIT ${limit}
    `);

    const candidates = extractRows<{
      conversation_id: string;
      operator_id: string | null;
      contact_name: string | null;
    }>(candidatesRes);

    let enqueuedCount = 0;
    for (const cand of candidates) {
      const res = await this.enqueueAudit({
        tenantId,
        conversationId: cand.conversation_id,
        operatorId: cand.operator_id,
        contactName: cand.contact_name,
        force: true,
      });
      if (res.enqueued) enqueuedCount++;
    }

    const pendingRes = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM ai_conversation_audits
      WHERE tenant_id = ${tenantId}
        AND status IN ('pending', 'processing')
    `);
    const pendingTotal = Number(extractRows<{ cnt: number }>(pendingRes)[0]?.cnt ?? 0);

    if (enqueuedCount > 0 || pendingTotal > 0) {
      this.triggerImmediateRun();
    }

    return { enqueuedCount, pendingTotal };
  }
}

// ── Prompt Builder ────────────────────────────────────────────────────────────
function buildAuditPrompt(
  tenantId: string,
  transcript: string,
  slaContext: string,
  crmContext: string,
  calibrationContext = "",
): string {
  const playbook = getAuditPlaybook(tenantId);
  return `Você é um Diretor de Qualidade Comercial (QA) e Especialista em Vendas B2B.
Sua missão é auditar com rigor técnico, justiça e visão executiva o atendimento comercial abaixo realizado via WhatsApp.

${playbook}
${calibrationContext}
## DADOS DO ATENDIMENTO A ANALISAR

### Contexto da Negociação no CRM
${crmContext}

### Métricas de Tempo de Resposta (SLA)
${slaContext}

### Transcrição Completa do Atendimento
${transcript}

## INSTRUÇÃO EXECUTIVA
Analise o atendimento acima com base no Playbook da empresa, nas regras aprendidas com o feedback da Diretoria (se presentes acima), no contexto da negociação no CRM e nas métricas de SLA.
- Seja específico: cite comportamentos, perguntas, acertos ou omissões concretas da conversa ao apontar Pontos Fortes e Falhas.
- Seja justo: avalie tanto a postura e técnica comercial do consultor quanto a receptividade do cliente.
- Gere um "actionableInsight" direto para a Diretoria e uma "coachingMessageSuggestion" construtiva pronta para ser enviada como orientação interna ao consultor.

${AUDIT_JSON_SCHEMA}`;
}

export const auditService = AuditService.getInstance();
