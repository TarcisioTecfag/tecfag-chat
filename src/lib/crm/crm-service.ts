import { eq, and, desc, asc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  crmAccounts,
  crmContactAccountHistory,
  crmAccountConversations,
  crmPipelines,
  crmStages,
  crmDeals,
  crmDealContacts,
  crmConversationDeals,
  crmDealActivities,
  crmActivityMessages,
  crmDealEvents,
  crmProducts,
  crmDealProducts,
  crmProposals,
  contacts,
  conversations,
  operators,
  messages,
} from "../../db/schema";
import type {
  CrmAccount,
  CrmPipeline,
  CrmStage,
  CrmDeal,
  CrmDealContact,
  CrmConversationDeal,
  CrmDealActivity,
  CrmActivityMessage,
  CrmDealEvent,
  CrmProduct,
  CrmDealProduct,
  CrmProposal,
} from "../../db/schema";

/**
 * Normaliza documento (CPF ou CNPJ) mantendo estritamente dígitos.
 */
export function normalizeDocument(doc?: string | null): string {
  if (!doc) return "";
  return doc.replace(/\D/g, "");
}

/**
 * Identifica o tipo de documento baseado no tamanho de dígitos.
 */
export function detectDocumentType(docDigits: string): "cpf" | "cnpj" | "other" {
  if (docDigits.length === 11) return "cpf";
  if (docDigits.length === 14) return "cnpj";
  return "other";
}

export class CrmService {
  private static instance: CrmService;

  private constructor() {}

  public static getInstance(): CrmService {
    if (!CrmService.instance) {
      CrmService.instance = new CrmService();
    }
    return CrmService.instance;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. FUNIS E ETAPAS (Pipelines & Stages)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista todos os funis de um tenant com suas respectivas etapas ordenadas.
   */
  async getPipelines(tenantId: string): Promise<Array<CrmPipeline & { stages: CrmStage[] }>> {
    const pipelines = await db
      .select()
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, tenantId))
      .orderBy(asc(crmPipelines.orderIndex), asc(crmPipelines.createdAt));

    if (pipelines.length === 0) {
      return [];
    }

    const pipelineIds = pipelines.map((p) => p.id);
    const stages = await db
      .select()
      .from(crmStages)
      .where(
        and(
          eq(crmStages.tenantId, tenantId),
          inArray(crmStages.pipelineId, pipelineIds)
        )
      )
      .orderBy(asc(crmStages.orderIndex), asc(crmStages.createdAt));

    const stagesByPipeline = new Map<string, CrmStage[]>();
    for (const stage of stages) {
      const list = stagesByPipeline.get(stage.pipelineId) || [];
      list.push(stage);
      stagesByPipeline.set(stage.pipelineId, list);
    }

