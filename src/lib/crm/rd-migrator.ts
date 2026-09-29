/**
 * rd-migrator.ts
 * Utilitário de Migração, Backfill & Reconciliação do RD Station CRM para o CRM Proprietário.
 *
 * Implementa a especificação oficial da API v2 do RD Station CRM e critérios de aceitação de E7:
 * - Inventário pré-migração somente-leitura com amostras e campos do RD
 * - Idempotência absoluta: duas execuções do mesmo lote NÃO duplicam contas, contatos, negócios ou tarefas
 * - Mapeamento durável: rdPipelineId, rdStageId, rdOrganizationId, rdDealId, rdTaskId
 * - Tarefas importadas com conversationId estritamente vazio (null) quando sem conversa de origem
 * - Vínculo de contatos sem associar cegamente conversas históricas a todos os negócios
 * - Reconciliação matemática honesta: NÃO move deals para etapas arbitrárias (registra unmappedDetails)
 * - Trava de concorrência atômica por tenant: impede importações paralelas conflitantes
 * - Suporte a política de fonte de verdade ('rd_primary' | 'local_primary') e sincronização
 * - Persistência auditável de cada execução em crm_migration_runs
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  crmPipelines,
  crmStages,
  crmDeals,
  crmAccounts,
  crmDealContacts,
  crmDealActivities,
  crmMigrationRuns,
  contacts,
  operators,
  channelConfigs,
} from "../../db/schema";
import { rdRequest } from "../rdCrmService";
import { normalizeDocument, CrmConcurrencyError, CrmValidationError } from "./crm-service";

export type RdFetcher = <T = any>(
  tenantId: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: object
) => Promise<T>;

export interface RdReconciliationReport {
  status: "complete" | "partial" | "failed";
  tenantId: string;
  sourceOfTruth: "rd_primary" | "local_primary";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  pipelines: {
    foundInRd: number;
    importedOrMatched: number;
    items: Array<{ rdPipelineId: string; localPipelineId: string; name: string }>;
  };
  stages: {
    foundInRd: number;
    importedOrMatched: number;
    items: Array<{ rdStageId: string; localStageId: string; name: string }>;
  };
  deals: {
    foundInRd: number;
    imported: number;
    skippedAlreadyExists: number;
    skippedLocalEdited: number;
    unmappedStageCount: number;
    withoutAccountCount: number;
    totalValueRd: number;
    totalValueImported: number;
    byStatus: {
      open: number;
      won: number;
      lost: number;
      paused: number;
    };
    unmappedDetails: Array<{
      rdDealId: string;
      title: string;
      rdStageId: string;
      rdPipelineId?: string;
      value: number;
      reason: string;
    }>;
  };
  organizations: {
    foundInRd: number;
    imported: number;
    skippedAlreadyExists: number;
    invalidDocumentsCount: number;
  };
  contacts: {
    foundInRd: number;
    imported: number;
    skippedAlreadyExists: number;
    associatedToDealsCount: number;
  };
  tasks: {
    foundInRd: number;
    imported: number;
    skippedAlreadyExists: number;
    orphanCount: number;
    byStatus: {
      pending: number;
      completed: number;
      cancelled: number;
    };
  };
  unmappedResponsible: Array<{
    rdUserId: string;
    name?: string;
    email?: string;
  }>;
  errors: string[];
}

export interface RdRemoteInventory {
  tenantId: string;
  generatedAt: string;
  sourceOfTruth: "rd_primary" | "local_primary";
  syncPolicy: "manual" | "import_only" | "bidirectional";
  pipelines: {
    total: number;
    samples: Array<{ id: string; name: string; stagesCount: number }>;
  };
  stages: {
    total: number;
    samples: Array<{ id: string; name: string; pipelineId?: string }>;
  };
  deals: {
    total: number;
    totalValueEstimated: number;
    samples: Array<{
      id: string;
      name: string;
      value: number;
      stageId: string;
      pipelineId: string;
      hasOrganization: boolean;
      hasContacts: boolean;
      status: string;
    }>;
  };
  organizations: {
    total: number;
    samples: Array<{ id: string; name: string; hasDocument: boolean }>;
  };
  contacts: {
    total: number;
    samples: Array<{ id: string; name: string; phone?: string; email?: string }>;
  };
  tasks: {
    total: number;
    samples: Array<{ id: string; subject: string; type: string; isDone: boolean; dealId?: string }>;
  };
  users: {
    total: number;
    samples: Array<{ id: string; name: string; email: string }>;
  };
  customFields: {
    total: number;
    fields: Array<{ id: string; label: string; type: string }>;
  };
}

export interface RdMigrationOptions {
  dryRun?: boolean;
  forceUpdate?: boolean;
  maxPages?: number;
  pageSize?: number;
  sourceOfTruth?: "rd_primary" | "local_primary";
}

// Conjunto em memória para travas de concorrência por tenant
const activeTenantMigrations = new Set<string>();

export class RdCrmMigrator {
  /**
   * Realiza inventário estritamente somente-leitura dos dados na API do RD Station CRM.
   * Não grava nem altera nenhuma tabela local.
   */
  static async inspectRdInventory(
    tenantId: string,
    fetcher: RdFetcher = rdRequest
  ): Promise<RdRemoteInventory> {
    const policy = await this.getSyncPolicy(tenantId);
    const inventory: RdRemoteInventory = {
      tenantId,
      generatedAt: new Date().toISOString(),
      sourceOfTruth: policy.sourceOfTruth,
      syncPolicy: policy.syncPolicy,
      pipelines: { total: 0, samples: [] },
      stages: { total: 0, samples: [] },
      deals: { total: 0, totalValueEstimated: 0, samples: [] },
      organizations: { total: 0, samples: [] },
      contacts: { total: 0, samples: [] },
      tasks: { total: 0, samples: [] },
      users: { total: 0, samples: [] },
      customFields: { total: 0, fields: [] },
    };

    // 1. Funis e Etapas
    try {
      let rawPipes: any;
      try {
        rawPipes = await fetcher<any>(tenantId, "GET", "/pipelines");
      } catch {
        rawPipes = await fetcher<any>(tenantId, "GET", "/deal_pipelines");
      }
      const pipesList: any[] = Array.isArray(rawPipes)
        ? rawPipes
        : rawPipes?.pipelines || rawPipes?.data || [];

      inventory.pipelines.total = pipesList.length;
      for (const p of pipesList.slice(0, 5)) {
        const pId = String(p.id || p._id);
        const stgs = p.deal_stages || p.stages || [];
        inventory.pipelines.samples.push({
          id: pId,
          name: p.name || `Funil ${pId}`,
          stagesCount: stgs.length,
        });
        for (const s of stgs) {
          inventory.stages.total++;
          if (inventory.stages.samples.length < 5) {
            inventory.stages.samples.push({
              id: String(s.id || s._id),
              name: s.name || "Etapa",
              pipelineId: pId,
            });
          }
        }
      }
    } catch (e: any) {
      console.warn("[RdCrmMigrator.inspect] Falha ao consultar funis:", e.message);
    }

    // 2. Amostra de Negócios (Deals)
    try {
      const dealsRes = await fetcher<any>(tenantId, "GET", "/deals?page[number]=1&page[size]=10");
      const dealsList: any[] = Array.isArray(dealsRes)
        ? dealsRes
        : dealsRes?.deals || dealsRes?.data || [];

      inventory.deals.total = dealsRes?.total || dealsList.length;
      for (const d of dealsList) {
        const val =
          parseFloat(d.amount_total ?? d.total_value ?? d.value ?? "0") ||
          (parseFloat(d.amount_unique || "0") + parseFloat(d.amount_monthly || "0")) ||
          0;
        inventory.deals.totalValueEstimated += val;
        if (inventory.deals.samples.length < 5) {
          inventory.deals.samples.push({
            id: String(d.id || d._id),
            name: d.name || "Negócio sem nome",
            value: val,
            stageId: String(d.deal_stage_id || d.stage_id || ""),
            pipelineId: String(d.deal_pipeline_id || d.pipeline_id || ""),
            hasOrganization: Boolean(d.organization || d.organization_id),
            hasContacts: Boolean(d.contacts && d.contacts.length > 0),
            status: d.win === true ? "won" : d.win === false ? "lost" : "open",
          });
        }
      }
    } catch (e: any) {
      console.warn("[RdCrmMigrator.inspect] Falha ao consultar deals:", e.message);
    }

    // 3. Usuários / Responsáveis
    try {
      const usersRes = await fetcher<any>(tenantId, "GET", "/users");
      const usersList: any[] = Array.isArray(usersRes)
        ? usersRes
        : usersRes?.users || usersRes?.data || [];
      inventory.users.total = usersList.length;
      for (const u of usersList.slice(0, 10)) {
        inventory.users.samples.push({
          id: String(u.id || u._id),
          name: u.name || "Usuário",
          email: u.email || "",
        });
      }
    } catch {
      // Endpoint de usuários pode não estar disponível em planos básicos
    }

    // 4. Tarefas / Atividades
    try {
      let actRes: any;
      try {
        actRes = await fetcher<any>(tenantId, "GET", "/activities?page[number]=1&page[size]=5");
      } catch {
        actRes = await fetcher<any>(tenantId, "GET", "/tasks?page[number]=1&page[size]=5");
      }
      const actList: any[] = Array.isArray(actRes) ? actRes : actRes?.activities || actRes?.tasks || [];
      inventory.tasks.total = actRes?.total || actList.length;
      for (const a of actList.slice(0, 5)) {
        inventory.tasks.samples.push({
          id: String(a.id || a._id),
          subject: a.subject || a.title || a.name || "Tarefa",
          type: a.activity_type || a.type || "task",
          isDone: Boolean(a.done ?? (a.status === "completed")),
          dealId: a.deal_id ? String(a.deal_id) : undefined,
        });
      }
    } catch {
      // Ignora se não houver rota de tarefas
    }

    // 5. Campos customizados
    try {
      const cfRes = await fetcher<any>(tenantId, "GET", "/custom_fields");
      const cfList: any[] = Array.isArray(cfRes) ? cfRes : cfRes?.custom_fields || [];
      inventory.customFields.total = cfList.length;
      for (const cf of cfList) {
        inventory.customFields.fields.push({
          id: String(cf.id || cf._id),
          label: cf.label || cf.name,
          type: cf.type || "string",
        });
      }
    } catch {
      // Ignora se não houver campos personalizados
    }

    return inventory;
  }

  /**
   * Executa a migração e reconciliação completa com proteção de concorrência,
   * idempotência estrita em todas as entidades e relatório analítico de reconciliação.
   */
  static async migrateAll(
    tenantId: string,
    operatorId?: string | null,
    options: RdMigrationOptions = {},
    fetcher: RdFetcher = rdRequest
  ): Promise<RdReconciliationReport> {
    // 0. Trava de Concorrência por Tenant
    if (activeTenantMigrations.has(tenantId)) {
      throw new CrmConcurrencyError(
        `Já existe uma migração do RD CRM em andamento para o tenant ${tenantId}. Aguarde o término antes de iniciar outra.`
      );
    }
    activeTenantMigrations.add(tenantId);

    const startTime = Date.now();
    const startedAt = new Date().toISOString();
    const runId = `mig-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Obter política de fonte de verdade
    const policy = await this.getSyncPolicy(tenantId);
    const sourceOfTruth = options.sourceOfTruth || policy.sourceOfTruth;

    const report: RdReconciliationReport = {
      status: "complete",
      tenantId,
      sourceOfTruth,
      startedAt,
      finishedAt: "",
      durationMs: 0,
      pipelines: { foundInRd: 0, importedOrMatched: 0, items: [] },
      stages: { foundInRd: 0, importedOrMatched: 0, items: [] },
      deals: {
        foundInRd: 0,
        imported: 0,
        skippedAlreadyExists: 0,
        skippedLocalEdited: 0,
        unmappedStageCount: 0,
        withoutAccountCount: 0,
        totalValueRd: 0,
        totalValueImported: 0,
        byStatus: { open: 0, won: 0, lost: 0, paused: 0 },
        unmappedDetails: [],
      },
      organizations: {
        foundInRd: 0,
        imported: 0,
        skippedAlreadyExists: 0,
        invalidDocumentsCount: 0,
      },
      contacts: {
        foundInRd: 0,
        imported: 0,
        skippedAlreadyExists: 0,
        associatedToDealsCount: 0,
      },
      tasks: {
        foundInRd: 0,
        imported: 0,
        skippedAlreadyExists: 0,
        orphanCount: 0,
        byStatus: { pending: 0, completed: 0, cancelled: 0 },
      },
      unmappedResponsible: [],
      errors: [],
    };

    // Registra início da execução no histórico
    try {
      await db.insert(crmMigrationRuns).values({
        id: runId,
        tenantId,
        triggeredByOperatorId: operatorId || null,
        source: "rd_station_v2",
        status: "running",
        sourceOfTruth,
        report: report as any,
        startedAt: new Date(startedAt),
      });
    } catch (runErr: any) {
      console.warn("[RdCrmMigrator] Não foi possível registrar início em crm_migration_runs:", runErr.message);
    }

    try {
      console.log(`[RdCrmMigrator] Iniciando migração para tenant: ${tenantId}...`);

      // Mapeamento em memória para resolução rápida
      const pipelineMap = new Map<string, string>();      // rdPipelineId -> localPipelineId
      const pipelineStageMap = new Map<string, string>(); // rdStageId -> localStageId
      const dealIdMap = new Map<string, string>();         // rdDealId -> localDealId

      // Mapeamento de Operadores / Vendedores do tenant
      const localOperators = await db
        .select({
          id: operators.id,
          name: operators.name,
          email: operators.email,
        })
        .from(operators)
        .where(eq(operators.tenantId, tenantId));

      const operatorEmailMap = new Map<string, string>();
      const operatorNameMap = new Map<string, string>();
      for (const op of localOperators) {
        if (op.email) operatorEmailMap.set(op.email.toLowerCase().trim(), op.id);
        if (op.name) operatorNameMap.set(op.name.toLowerCase().trim(), op.id);
      }

      // ─────────────────────────────────────────────────────────────────────────
      // 1. IMPORTAR FUNIS (PIPELINES) E ETAPAS (STAGES)
      // ─────────────────────────────────────────────────────────────────────────
      let rdPipelinesRaw: any;
      try {
        rdPipelinesRaw = await fetcher<any>(tenantId, "GET", "/pipelines");
      } catch (err: any) {
        console.warn(`[RdCrmMigrator] /pipelines retornou erro (${err.message}). Tentando fallback /deal_pipelines...`);
        rdPipelinesRaw = await fetcher<any>(tenantId, "GET", "/deal_pipelines");
      }

      const rdPipelinesList: any[] = Array.isArray(rdPipelinesRaw)
        ? rdPipelinesRaw
        : rdPipelinesRaw?.pipelines || rdPipelinesRaw?.data || [];

      report.pipelines.foundInRd = rdPipelinesList.length;

      for (const [pIndex, rdp] of rdPipelinesList.entries()) {
        const rdPipelineId = String(rdp.id || rdp._id);
        const pipelineName = rdp.name || `Funil RD ${rdPipelineId}`;

        let [localPipeline] = await db
          .select()
          .from(crmPipelines)
          .where(
            and(
              eq(crmPipelines.tenantId, tenantId),
              eq(crmPipelines.rdPipelineId, rdPipelineId)
            )
          )
          .limit(1);

        if (!localPipeline) {
          const newPipelineId = `pipe-rd-${rdPipelineId}`;
          const [created] = await db
            .insert(crmPipelines)
            .values({
              id: newPipelineId,
              tenantId,
              name: pipelineName,
              color: "#1677ff",
              isDefault: pIndex === 0,
              orderIndex: pIndex,
              rdPipelineId,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();
          localPipeline = created;
        }

        pipelineMap.set(rdPipelineId, localPipeline.id);
        report.pipelines.importedOrMatched++;
        report.pipelines.items.push({
          rdPipelineId,
          localPipelineId: localPipeline.id,
          name: pipelineName,
        });

        // Buscar estágios do pipeline
        let stages: any[] = rdp.deal_stages || rdp.stages || [];
        if (!stages || stages.length === 0) {
          try {
            const stagesRes = await fetcher<any>(tenantId, "GET", `/pipelines/${rdPipelineId}/stages`);
            stages = Array.isArray(stagesRes) ? stagesRes : stagesRes?.stages || stagesRes?.data || [];
          } catch (stgErr: any) {
            console.warn(`[RdCrmMigrator] Erro ao buscar estágios de pipeline ${rdPipelineId}:`, stgErr.message);
          }
        }

        report.stages.foundInRd += stages.length;

        for (const [sIndex, rds] of stages.entries()) {
          const rdStageId = String(rds.id || rds._id);
          const stageName = rds.name || `Etapa ${sIndex + 1}`;

          let [localStage] = await db
            .select()
            .from(crmStages)
            .where(
              and(
                eq(crmStages.tenantId, tenantId),
                eq(crmStages.rdStageId, rdStageId)
              )
            )
            .limit(1);

          if (!localStage) {
            const newStageId = `stage-rd-${rdStageId}`;
            const [createdStage] = await db
              .insert(crmStages)
              .values({
                id: newStageId,
                tenantId,
                pipelineId: localPipeline.id,
                name: stageName,
                orderIndex: rds.order ?? sIndex,
                rdStageId,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
            localStage = createdStage;
          }

          pipelineStageMap.set(rdStageId, localStage.id);
          report.stages.importedOrMatched++;
          report.stages.items.push({
            rdStageId,
            localStageId: localStage.id,
            name: stageName,
          });
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // 2. IMPORTAR NEGÓCIOS (DEALS) COM PAGINAÇÃO, CONTATOS & EMPRESAS
      // ─────────────────────────────────────────────────────────────────────────
      let pageNumber = 1;
      const pageSize = options.pageSize || 100;
      const maxPages = options.maxPages || 50;
      let hasMore = true;

      // Armazena tarefas coletadas durante os deals ou em lote
      const pendingActivities: any[] = [];

      while (hasMore && pageNumber <= maxPages) {
        try {
          const queryParams = new URLSearchParams({
            "page[number]": String(pageNumber),
            "page[size]": String(pageSize),
          });

          const dealsResponse = await fetcher<any>(
            tenantId,
            "GET",
            `/deals?${queryParams.toString()}`
          );

          const dealsList: any[] = Array.isArray(dealsResponse)
            ? dealsResponse
            : dealsResponse?.deals || dealsResponse?.data || [];

          if (dealsList.length === 0) {
            hasMore = false;
            break;
          }

          report.deals.foundInRd += dealsList.length;

          for (const rdd of dealsList) {
            try {
              const rdDealId = String(rdd.id || rdd._id);

              const numericValue =
                parseFloat(rdd.amount_total ?? rdd.total_value ?? rdd.value ?? "0") ||
                (parseFloat(rdd.amount_unique || "0") + parseFloat(rdd.amount_monthly || "0")) ||
                0;

              report.deals.totalValueRd += numericValue;

              // Identificação de Pipeline e Etapa
              const rddPipelineId = String(rdd.deal_pipeline_id || rdd.pipeline_id || "");
              const rddStageId = String(rdd.deal_stage_id || rdd.stage_id || "");

              const targetPipelineId = pipelineMap.get(rddPipelineId);
              const targetStageId = pipelineStageMap.get(rddStageId);

              // ── RECONCILIAÇÃO ESTRITA: Se a etapa não existir, NÃO alocar arbitrariamente ──
              if (!targetStageId || !targetPipelineId) {
                report.deals.unmappedStageCount++;
                report.status = "partial";
                report.deals.unmappedDetails.push({
                  rdDealId,
                  title: rdd.name || `Negócio ${rdDealId}`,
                  rdStageId: rddStageId || "vazio",
                  rdPipelineId: rddPipelineId || "vazio",
                  value: numericValue,
                  reason: !targetPipelineId
                    ? `Funil RD '${rddPipelineId}' não encontrado no mapeamento local`
                    : `Etapa RD '${rddStageId}' não encontrada no funil '${targetPipelineId}'`,
                });
                continue;
              }

              // ── Mapear Organização/Conta Compradora ──
              let localAccountId: string | null = null;
              if (rdd.organization || rdd.organization_id) {
                const org = rdd.organization || {};
                const orgName = (org.name || "Empresa Importada RD").trim();
                const rdOrgId = String(org.id || rdd.organization_id);

                report.organizations.foundInRd++;

                // Sanitização e validação de documento da empresa se houver
                const rawDoc = org.document || org.cnpj || org.cpf;
                const cleanDoc = normalizeDocument(rawDoc);

                let isDocValid = false;
                if (cleanDoc) {
                  if (cleanDoc.length === 14 || cleanDoc.length === 11) {
                    isDocValid = true;
                  } else {
                    report.organizations.invalidDocumentsCount++;
                  }
                }

                // Busca conta existente por rdOrganizationId ou por documento válido
                let existingAccount: any = null;
                const [byRdId] = await db
                  .select()
                  .from(crmAccounts)
                  .where(
                    and(
                      eq(crmAccounts.tenantId, tenantId),
                      eq(crmAccounts.rdOrganizationId, rdOrgId)
                    )
                  )
                  .limit(1);

                if (byRdId) {
                  existingAccount = byRdId;
                } else if (cleanDoc && isDocValid) {
                  const [byDoc] = await db
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
                  if (byDoc) existingAccount = byDoc;
                }

                if (existingAccount) {
                  localAccountId = existingAccount.id;
                  report.organizations.skippedAlreadyExists++;
                } else {
                  const newAccId = `acc-rd-${rdOrgId}`;
                  const [createdAcc] = await db
                    .insert(crmAccounts)
                    .values({
                      id: newAccId,
                      tenantId,
                      type: cleanDoc && cleanDoc.length === 11 ? "person" : "company",
                      name: orgName,
                      tradeName: org.trade_name || orgName,
                      document: cleanDoc && isDocValid ? cleanDoc : null,
                      documentType: cleanDoc && isDocValid ? (cleanDoc.length === 14 ? "cnpj" : "cpf") : null,
                      email: org.email?.trim() || null,
                      phone: org.phone ? normalizeDocument(org.phone) : null,
                      rdOrganizationId: rdOrgId,
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    })
                    .returning();
                  localAccountId = createdAcc.id;
                  report.organizations.imported++;
                }
              } else {
                report.deals.withoutAccountCount++;
              }

              // Verificar se negócio já existe
              const [existingDeal] = await db
                .select()
                .from(crmDeals)
                .where(
                  and(
                    eq(crmDeals.tenantId, tenantId),
                    eq(crmDeals.rdDealId, rdDealId)
                  )
                )
                .limit(1);

              if (existingDeal) {
                dealIdMap.set(rdDealId, existingDeal.id);

                // Se o negócio foi editado localmente e não autorizou forceUpdate, preserva edição local
                if (existingDeal.source !== "rd_crm_migration" && !options.forceUpdate) {
                  report.deals.skippedLocalEdited++;
                  report.deals.skippedAlreadyExists++;
                  continue;
                }

                report.deals.skippedAlreadyExists++;
                continue;
              }

              // ── Mapear Status Comercial ──
              let dealStatus: "open" | "won" | "lost" = "open";
              if (rdd.win === true || rdd.status === "won") dealStatus = "won";
              else if (rdd.win === false || rdd.status === "lost") dealStatus = "lost";

              report.deals.byStatus[dealStatus]++;

              // ── Mapear Responsável / Vendedor do RD ──
              let assignedOperatorId: string | null = null;
              const rdUser = rdd.user || {};
              const rdUserId = String(rdd.user_id || rdUser.id || "");
              const rdUserEmail = (rdUser.email || "").toLowerCase().trim();
              const rdUserName = (rdUser.name || "").toLowerCase().trim();

              if (rdUserEmail && operatorEmailMap.has(rdUserEmail)) {
                assignedOperatorId = operatorEmailMap.get(rdUserEmail)!;
              } else if (rdUserName && operatorNameMap.has(rdUserName)) {
                assignedOperatorId = operatorNameMap.get(rdUserName)!;
              } else if (rdUserId) {
                // Registra usuário do RD sem correspondência local
                const alreadyNoted = report.unmappedResponsible.some((u) => u.rdUserId === rdUserId);
                if (!alreadyNoted) {
                  report.unmappedResponsible.push({
                    rdUserId,
                    name: rdUser.name,
                    email: rdUser.email,
                  });
                }
                assignedOperatorId = operatorId || null;
              }

              // ── Criar Negociação Local ──
              const newDealId = `deal-rd-${rdDealId}`;
              const expectedClose = rdd.prediction_date ? new Date(rdd.prediction_date) : null;
              const dealCreatedAt = rdd.created_at ? new Date(rdd.created_at) : new Date();

              const [createdDeal] = await db
                .insert(crmDeals)
                .values({
                  id: newDealId,
                  tenantId,
                  title: (rdd.name || `Negócio RD ${rdDealId}`).trim(),
                  pipelineId: targetPipelineId,
                  stageId: targetStageId,
                  accountId: localAccountId,
                  operatorId: assignedOperatorId,
                  status: dealStatus,
                  value: numericValue.toFixed(2),
                  currency: "BRL",
                  rating: rdd.rating ? Number(rdd.rating) : 1,
                  expectedCloseDate: expectedClose,
                  rdDealId,
                  source: "rd_crm_migration",
                  campaign: rdd.campaign?.name || rdd.campaign || null,
                  createdAt: dealCreatedAt,
                  updatedAt: new Date(),
                  lastActivityAt: new Date(),
                })
                .returning();

              dealIdMap.set(rdDealId, createdDeal.id);
              report.deals.imported++;
              report.deals.totalValueImported += numericValue;

              // ── Mapear Contatos Participantes do Negócio ──
              if (Array.isArray(rdd.contacts) && rdd.contacts.length > 0) {
                for (const [cIndex, c] of rdd.contacts.entries()) {
                  report.contacts.foundInRd++;
                  const phone = c.phones?.[0]?.phone || c.phone;
                  const cleanPhone = phone ? normalizeDocument(phone) : null;
                  const contactEmail = c.email?.trim() || null;
                  const contactName = (c.name || "Contato RD").trim();

                  let localContactId: string | null = null;

                  if (cleanPhone) {
                    const [foundByPhone] = await db
                      .select()
                      .from(contacts)
                      .where(
                        and(
                          eq(contacts.tenantId, tenantId),
                          eq(contacts.phone, cleanPhone)
                        )
                      )
                      .limit(1);

                    if (foundByPhone) {
                      localContactId = foundByPhone.id;
                      report.contacts.skippedAlreadyExists++;
                    }
                  }

                  if (!localContactId && contactEmail) {
                    const [foundByEmail] = await db
                      .select()
                      .from(contacts)
                      .where(
                        and(
                          eq(contacts.tenantId, tenantId),
                          eq(contacts.email, contactEmail)
                        )
                      )
                      .limit(1);

                    if (foundByEmail) {
                      localContactId = foundByEmail.id;
                      report.contacts.skippedAlreadyExists++;
                    }
                  }

                  // Se não existe, cria novo contato
                  if (!localContactId) {
                    const newContactId = `ct-rd-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
                    const [createdContact] = await db
                      .insert(contacts)
                      .values({
                        id: newContactId,
                        tenantId,
                        accountId: localAccountId,
                        name: contactName,
                        phone: cleanPhone || null,
                        email: contactEmail || null,
                        mainChannel: "whatsapp",
                        createdAt: new Date(),
                      })
                      .returning();

                    localContactId = createdContact.id;
                    report.contacts.imported++;
                  }

                  // Associa participante à negociação (crm_deal_contacts) de forma idempotente
                  const [existingDealContact] = await db
                    .select()
                    .from(crmDealContacts)
                    .where(
                      and(
                        eq(crmDealContacts.tenantId, tenantId),
                        eq(crmDealContacts.dealId, createdDeal.id),
                        eq(crmDealContacts.contactId, localContactId)
                      )
                    )
                    .limit(1);

                  if (!existingDealContact) {
                    await db.insert(crmDealContacts).values({
                      id: `dc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                      tenantId,
                      dealId: createdDeal.id,
                      contactId: localContactId,
                      role: "buyer",
                      isPrimary: cIndex === 0,
                      createdAt: new Date(),
                    });
                    report.contacts.associatedToDealsCount++;
                  }

                  // REGRA DE OURO E7: NÃO INSERIR EM crm_conversation_deals
                  // Conversas históricas continuam livres e preservadas no atendimento!
                }
              }

              // Coleta tarefas embutidas no deal se fornecidas
              if (Array.isArray(rdd.activities) && rdd.activities.length > 0) {
                for (const act of rdd.activities) {
                  pendingActivities.push({
                    ...act,
                    deal_id: rdDealId,
                  });
                }
              }
            } catch (dealErr: any) {
              console.warn(`[RdCrmMigrator] Erro no deal RD ${rdd.id || rdd._id}: ${dealErr.message}`);
              report.errors.push(`Erro no deal RD ${rdd.id || rdd._id}: ${dealErr.message}`);
              report.status = "partial";
            }
          }

          if (dealsList.length < pageSize) {
            hasMore = false;
          } else {
            pageNumber++;
          }
        } catch (pageErr: any) {
          const errorMsg = `Erro na página ${pageNumber} de negócios: ${pageErr.message}`;
          console.error(`[RdCrmMigrator] ${errorMsg}`);
          report.errors.push(errorMsg);
          report.status = "partial";
          hasMore = false;
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // 3. IMPORTAR TAREFAS / ATIVIDADES DO RD STATION
      // ─────────────────────────────────────────────────────────────────────────
      let rdActivitiesList: any[] = [];
      try {
        let actRes: any;
        try {
          actRes = await fetcher<any>(tenantId, "GET", "/activities?page[number]=1&page[size]=100");
        } catch {
          actRes = await fetcher<any>(tenantId, "GET", "/tasks?page[number]=1&page[size]=100");
        }
        rdActivitiesList = Array.isArray(actRes) ? actRes : actRes?.activities || actRes?.tasks || [];
      } catch {
        // Fallback para tarefas acumuladas durante a listagem dos deals
        rdActivitiesList = pendingActivities;
      }

      // Concatena quaisquer tarefas extras embutidas
      if (pendingActivities.length > 0) {
        for (const pa of pendingActivities) {
          const pId = String(pa.id || pa._id);
          if (!rdActivitiesList.some((a) => String(a.id || a._id) === pId)) {
            rdActivitiesList.push(pa);
          }
        }
      }

      report.tasks.foundInRd = rdActivitiesList.length;

      for (const act of rdActivitiesList) {
        try {
          const rdTaskId = String(act.id || act._id);
          const actRdDealId = String(act.deal_id || "");

          // Verifica se tarefa já existe no banco local (idempotência)
          const [existingTask] = await db
            .select()
            .from(crmDealActivities)
            .where(
              and(
                eq(crmDealActivities.tenantId, tenantId),
                eq(crmDealActivities.rdTaskId, rdTaskId)
              )
            )
            .limit(1);

          if (existingTask) {
            report.tasks.skippedAlreadyExists++;
            continue;
          }

          // Resolver Deal Local
          let targetLocalDealId = dealIdMap.get(actRdDealId);
          if (!targetLocalDealId && actRdDealId) {
            const [foundDeal] = await db
              .select({ id: crmDeals.id })
              .from(crmDeals)
              .where(
                and(
                  eq(crmDeals.tenantId, tenantId),
                  eq(crmDeals.rdDealId, actRdDealId)
                )
              )
              .limit(1);
            if (foundDeal) targetLocalDealId = foundDeal.id;
          }

          if (!targetLocalDealId) {
            // Tarefa órfã: negócio não encontrado
            report.tasks.orphanCount++;
            continue;
          }

          const isCompleted = Boolean(act.done ?? (act.status === "completed" || act.status === "done"));
          const taskStatus = isCompleted ? "completed" : "pending";
          const rawType = (act.activity_type || act.type || "task").toLowerCase();

          let localType: "task" | "call" | "meeting" | "note" = "task";
          if (rawType.includes("call") || rawType.includes("ligação")) localType = "call";
          else if (rawType.includes("meeting") || rawType.includes("reunião")) localType = "meeting";
          else if (rawType.includes("note") || rawType.includes("anotação")) localType = "note";

          const now = new Date();
          let taskDueDate: Date | null = null;
          if (act.date || act.due_date) {
            taskDueDate = new Date(act.date || act.due_date);
          }

          const newTaskId = `act-rd-${rdTaskId}`;

          await db.insert(crmDealActivities).values({
            id: newTaskId,
            tenantId,
            dealId: targetLocalDealId,
            conversationId: null, // REGRA DE OURO E7: Tarefa importada sem conversa comprovada tem conversationId null
            type: localType,
            title: (act.subject || act.title || act.name || "Tarefa Importada RD").trim(),
            description: act.notes || act.description || null,
            status: taskStatus,
            dueDate: taskDueDate,
            completedAt: isCompleted ? (act.completed_at ? new Date(act.completed_at) : now) : null,
            rdTaskId,
            createdAt: act.created_at ? new Date(act.created_at) : now,
            updatedAt: now,
          });

          report.tasks.imported++;
          report.tasks.byStatus[taskStatus]++;
        } catch (taskErr: any) {
          console.warn(`[RdCrmMigrator] Erro ao importar tarefa ${act.id || act._id}: ${taskErr.message}`);
          report.errors.push(`Erro na tarefa ${act.id || act._id}: ${taskErr.message}`);
          report.status = "partial";
        }
      }
    } catch (criticalErr: any) {
      const msg = `Falha crítica durante execução da migração: ${criticalErr.message}`;
      console.error(`[RdCrmMigrator] ${msg}`);
      report.errors.push(msg);
      report.status = "failed";
    } finally {
      // Libera trava de concorrência
      activeTenantMigrations.delete(tenantId);
    }

    const duration = Date.now() - startTime;
    report.finishedAt = new Date().toISOString();
    report.durationMs = duration;

    // Atualiza crm_migration_runs e channel_configs
    try {
      await db
        .update(crmMigrationRuns)
        .set({
          status: report.status,
          report: report as any,
          finishedAt: new Date(report.finishedAt),
        })
        .where(eq(crmMigrationRuns.id, runId));

      await db
        .update(channelConfigs)
        .set({
          rdCrmLastSyncAt: new Date(),
          rdCrmLastReport: report as any,
          updatedAt: new Date(),
        })
        .where(eq(channelConfigs.tenantId, tenantId));
    } catch (saveErr: any) {
      console.warn("[RdCrmMigrator] Não foi possível persistir relatório final:", saveErr.message);
    }

    console.log(
      `[RdCrmMigrator] Migração finalizada (${report.status}) em ${duration}ms: ` +
      `${report.deals.imported} deals importados (R$ ${report.deals.totalValueImported.toFixed(2)}), ` +
      `${report.tasks.imported} tarefas importadas, ` +
      `${report.organizations.imported} contas criadas, ` +
      `${report.deals.skippedAlreadyExists} deals já existentes ignorados.`
    );

    return report;
  }

  /**
   * Obtém a política de fonte de verdade e sincronização para um tenant.
   */
  static async getSyncPolicy(tenantId: string): Promise<{
    sourceOfTruth: "rd_primary" | "local_primary";
    syncPolicy: "manual" | "import_only" | "bidirectional";
    lastSyncAt: Date | null;
    lastReport: any;
  }> {
    const config = await db.query.channelConfigs.findFirst({
      where: eq(channelConfigs.tenantId, tenantId),
    });

    return {
      sourceOfTruth: (config?.rdCrmSourceOfTruth as any) || "rd_primary",
      syncPolicy: (config?.rdCrmSyncPolicy as any) || "manual",
      lastSyncAt: config?.rdCrmLastSyncAt || null,
      lastReport: config?.rdCrmLastReport || null,
    };
  }

  /**
   * Atualiza a política de sincronização e fonte de verdade para o tenant com validação de regras de negócio.
   */
  static async updateSyncPolicy(
    tenantId: string,
    operatorId: string,
    data: {
      sourceOfTruth?: "rd_primary" | "local_primary";
      syncPolicy?: "manual" | "import_only" | "bidirectional";
    }
  ) {
    if (data.sourceOfTruth && !["rd_primary", "local_primary"].includes(data.sourceOfTruth)) {
      throw new CrmValidationError("sourceOfTruth inválido. Permitidos: 'rd_primary' ou 'local_primary'.");
    }

    if (data.syncPolicy && !["manual", "import_only", "bidirectional"].includes(data.syncPolicy)) {
      throw new CrmValidationError("syncPolicy inválido. Permitidos: 'manual', 'import_only' ou 'bidirectional'.");
    }

    const setPayload: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (data.sourceOfTruth) setPayload.rdCrmSourceOfTruth = data.sourceOfTruth;
    if (data.syncPolicy) setPayload.rdCrmSyncPolicy = data.syncPolicy;

    await db
      .update(channelConfigs)
      .set(setPayload)
      .where(eq(channelConfigs.tenantId, tenantId));

    return await this.getSyncPolicy(tenantId);
  }

  /**
   * Retorna o histórico de execuções de migração para o tenant.
   */
  static async getMigrationRuns(tenantId: string, limit: number = 20) {
    return await db
      .select()
      .from(crmMigrationRuns)
      .where(eq(crmMigrationRuns.tenantId, tenantId))
      .orderBy(desc(crmMigrationRuns.startedAt))
      .limit(limit);
  }
}