    return pipelines.map((pipeline) => ({
      ...pipeline,
      stages: stagesByPipeline.get(pipeline.id) || [],
    }));
  }

  /**
   * Cria um novo funil com etapas opcionais para um tenant.
   */
  async createPipeline(
    tenantId: string,
    data: {
      name: string;
      orderIndex?: number;
      isDefault?: boolean;
      color?: string;
      coolingDays?: number;
      stages?: Array<{
        name: string;
        orderIndex?: number;
        isWinStage?: boolean;
        isLossStage?: boolean;
        requiredFields?: string[];
      }>;
    }
  ): Promise<CrmPipeline & { stages: CrmStage[] }> {
    const pipelineId = `pipe-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    
    // Se for padrão, desmarca outros
    if (data.isDefault) {
      await db
        .update(crmPipelines)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(crmPipelines.tenantId, tenantId));
    }

    const [createdPipeline] = await db
      .insert(crmPipelines)
      .values({
        id: pipelineId,
        tenantId,
        name: data.name.trim(),
        orderIndex: data.orderIndex ?? 0,
        isDefault: data.isDefault ?? false,
        color: data.color || "#0284c7",
        coolingDays: data.coolingDays ?? 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const createdStages: CrmStage[] = [];
    if (data.stages && data.stages.length > 0) {
      for (let i = 0; i < data.stages.length; i++) {
        const s = data.stages[i];
        const stageId = `stg-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 5)}`;
        const [stage] = await db
          .insert(crmStages)
          .values({
            id: stageId,
            tenantId,
            pipelineId,
            name: s.name.trim(),
            orderIndex: s.orderIndex ?? i,
            isWinStage: s.isWinStage ?? false,
            isLossStage: s.isLossStage ?? false,
            requiredFields: s.requiredFields ?? [],
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        createdStages.push(stage);
      }
    }

    return {
      ...createdPipeline,
      stages: createdStages,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. CLIENTES / CONTAS (Accounts PF e PJ)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Busca contas por documento normalizado, nome ou listagem paginada.
   */
  async getAccounts(
    tenantId: string,
    params: {
      search?: string;
      document?: string;
      type?: "person" | "company";
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ accounts: CrmAccount[]; total: number }> {
    const conditions = [
      eq(crmAccounts.tenantId, tenantId),
      sql`${crmAccounts.archivedAt} IS NULL`,
    ];

    if (params.document) {
      const cleanDoc = normalizeDocument(params.document);
      if (cleanDoc) {
        conditions.push(eq(crmAccounts.document, cleanDoc));
      }
    }

    if (params.type) {
      conditions.push(eq(crmAccounts.type, params.type));
    }

    if (params.search && params.search.trim()) {
      const term = `%${params.search.trim().toLowerCase()}%`;
      conditions.push(
        sql`(LOWER(${crmAccounts.name}) LIKE ${term} OR LOWER(${crmAccounts.tradeName}) LIKE ${term} OR LOWER(${crmAccounts.document}) LIKE ${term} OR LOWER(${crmAccounts.email}) LIKE ${term})`
      );
    }

    const whereClause = and(...conditions);
    const limit = Math.min(params.limit || 50, 100);
    const offset = params.offset || 0;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(crmAccounts)
      .where(whereClause);

    const accounts = await db
      .select()
      .from(crmAccounts)
      .where(whereClause)
      .orderBy(desc(crmAccounts.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      accounts,
      total: countResult?.count || 0,
    };
  }

  /**
   * Cria ou obtém conta compradora por documento normalizado (PF ou PJ).
   */
  async createAccount(
    tenantId: string,
    data: {
      name: string;
      type?: "person" | "company";
      tradeName?: string;
      document?: string;
      email?: string;
      phone?: string;
      website?: string;
      address?: Record<string, any>;
      customFields?: Record<string, any>;
      notes?: string;
      rdOrganizationId?: string;
    }
  ): Promise<CrmAccount> {
    const cleanDoc = normalizeDocument(data.document);
    let docType = "other";
    if (cleanDoc) {
      docType = detectDocumentType(cleanDoc);
    }

    // Se já existe uma conta com o mesmo documento válido no tenant, retorna a existente
    if (cleanDoc) {
      const [existing] = await db
        .select()
        .from(crmAccounts)
        .where(
          and(
            eq(crmAccounts.tenantId, tenantId),
            eq(crmAccounts.document, cleanDoc),
            sql`${crmAccounts.archivedAt} IS NULL`
          )
        )
        .limit(1);

      if (existing) {
        return existing;
      }
    }

    const accountType = data.type || (docType === "cnpj" ? "company" : "person");
    const accountId = `acc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const [account] = await db
      .insert(crmAccounts)
      .values({
        id: accountId,
        tenantId,
        type: accountType,
        name: data.name.trim(),
        tradeName: data.tradeName?.trim() || null,
        documentType: docType,
        document: cleanDoc || null,
        email: data.email?.trim() || null,
        phone: data.phone?.trim() || null,
        website: data.website?.trim() || null,
        address: data.address || {},
        customFields: data.customFields || {},
        notes: data.notes?.trim() || null,
        rdOrganizationId: data.rdOrganizationId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return account;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. NEGOCIAÇÕES / CARDS (Deals)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista negociações paginadas com filtros comerciais, contagem de conversas e dados do comprador.
   */
  async getDeals(
    tenantId: string,
    params: {
      pipelineId?: string;
      stageId?: string;
      status?: "open" | "won" | "lost" | "paused";
      operatorId?: string;
      accountId?: string;
      search?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{
    deals: Array<
      CrmDeal & {
        account: CrmAccount | null;
        contactsCount: number;
        conversationsCount: number;
      }
    >;
    total: number;
  }> {
    const conditions = [eq(crmDeals.tenantId, tenantId)];

    if (params.pipelineId) {
      conditions.push(eq(crmDeals.pipelineId, params.pipelineId));
    }
    if (params.stageId) {
      conditions.push(eq(crmDeals.stageId, params.stageId));
    }
    if (params.status) {
      conditions.push(eq(crmDeals.status, params.status));
    }
    if (params.operatorId) {
      conditions.push(eq(crmDeals.operatorId, params.operatorId));
    }
    if (params.accountId) {
      conditions.push(eq(crmDeals.accountId, params.accountId));
    }
    if (params.search && params.search.trim()) {
      const term = `%${params.search.trim().toLowerCase()}%`;
      conditions.push(sql`LOWER(${crmDeals.title}) LIKE ${term}`);
    }

    const whereClause = and(...conditions);
    const limit = Math.min(params.limit || 50, 200);
    const offset = params.offset || 0;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(crmDeals)
      .where(whereClause);

    const rawDeals = await db
      .select()
      .from(crmDeals)
      .where(whereClause)
      .orderBy(desc(crmDeals.updatedAt), desc(crmDeals.createdAt))
      .limit(limit)
      .offset(offset);

    if (rawDeals.length === 0) {
      return { deals: [], total: countResult?.count || 0 };
    }

    const dealIds = rawDeals.map((d) => d.id);
    const accountIds = Array.from(new Set(rawDeals.map((d) => d.accountId).filter(Boolean))) as string[];

    // Buscar contas associadas em lote
    const accountsMap = new Map<string, CrmAccount>();
    if (accountIds.length > 0) {
      const accList = await db
        .select()
        .from(crmAccounts)
        .where(
          and(
            eq(crmAccounts.tenantId, tenantId),
            inArray(crmAccounts.id, accountIds)
          )
        );
      for (const a of accList) {
        accountsMap.set(a.id, a);
      }
    }

    // Contagem de conversas ativas por deal
    const convCounts = await db
      .select({
        dealId: crmConversationDeals.dealId,
        count: sql<number>`count(distinct ${crmConversationDeals.conversationId})::int`,
      })
      .from(crmConversationDeals)
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          inArray(crmConversationDeals.dealId, dealIds),
          eq(crmConversationDeals.isActive, true)
        )
      )
      .groupBy(crmConversationDeals.dealId);

    const convCountMap = new Map<string, number>();
    for (const c of convCounts) {
      convCountMap.set(c.dealId, c.count);
    }

    // Contagem de contatos por deal
    const contactCounts = await db
      .select({
        dealId: crmDealContacts.dealId,
        count: sql<number>`count(*)::int`,
      })
      .from(crmDealContacts)
      .where(
        and(
          eq(crmDealContacts.tenantId, tenantId),
          inArray(crmDealContacts.dealId, dealIds)
        )
      )
      .groupBy(crmDealContacts.dealId);

    const contactCountMap = new Map<string, number>();
    for (const cc of contactCounts) {
      contactCountMap.set(cc.dealId, cc.count);
    }

    const enrichedDeals = rawDeals.map((deal) => ({
      ...deal,
      account: deal.accountId ? accountsMap.get(deal.accountId) || null : null,
      conversationsCount: convCountMap.get(deal.id) || 0,
      contactsCount: contactCountMap.get(deal.id) || 0,
    }));

    return {
      deals: enrichedDeals,
      total: countResult?.count || 0,
    };
  }

  /**
   * Obtém ficha detalhada de uma negociação por ID com validação estrita de tenant.
   */
  async getDealById(
    tenantId: string,
    dealId: string
  ): Promise<
    | (CrmDeal & {
        account: CrmAccount | null;
        contacts: Array<CrmDealContact & { contact: typeof contacts.$inferSelect }>;
        conversations: Array<CrmConversationDeal & { conversation: typeof conversations.$inferSelect }>;
        activities: CrmDealActivity[];
        events: CrmDealEvent[];
        evidences: Array<CrmActivityMessage & { message: typeof messages.$inferSelect }>;
        products: CrmDealProduct[];
        proposals: CrmProposal[];
      })
    | null
  > {
    const [deal] = await db
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (!deal) return null;

    let account: CrmAccount | null = null;
    if (deal.accountId) {
      const [acc] = await db
        .select()
        .from(crmAccounts)
        .where(and(eq(crmAccounts.id, deal.accountId), eq(crmAccounts.tenantId, tenantId)))
        .limit(1);
      account = acc || null;
    }

    // Contatos participantes
    const dealContactsRaw = await db
      .select({
        dealContact: crmDealContacts,
        contact: contacts,
      })
      .from(crmDealContacts)
      .innerJoin(contacts, eq(crmDealContacts.contactId, contacts.id))
      .where(
        and(
          eq(crmDealContacts.tenantId, tenantId),
          eq(crmDealContacts.dealId, dealId)
        )
      );

    const mappedContacts = dealContactsRaw.map((r) => ({
      ...r.dealContact,
      contact: r.contact,
    }));

    // Conversas vinculadas ativas
    const convDealsRaw = await db
      .select({
        convDeal: crmConversationDeals,
        conversation: conversations,
      })
      .from(crmConversationDeals)
      .innerJoin(conversations, eq(crmConversationDeals.conversationId, conversations.id))
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          eq(crmConversationDeals.dealId, dealId),
          eq(crmConversationDeals.isActive, true)
        )
      );

    const mappedConversations = convDealsRaw.map((r) => ({
      ...r.convDeal,
      conversation: r.conversation,
    }));

    // Atividades e tarefas
    const activities = await db
      .select()
      .from(crmDealActivities)
      .where(and(eq(crmDealActivities.tenantId, tenantId), eq(crmDealActivities.dealId, dealId)))
      .orderBy(desc(crmDealActivities.createdAt));

    // Eventos de auditoria
    const events = await db
      .select()
      .from(crmDealEvents)
      .where(and(eq(crmDealEvents.tenantId, tenantId), eq(crmDealEvents.dealId, dealId)))
      .orderBy(desc(crmDealEvents.createdAt));

    // Mensagens marcadas como evidência comercial
    const evidencesRaw = await db
      .select({
        evidence: crmActivityMessages,
        message: messages,
      })
      .from(crmActivityMessages)
      .innerJoin(messages, eq(crmActivityMessages.messageId, messages.id))
      .where(
        and(
          eq(crmActivityMessages.tenantId, tenantId),
          eq(crmActivityMessages.dealId, dealId)
        )
      )
      .orderBy(desc(crmActivityMessages.createdAt));

    const evidences = evidencesRaw.map((r) => ({
      ...r.evidence,
      message: r.message,
    }));

    // Produtos vinculados
    const products = await db
      .select()
      .from(crmDealProducts)
      .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)))
      .orderBy(asc(crmDealProducts.createdAt));

    // Propostas comerciais
    const proposals = await db
      .select()
      .from(crmProposals)
      .where(and(eq(crmProposals.tenantId, tenantId), eq(crmProposals.dealId, dealId)))
      .orderBy(desc(crmProposals.createdAt));

    return {
      ...deal,
      account,
      contacts: mappedContacts,
      conversations: mappedConversations,
      activities,
      events,
      evidences,
      products,
      proposals,
    };
  }

  /**
   * Cria uma negociação com auditoria e vínculo opcional a uma conversa/contato.
   */
  async createDeal(
    tenantId: string,
    operatorId: string | null,
    data: {
      title: string;
      pipelineId: string;
      stageId: string;
      accountId?: string | null;
      value?: string | number;
      currency?: string;
      expectedCloseDate?: Date | null;
      source?: string;
      campaign?: string;
      rating?: number;
      contactId?: string; // Contato principal a associar
      conversationId?: string; // Conversa de origem
    }
  ): Promise<CrmDeal> {
    const dealId = `deal-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const [deal] = await db
      .insert(crmDeals)
      .values({
        id: dealId,
        tenantId,
        title: data.title.trim(),
        accountId: data.accountId || null,
        pipelineId: data.pipelineId,
        stageId: data.stageId,
        status: "open",
        value: (data.value ?? "0.00").toString(),
        currency: data.currency || "BRL",
        expectedCloseDate: data.expectedCloseDate || null,
        operatorId: operatorId || null,
        source: data.source || "manual",
        campaign: data.campaign || null,
        rating: data.rating ?? 0,
        version: 1,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Evento de auditoria imutável
    await this.logDealEvent(tenantId, dealId, "created", operatorId, {
      title: deal.title,
      pipelineId: deal.pipelineId,
      stageId: deal.stageId,
      value: deal.value,
    });

    // Se informado um contato, cria o vínculo participante
    if (data.contactId) {
      await db.insert(crmDealContacts).values({
        id: `dc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId,
        contactId: data.contactId,
        role: "buyer",
        isPrimary: true,
        createdAt: now,
      });
    }

    // Se originado de uma conversa, vincula N:N
    if (data.conversationId) {
      await this.linkConversationDeal(tenantId, data.conversationId, dealId, operatorId, "chat");
    }

    return deal;
  }

  /**
   * Atualiza etapa, status ou campos de uma negociação com verificação de versão (concorrência otimista).
   */
  async updateDeal(
    tenantId: string,
    dealId: string,
    operatorId: string | null,
    updates: {
      title?: string;
      stageId?: string;
      status?: "open" | "won" | "lost" | "paused";
      value?: string | number;
      expectedCloseDate?: Date | null;
      operatorId?: string | null;
      rating?: number;
      lossReason?: string | null;
      pausedReason?: string | null;
      expectedVersion?: number;
    }
  ): Promise<CrmDeal> {
    const [current] = await db
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (!current) {
      throw new Error("Negociação não encontrada.");
    }

    if (updates.expectedVersion !== undefined && current.version !== updates.expectedVersion) {
      throw new Error(`CONCURRENCY_CONFLICT: Versão esperada ${updates.expectedVersion}, mas atual é ${current.version}`);
    }

    const now = new Date();
    const setPayload: Record<string, any> = {
      updatedAt: now,
      version: current.version + 1,
    };

    if (updates.title !== undefined) setPayload.title = updates.title.trim();
    if (updates.value !== undefined) setPayload.value = updates.value.toString();
    if (updates.expectedCloseDate !== undefined) setPayload.expectedCloseDate = updates.expectedCloseDate;
    if (updates.operatorId !== undefined) setPayload.operatorId = updates.operatorId;
    if (updates.rating !== undefined) setPayload.rating = updates.rating;
    if (updates.lossReason !== undefined) setPayload.lossReason = updates.lossReason;
    if (updates.pausedReason !== undefined) setPayload.pausedReason = updates.pausedReason;

    // Transição de etapa
    const stageChanged = updates.stageId && updates.stageId !== current.stageId;
    if (stageChanged) {
      setPayload.stageId = updates.stageId;
      setPayload.lastActivityAt = now;
    }

    // Transição de status
    const statusChanged = updates.status && updates.status !== current.status;
    if (statusChanged) {
      setPayload.status = updates.status;
      if (updates.status === "won" || updates.status === "lost") {
        setPayload.closedAt = now;
      } else {
        setPayload.closedAt = null;
      }
      setPayload.lastActivityAt = now;
    }

    const [updated] = await db
      .update(crmDeals)
      .set(setPayload)
      .where(
        and(
          eq(crmDeals.id, dealId),
          eq(crmDeals.tenantId, tenantId),
          eq(crmDeals.version, current.version)
        )
      )
      .returning();

    if (!updated) {
      throw new Error("Falha de concorrência ao atualizar a negociação.");
    }

    // Auditoria de mudanças
    if (stageChanged) {
      await this.logDealEvent(tenantId, dealId, "stage_changed", operatorId, {
        fromStageId: current.stageId,
        toStageId: updates.stageId,
      });
    }

    if (statusChanged) {
      await this.logDealEvent(tenantId, dealId, "status_changed", operatorId, {
        fromStatus: current.status,
        toStatus: updates.status,
        lossReason: updates.lossReason,
      });
    }

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. VÍNCULOS N:N CONVERSAS ↔ NEGOCIAÇÕES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista negociações ativas vinculadas a uma conversa específica.
   */
  async getConversationDeals(tenantId: string, conversationId: string): Promise<CrmDeal[]> {
    const rows = await db
      .select({
        deal: crmDeals,
      })
      .from(crmConversationDeals)
      .innerJoin(crmDeals, eq(crmConversationDeals.dealId, crmDeals.id))
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          eq(crmConversationDeals.conversationId, conversationId),
          eq(crmConversationDeals.isActive, true)
        )
      )
      .orderBy(desc(crmDeals.lastActivityAt));

    return rows.map((r) => r.deal);
  }

  /**
   * Associa uma negociação existente a uma conversa (idempotente).
   */
  async linkConversationDeal(
    tenantId: string,
    conversationId: string,
    dealId: string,
    operatorId: string | null,
    origin: "chat" | "crm" | "auto_sdr" = "chat"
  ): Promise<CrmConversationDeal> {
    // 1. Valida existência de ambas as entidades no tenant
    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
      .limit(1);

    if (!conv) throw new Error("Conversa não encontrada no tenant.");

    const [deal] = await db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (!deal) throw new Error("Negociação não encontrada no tenant.");

    // 2. Verifica se já está vinculado
    const [existing] = await db
      .select()
      .from(crmConversationDeals)
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          eq(crmConversationDeals.conversationId, conversationId),
          eq(crmConversationDeals.dealId, dealId)
        )
      )
      .limit(1);

    if (existing) {
      if (!existing.isActive) {
        // Reativa vínculo previamente removido
        const [reactivated] = await db
          .update(crmConversationDeals)
          .set({
            isActive: true,
            unlinkedAt: null,
            unlinkedByOperatorId: null,
          })
          .where(and(eq(crmConversationDeals.id, existing.id), eq(crmConversationDeals.tenantId, tenantId)))
          .returning();
        
        await this.logDealEvent(tenantId, dealId, "conversation_linked", operatorId, {
          conversationId,
          reactivated: true,
        });

        return reactivated;
      }
      return existing;
    }

    const id = `cd-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const [created] = await db
      .insert(crmConversationDeals)
      .values({
        id,
        tenantId,
        conversationId,
        dealId,
        origin,
        createdByOperatorId: operatorId,
        isActive: true,
        createdAt: new Date(),
      })
      .returning();

    await this.logDealEvent(tenantId, dealId, "conversation_linked", operatorId, {
      conversationId,
      origin,
    });

    return created;
  }

  /**
   * Desvincula uma conversa de um card sem excluir nenhuma das entidades.
   */
  async unlinkConversationDeal(
    tenantId: string,
    conversationId: string,
    dealId: string,
    operatorId: string | null
  ): Promise<boolean> {
    const result = await db
      .update(crmConversationDeals)
      .set({
        isActive: false,
        unlinkedAt: new Date(),
        unlinkedByOperatorId: operatorId,
      })
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          eq(crmConversationDeals.conversationId, conversationId),
          eq(crmConversationDeals.dealId, dealId),
          eq(crmConversationDeals.isActive, true)
        )
      )
      .returning();

    if (result.length > 0) {
      await this.logDealEvent(tenantId, dealId, "conversation_unlinked", operatorId, {
        conversationId,
      });
      return true;
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. ATIVIDADES, TAREFAS E NOTAS DO DEAL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista atividades/tarefas de uma negociação.
   */
  async getDealActivities(tenantId: string, dealId: string): Promise<CrmDealActivity[]> {
    return db
      .select()
      .from(crmDealActivities)
      .where(and(eq(crmDealActivities.tenantId, tenantId), eq(crmDealActivities.dealId, dealId)))
      .orderBy(asc(crmDealActivities.dueDate), desc(crmDealActivities.createdAt));
  }

  /**
   * Cria uma atividade ou nota comercial vinculada a um card específico.
   */
  async createDealActivity(
    tenantId: string,
    dealId: string,
    operatorId: string | null,
    data: {
      type: "task" | "note" | "call" | "meeting";
      title: string;
      description?: string;
      dueDate?: Date | null;
      conversationId?: string | null;
      assignedToOperatorId?: string | null;
    }
  ): Promise<CrmDealActivity> {
    const id = `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date();

    const [activity] = await db
      .insert(crmDealActivities)
      .values({
        id,
        tenantId,
        dealId,
        conversationId: data.conversationId || null,
        type: data.type,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        status: "pending",
        dueDate: data.dueDate || null,
        operatorId,
        assignedToOperatorId: data.assignedToOperatorId || operatorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Atualiza timestamp de atividade na negociação
    await db
      .update(crmDeals)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)));

    return activity;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5.1. EVIDÊNCIAS DE MENSAGENS EM NEGOCIAÇÕES (crm_activity_messages)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Marca uma mensagem de conversa como evidência comercial de uma negociação.
   */
  async markMessageAsEvidence(
    tenantId: string,
    dealId: string,
    messageId: string,
    operatorId: string | null,
    note?: string,
    activityId?: string
  ): Promise<CrmActivityMessage> {
    // 1. Valida existência do deal no tenant
    const [deal] = await db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (!deal) {
      throw new Error("Negociação não encontrada neste tenant.");
    }

    // 2. Valida existência da mensagem no tenant
    const [msg] = await db
      .select({ id: messages.id, content: messages.content })
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.tenantId, tenantId)))
      .limit(1);

    if (!msg) {
      throw new Error("Mensagem não encontrada neste tenant.");
    }

    // 3. Insere registro de evidência
    const id = `evd-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date();

    const [evidence] = await db
      .insert(crmActivityMessages)
      .values({
        id,
        tenantId,
        dealId,
        messageId,
        activityId: activityId || null,
        markedByOperatorId: operatorId,
        note: note?.trim() || null,
        createdAt: now,
      })
      .returning();

    // 4. Registra auditoria
    await this.logDealEvent(tenantId, dealId, "message_marked_as_evidence", operatorId, {
      messageId,
      evidenceId: id,
      note: note?.trim() || null,
      messagePreview: (msg.content || "").substring(0, 100),
    });

    return evidence;
  }

  /**
   * Remove a marcação de evidência de uma mensagem em uma negociação.
   */
  async unmarkMessageEvidence(
    tenantId: string,
    dealId: string,
    evidenceId: string,
    operatorId: string | null
  ): Promise<boolean> {
    const [deleted] = await db
      .delete(crmActivityMessages)
      .where(
        and(
          eq(crmActivityMessages.id, evidenceId),
          eq(crmActivityMessages.tenantId, tenantId),
          eq(crmActivityMessages.dealId, dealId)
        )
      )
      .returning();

    if (deleted) {
      await this.logDealEvent(tenantId, dealId, "message_evidence_removed", operatorId, {
        evidenceId,
        messageId: deleted.messageId,
      });
      return true;
    }
    return false;
  }

  /**
   * Lista todas as mensagens de evidência de uma negociação.
   */
  async getDealEvidenceMessages(
    tenantId: string,
    dealId: string
  ): Promise<Array<CrmActivityMessage & { message: typeof messages.$inferSelect }>> {
    const raw = await db
      .select({
        evidence: crmActivityMessages,
        message: messages,
      })
      .from(crmActivityMessages)
      .innerJoin(messages, eq(crmActivityMessages.messageId, messages.id))
      .where(
        and(
          eq(crmActivityMessages.tenantId, tenantId),
          eq(crmActivityMessages.dealId, dealId)
        )
      )
      .orderBy(desc(crmActivityMessages.createdAt));

    return raw.map((r) => ({
      ...r.evidence,
      message: r.message,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. CATÁLOGO DE PRODUTOS & SERVIÇOS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista catálogo de produtos/itens com filtro de busca e tenant isolado.
   */
  async getProducts(
    tenantId: string,
    options?: { search?: string; isActive?: boolean }
  ): Promise<CrmProduct[]> {
    const conditions = [eq(crmProducts.tenantId, tenantId)];

    if (options?.isActive !== undefined) {
      conditions.push(eq(crmProducts.isActive, options.isActive));
    }

    if (options?.search) {
      const term = `%${options.search.trim()}%`;
      conditions.push(
        sql`(${crmProducts.name} ILIKE ${term} OR ${crmProducts.sku} ILIKE ${term} OR ${crmProducts.category} ILIKE ${term})`
      );
    }

    return db
      .select()
      .from(crmProducts)
      .where(and(...conditions))
      .orderBy(asc(crmProducts.name));
  }

  /**
   * Cadastra novo produto no catálogo do tenant.
   */
  async createProduct(
    tenantId: string,
    data: {
      name: string;
      sku?: string | null;
      description?: string | null;
      unitPrice?: string | number;
      unit?: string;
      category?: string | null;
      isActive?: boolean;
    }
  ): Promise<CrmProduct> {
    const id = `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();
    const price = typeof data.unitPrice === "number" ? data.unitPrice.toFixed(2) : (data.unitPrice || "0.00");

    const [product] = await db
      .insert(crmProducts)
      .values({
        id,
        tenantId,
        name: data.name.trim(),
        sku: data.sku?.trim() || null,
        description: data.description?.trim() || null,
        unitPrice: price,
        unit: data.unit || "UN",
        category: data.category?.trim() || null,
        isActive: data.isActive !== undefined ? data.isActive : true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return product;
  }

  /**
   * Atualiza informações de produto do catálogo.
   */
  async updateProduct(
    tenantId: string,
    productId: string,
    data: Partial<{
      name: string;
      sku: string | null;
      description: string | null;
      unitPrice: string | number;
      unit: string;
      category: string | null;
      isActive: boolean;
    }>
  ): Promise<CrmProduct> {
    const updates: Record<string, any> = { updatedAt: new Date() };

    if (data.name !== undefined) updates.name = data.name.trim();
    if (data.sku !== undefined) updates.sku = data.sku?.trim() || null;
    if (data.description !== undefined) updates.description = data.description?.trim() || null;
    if (data.unitPrice !== undefined) {
      updates.unitPrice = typeof data.unitPrice === "number" ? data.unitPrice.toFixed(2) : data.unitPrice;
    }
    if (data.unit !== undefined) updates.unit = data.unit;
    if (data.category !== undefined) updates.category = data.category?.trim() || null;
    if (data.isActive !== undefined) updates.isActive = data.isActive;

    const [updated] = await db
      .update(crmProducts)
      .set(updates)
      .where(and(eq(crmProducts.id, productId), eq(crmProducts.tenantId, tenantId)))
      .returning();

    if (!updated) {
      throw new Error(`Produto ${productId} não encontrado para tenant ${tenantId}`);
    }

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. ITENS DA NEGOCIAÇÃO & RECÁLCULO AUTOMÁTICO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista itens de produtos vinculados a uma negociação.
   */
  async getDealProducts(tenantId: string, dealId: string): Promise<CrmDealProduct[]> {
    return db
      .select()
      .from(crmDealProducts)
      .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)))
      .orderBy(asc(crmDealProducts.createdAt));
  }

  /**
   * Recalcula o valor total da negociação com base nos itens cadastrados.
   * Utiliza centavos inteiros para precisão monetária absoluta.
   */
  async recalculateDealValue(
    tenantId: string,
    dealId: string,
    operatorId: string | null,
    executor: any = db
  ): Promise<string> {
    const items = await executor
      .select({ totalPrice: crmDealProducts.totalPrice })
      .from(crmDealProducts)
      .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)));

    const totalCents = items.reduce((acc: number, item: any) => {
      return acc + Math.round((parseFloat(item.totalPrice) || 0) * 100);
    }, 0);

    const formattedValue = (totalCents / 100).toFixed(2);

    const [currentDeal] = await executor
      .select({ value: crmDeals.value })
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (currentDeal && currentDeal.value !== formattedValue) {
      await executor
        .update(crmDeals)
        .set({
          value: formattedValue,
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        })
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)));

      await this.logDealEvent(tenantId, dealId, "value_changed", operatorId, {
        previousValue: currentDeal.value,
        newValue: formattedValue,
        source: "deal_products_recalculation",
      });
    }

    return formattedValue;
  }

  /**
   * Adiciona um produto/item à negociação com execução 100% atômica (transacional),
   * validações comerciais rigorosas e cálculo monetário seguro.
   */
  async addDealProduct(
    tenantId: string,
    dealId: string,
    operatorId: string | null,
    data: {
      productId?: string | null;
      name: string;
      quantity: number | string;
      unitPrice: number | string;
      discountPercent?: number | string;
      notes?: string | null;
    }
  ): Promise<CrmDealProduct> {
    // 1. Validações comerciais estritas
    const name = data.name?.trim();
    if (!name) {
      throw new Error("O nome do produto é obrigatório e não pode ser vazio.");
    }

    const qty = typeof data.quantity === "number" ? data.quantity : parseFloat(String(data.quantity));
    if (isNaN(qty) || qty <= 0 || !isFinite(qty)) {
      throw new Error(`Quantidade inválida: ${data.quantity}. Deve ser um valor numérico estritamente maior que zero.`);
    }

    const price = typeof data.unitPrice === "number" ? data.unitPrice : parseFloat(String(data.unitPrice));
    if (isNaN(price) || price < 0 || !isFinite(price)) {
      throw new Error(`Preço unitário inválido: ${data.unitPrice}. Não pode ser negativo.`);
    }

    const discount = typeof data.discountPercent === "number"
      ? data.discountPercent
      : parseFloat(String(data.discountPercent ?? "0"));
    if (isNaN(discount) || discount < 0 || discount > 100 || !isFinite(discount)) {
      throw new Error(`Desconto percentual inválido: ${data.discountPercent}. Deve estar estritamente entre 0% e 100%.`);
    }

    // Cálculos monetários seguros em centavos (evita imprecisão de floating point)
    const unitPriceCents = Math.round(price * 100);
    const rawTotalCents = Math.round(qty * unitPriceCents);
    const discountFactor = (100 - discount) / 100;
    const discountedTotalCents = Math.max(0, Math.round(rawTotalCents * discountFactor));
    const formattedItemTotal = (discountedTotalCents / 100).toFixed(2);

    // 2. Execução Atômica dentro de Transação
    return await db.transaction(async (tx) => {
      // 2.1. Trava e validação de pertencimento do Deal ao tenant
      const [deal] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .for("update")
        .limit(1);

      if (!deal) {
        throw new Error(`Negociação ${dealId} não encontrada ou não pertence ao tenant ${tenantId}.`);
      }

      // 2.2. Se productId informado, valida pertencimento ao tenant
      if (data.productId) {
        const [prod] = await tx
          .select()
          .from(crmProducts)
          .where(and(eq(crmProducts.id, data.productId), eq(crmProducts.tenantId, tenantId)))
          .limit(1);

        if (!prod) {
          throw new Error(`O produto selecionado (${data.productId}) não pertence ao tenant ${tenantId}.`);
        }
      }

      const id = `dp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date();

      // 2.3. Inserção do Item
      const [inserted] = await tx
        .insert(crmDealProducts)
        .values({
          id,
          tenantId,
          dealId,
          productId: data.productId || null,
          name,
          quantity: qty.toFixed(3),
          unitPrice: (unitPriceCents / 100).toFixed(2),
          discountPercent: discount.toFixed(2),
          totalPrice: formattedItemTotal,
          notes: data.notes?.trim() || null,
          createdAt: now,
        })
        .returning();

      // 2.4. Recálculo atômico do valor total somando todos os itens
      const allItems = await tx
        .select({ totalPrice: crmDealProducts.totalPrice })
        .from(crmDealProducts)
        .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)));

      const totalCentsSum = allItems.reduce((acc: number, item: any) => {
        return acc + Math.round((parseFloat(item.totalPrice) || 0) * 100);
      }, 0);

      const newDealValue = (totalCentsSum / 100).toFixed(2);

      await tx
        .update(crmDeals)
        .set({
          value: newDealValue,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)));

      // 2.5. Auditoria imutável dentro da mesma transação
      await tx.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId,
        eventType: "product_added",
        operatorId,
        metadata: {
          dealProductId: id,
          productId: data.productId || null,
          name: inserted.name,
          quantity: inserted.quantity,
          unitPrice: inserted.unitPrice,
          discountPercent: inserted.discountPercent,
          totalPrice: inserted.totalPrice,
          previousDealValue: deal.value,
          newDealValue,
        },
        createdAt: now,
      });

      return inserted;
    });
  }

  /**
   * Remove item de produto da negociação com execução 100% transacional e atômica.
   */
  async removeDealProduct(
    tenantId: string,
    dealId: string,
    dealProductId: string,
    operatorId: string | null
  ): Promise<boolean> {
    return await db.transaction(async (tx) => {
      // 1. Valida Deal pertencente ao tenant com lock
      const [deal] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .for("update")
        .limit(1);

      if (!deal) {
        throw new Error(`Negociação ${dealId} não encontrada ou não pertence ao tenant ${tenantId}.`);
      }

      // 2. Valida Item pertencente ao Deal e ao Tenant
      const [existing] = await tx
        .select()
        .from(crmDealProducts)
        .where(
          and(
            eq(crmDealProducts.id, dealProductId),
            eq(crmDealProducts.tenantId, tenantId),
            eq(crmDealProducts.dealId, dealId)
          )
        )
        .limit(1);

      if (!existing) {
        return false;
      }

      const now = new Date();

      // 3. Remove o item
      await tx
        .delete(crmDealProducts)
        .where(
          and(
            eq(crmDealProducts.id, dealProductId),
            eq(crmDealProducts.tenantId, tenantId),
            eq(crmDealProducts.dealId, dealId)
          )
        );

      // 4. Recalcula o total restante dos itens
      const remainingItems = await tx
        .select({ totalPrice: crmDealProducts.totalPrice })
        .from(crmDealProducts)
        .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)));

      const totalCentsSum = remainingItems.reduce((acc: number, item: any) => {
        return acc + Math.round((parseFloat(item.totalPrice) || 0) * 100);
      }, 0);

      const newDealValue = (totalCentsSum / 100).toFixed(2);

      await tx
        .update(crmDeals)
        .set({
          value: newDealValue,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)));

      // 5. Auditoria imutável dentro da transação
      await tx.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId,
        eventType: "product_removed",
        operatorId,
        metadata: {
          dealProductId,
          name: existing.name,
          removedTotalPrice: existing.totalPrice,
          previousDealValue: deal.value,
          newDealValue,
        },
        createdAt: now,
      });

      return true;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. PROPOSTAS & ORÇAMENTOS COMERCIAIS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista propostas emitidas para uma negociação.
   */
  async getProposals(tenantId: string, dealId: string): Promise<CrmProposal[]> {
    return db
      .select()
      .from(crmProposals)
      .where(and(eq(crmProposals.tenantId, tenantId), eq(crmProposals.dealId, dealId)))
      .orderBy(desc(crmProposals.createdAt));
  }

  /**
   * Emite uma proposta comercial formal baseada nos itens do deal com numeração segura
   * para concorrência via pg_advisory_xact_lock e snapshot imutável em centavos.
   */
  async createProposal(
    tenantId: string,
    dealId: string,
    operatorId: string | null,
    data: {
      title?: string;
      paymentTerms?: string;
      deliveryTerms?: string;
      validityDays?: number;
      notes?: string;
    }
  ): Promise<CrmProposal> {
    return await db.transaction(async (tx) => {
      // 1. Lock e validação de pertencimento do Deal ao tenant
      const [deal] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .for("update")
        .limit(1);

      if (!deal) {
        throw new Error(`Negociação ${dealId} não encontrada ou não pertence ao tenant ${tenantId}.`);
      }

      // 2. Lock transacional contra race conditions na numeração da proposta
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('crm_proposal_seq_' || ${tenantId}))`);

      const currentYear = new Date().getFullYear();
      const countResult = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(crmProposals)
        .where(
          and(
            eq(crmProposals.tenantId, tenantId),
            sql`extract(year from ${crmProposals.createdAt}) = ${currentYear}`
          )
        );

      const nextSeq = (countResult[0]?.count || 0) + 1;
      const proposalNumber = `PROP-${currentYear}-${String(nextSeq).padStart(4, "0")}`;

      // 3. Obter itens do deal para o snapshot imutável com cálculos em centavos
      const items = await tx
        .select()
        .from(crmDealProducts)
        .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)))
        .orderBy(asc(crmDealProducts.createdAt));

      let subtotalCents = 0;
      let totalDiscountCents = 0;

      const serializedItems = items.map((it) => {
        const q = parseFloat(it.quantity) || 0;
        const up = parseFloat(it.unitPrice) || 0;
        const disc = parseFloat(it.discountPercent) || 0;

        const upCents = Math.round(up * 100);
        const baseCents = Math.round(q * upCents);
        const discCents = Math.round(baseCents * (disc / 100));
        const totalCents = Math.max(0, baseCents - discCents);

        subtotalCents += baseCents;
        totalDiscountCents += discCents;

        return {
          id: it.id,
          productId: it.productId,
          name: it.name,
          quantity: it.quantity,
          unitPrice: (upCents / 100).toFixed(2),
          discountPercent: it.discountPercent,
          totalPrice: (totalCents / 100).toFixed(2),
          notes: it.notes,
        };
      });

      // Se não houver itens cadastrados mas o deal tiver valor, usa o valor do deal como subtotal
      if (serializedItems.length === 0 && parseFloat(deal.value) > 0) {
        const v = parseFloat(deal.value);
        const vCents = Math.round(v * 100);
        subtotalCents = vCents;
        serializedItems.push({
          id: `temp-${Date.now()}`,
          productId: null,
          name: deal.title,
          quantity: "1.000",
          unitPrice: (vCents / 100).toFixed(2),
          discountPercent: "0.00",
          totalPrice: (vCents / 100).toFixed(2),
          notes: null,
        });
      }

      const finalTotalCents = Math.max(0, subtotalCents - totalDiscountCents);

      const validityDays = data.validityDays ? parseInt(String(data.validityDays), 10) : 15;
      if (isNaN(validityDays) || validityDays <= 0) {
        throw new Error("Validade da proposta deve ser um número de dias maior que zero.");
      }

      const id = `prop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date();

      const [proposal] = await tx
        .insert(crmProposals)
        .values({
          id,
          tenantId,
          dealId,
          proposalNumber,
          title: data.title?.trim() || `Proposta Comercial - ${deal.title}`,
          status: "draft",
          subtotal: (subtotalCents / 100).toFixed(2),
          discount: (totalDiscountCents / 100).toFixed(2),
          total: (finalTotalCents / 100).toFixed(2),
          paymentTerms: data.paymentTerms?.trim() || "À vista / Boleto bancário 30 dias",
          deliveryTerms: data.deliveryTerms?.trim() || "FOB - Retirada na fábrica ou frete a combinar",
          validityDays,
          items: serializedItems,
          notes: data.notes?.trim() || null,
          createdOperatorId: operatorId || null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // Auditoria dentro da mesma transação
      await tx.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId,
        eventType: "proposal_created",
        operatorId,
        metadata: {
          proposalId: id,
          proposalNumber,
          total: proposal.total,
        },
        createdAt: now,
      });

      return proposal;
    });
  }

  /**
   * Atualiza status de uma proposta comercial ('draft' | 'copied' | 'sent' | 'accepted' | 'rejected' | 'expired').
   */
  async updateProposalStatus(
    tenantId: string,
    proposalId: string,
    operatorId: string | null,
    status: "draft" | "copied" | "sent" | "accepted" | "rejected" | "expired",
    metadata?: Record<string, any>
  ): Promise<CrmProposal> {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(crmProposals)
        .where(and(eq(crmProposals.id, proposalId), eq(crmProposals.tenantId, tenantId)))
        .for("update")
        .limit(1);

      if (!existing) {
        throw new Error(`Proposta ${proposalId} não encontrada para o tenant ${tenantId}.`);
      }

      const updates: Partial<typeof crmProposals.$inferInsert> = {
        status,
        updatedAt: new Date(),
      };

      if (status === "sent" && !existing.sentAt) {
        updates.sentAt = new Date();
      } else if (status === "accepted" && !existing.acceptedAt) {
        updates.acceptedAt = new Date();
      } else if (status === "rejected" && !existing.rejectedAt) {
        updates.rejectedAt = new Date();
      }

      const [updated] = await tx
        .update(crmProposals)
        .set(updates)
        .where(and(eq(crmProposals.id, proposalId), eq(crmProposals.tenantId, tenantId)))
        .returning();

      await tx.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId: existing.dealId,
        eventType: "proposal_status_changed",
        operatorId,
        metadata: {
          proposalId,
          proposalNumber: existing.proposalNumber,
          previousStatus: existing.status,
          newStatus: status,
          ...(metadata || {}),
        },
        createdAt: new Date(),
      });

      return updated;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. AUDITORIA IMUTÁVEL
  // ═══════════════════════════════════════════════════════════════════════════

  private async logDealEvent(
    tenantId: string,
    dealId: string,
    eventType: string,
    operatorId: string | null,
    metadata: Record<string, any>
  ): Promise<void> {
    try {
      await db.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId,
        eventType,
        fromStageId: metadata.fromStageId || null,
        toStageId: metadata.toStageId || null,
        fromStatus: metadata.fromStatus || null,
        toStatus: metadata.toStatus || null,
        metadata,
        operatorId,
        createdAt: new Date(),
      });
    } catch (e: any) {
      console.warn(`[CrmService] Falha ao registrar evento de auditoria para deal ${dealId}:`, e.message);
    }
  }
}

export const crmService = CrmService.getInstance();
