/**
 * rd-migrator.ts
 * Utilitário de Migração, Backfill & Reconciliação do RD Station CRM para o CRM Proprietário.
 *
 * Implementa a especificação oficial da API v2 do RD Station CRM:
 * - Endpoints: /pipelines, /pipelines/{id}/stages, /deals
 * - Paginação: page[number] e page[size]
 * - Mapeamento estrito de valores: amount_total / total_value / amount_unique
 * - Reconciliação matemática honesta: NÃO move deals para etapas arbitrárias
 * - Relatório analítico por IDs, volumes e somatório de valores (R$)
 */

import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import {
  crmPipelines,
  crmStages,
  crmDeals,
  crmAccounts,
  crmDealContacts,
  contacts,
} from "../../db/schema";
import { rdRequest } from "../rdCrmService";

export interface RdReconciliationReport {
  status: "complete" | "partial" | "failed";
  tenantId: string;
  startedAt: string;
  finishedAt: string;
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
    unmappedStageCount: number;
    totalValueRd: number;
    totalValueImported: number;
    unmappedDetails: Array<{
      rdDealId: string;
      title: string;
      rdStageId: string;
      value: number;
      reason: string;
    }>;
  };
  organizations: {
    foundInRd: number;
    imported: number;
    skippedAlreadyExists: number;
  };
  errors: string[];
}

export class RdCrmMigrator {
  /**
   * Executa a rotina de migração e reconciliação sem corrupção de funil.
   * Não aloca negócios em etapas arbitrárias e emite relatório analítico completo.
   */
  static async migrateAll(tenantId: string, operatorId?: string | null): Promise<RdReconciliationReport> {
    const startedAt = new Date().toISOString();
    const report: RdReconciliationReport = {
      status: "complete",
      tenantId,
      startedAt,
      finishedAt: "",
      pipelines: {
        foundInRd: 0,
        importedOrMatched: 0,
        items: [],
      },
      stages: {
        foundInRd: 0,
        importedOrMatched: 0,
        items: [],
      },
      deals: {
        foundInRd: 0,
        imported: 0,
        skippedAlreadyExists: 0,
        unmappedStageCount: 0,
        totalValueRd: 0,
        totalValueImported: 0,
        unmappedDetails: [],
      },
      organizations: {
        foundInRd: 0,
        imported: 0,
        skippedAlreadyExists: 0,
      },
      errors: [],
    };

    console.log(`[RdCrmMigrator] Iniciando migração da API v2 do RD Station CRM para tenant: ${tenantId}...`);

    // Mapas de correspondência: RD ID -> Local ID
    const pipelineStageMap = new Map<string, string>(); // rdStageId -> localStageId
    const pipelineMap = new Map<string, string>();      // rdPipelineId -> localPipelineId

    // ─────────────────────────────────────────────────────────────────────────
    // 1. IMPORTAR FUNIS (PIPELINES) E ETAPAS (STAGES) VIA API v2
    // ─────────────────────────────────────────────────────────────────────────
    try {
      // Endpoint oficial da API v2: /pipelines (com fallback para /deal_pipelines se v2 legado)
      let rdPipelinesRaw: any;
      try {
        rdPipelinesRaw = await rdRequest<any>(tenantId, "GET", "/pipelines");
      } catch (err: any) {
        console.warn(`[RdCrmMigrator] /pipelines retornou erro (${err.message}). Tentando fallback /deal_pipelines...`);
        rdPipelinesRaw = await rdRequest<any>(tenantId, "GET", "/deal_pipelines");
      }

      const rdPipelinesList: any[] = Array.isArray(rdPipelinesRaw)
        ? rdPipelinesRaw
        : (rdPipelinesRaw?.pipelines || rdPipelinesRaw?.data || []);

      report.pipelines.foundInRd = rdPipelinesList.length;

      for (const [pIndex, rdp] of rdPipelinesList.entries()) {
        const rdPipelineId = String(rdp.id || rdp._id);
        const pipelineName = rdp.name || `Funil RD ${rdPipelineId}`;

        // Verifica se pipeline já existe no banco local
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
            const stagesRes = await rdRequest<any>(tenantId, "GET", `/pipelines/${rdPipelineId}/stages`);
            stages = Array.isArray(stagesRes) ? stagesRes : (stagesRes?.stages || stagesRes?.data || []);
          } catch (stgErr: any) {
            console.warn(`[RdCrmMigrator] Não foi possível buscar estágios individuais para pipeline ${rdPipelineId}:`, stgErr.message);
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
    } catch (err: any) {
      const msg = `Falha crítica ao importar funis/etapas do RD: ${err.message}`;
      console.error(`[RdCrmMigrator] ${msg}`);
      report.errors.push(msg);
      report.status = "failed";
      report.finishedAt = new Date().toISOString();
      return report;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. IMPORTAR NEGÓCIOS (DEALS) COM PAGINAÇÃO OFICIAL page[number] & page[size]
    // ─────────────────────────────────────────────────────────────────────────
    let pageNumber = 1;
    const pageSize = 100; // Padrão da API v2
    let hasMore = true;

    while (hasMore) {
      try {
        const queryParams = new URLSearchParams({
          "page[number]": String(pageNumber),
          "page[size]": String(pageSize),
        });

        const dealsResponse = await rdRequest<any>(
          tenantId,
          "GET",
          `/deals?${queryParams.toString()}`
        );

        const dealsList: any[] = Array.isArray(dealsResponse)
          ? dealsResponse
          : (dealsResponse?.deals || dealsResponse?.data || []);

        if (dealsList.length === 0) {
          hasMore = false;
          break;
        }

        report.deals.foundInRd += dealsList.length;

        for (const rdd of dealsList) {
          try {
            const rdDealId = String(rdd.id || rdd._id);

            // Mapeamento correto de valores da API v2
            const numericValue =
              parseFloat(rdd.amount_total ?? rdd.total_value ?? rdd.value ?? "0") ||
              (parseFloat(rdd.amount_unique || "0") + parseFloat(rdd.amount_monthly || "0")) ||
              0;

            report.deals.totalValueRd += numericValue;

            // Verificar se negócio já foi importado
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
              report.deals.skippedAlreadyExists++;
              continue;
            }

            // Identificação de Pipeline e Etapa
            const rddPipelineId = String(rdd.deal_pipeline_id || rdd.pipeline_id || "");
            const rddStageId = String(rdd.deal_stage_id || rdd.stage_id || "");

            const targetPipelineId = pipelineMap.get(rddPipelineId);
            const targetStageId = pipelineStageMap.get(rddStageId);

            // RECONCILIAÇÃO ESTRITA: Se a etapa não for encontrada, NÃO alocar arbitrariamente
            if (!targetStageId || !targetPipelineId) {
              report.deals.unmappedStageCount++;
              report.status = "partial"; // Reconciliação não 100% perfeita
              report.deals.unmappedDetails.push({
                rdDealId,
                title: rdd.name || `Negócio ${rdDealId}`,
                rdStageId: rddStageId || "vazio",
                value: numericValue,
                reason: !targetPipelineId
                  ? `Funil RD '${rddPipelineId}' não encontrado no mapeamento local`
                  : `Etapa RD '${rddStageId}' não encontrada no funil '${targetPipelineId}'`,
              });
              // Não cria em etapa falsa para não distorcer métricas comerciais e relatórios
              continue;
            }

            // Mapear Organização/Conta
            let localAccountId: string | null = null;
            if (rdd.organization || rdd.organization_id) {
              const org = rdd.organization || {};
              const orgName = org.name || "Empresa Importada RD";
              const rdOrgId = String(org.id || rdd.organization_id);

              report.organizations.foundInRd++;

              const [existingAccount] = await db
                .select()
                .from(crmAccounts)
                .where(
                  and(
                    eq(crmAccounts.tenantId, tenantId),
                    eq(crmAccounts.rdOrganizationId, rdOrgId)
                  )
                )
                .limit(1);

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
                    type: "company",
                    name: orgName,
                    tradeName: orgName,
                    rdOrganizationId: rdOrgId,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  })
                  .returning();
                localAccountId = createdAcc.id;
                report.organizations.imported++;
              }
            }

            // Mapear Status
            let status: "open" | "won" | "lost" = "open";
            if (rdd.win === true || rdd.status === "won") status = "won";
            else if (rdd.win === false || rdd.status === "lost") status = "lost";

            // Criar Negociação Local com valor e data de previsão
            const newDealId = `deal-rd-${rdDealId}`;
            const expectedClose = rdd.prediction_date ? new Date(rdd.prediction_date) : null;

            const [createdDeal] = await db
              .insert(crmDeals)
              .values({
                id: newDealId,
                tenantId,
                title: (rdd.name || `Negócio RD ${rdDealId}`).trim(),
                pipelineId: targetPipelineId,
                stageId: targetStageId,
                accountId: localAccountId,
                status,
                value: numericValue.toFixed(2),
                currency: "BRL",
                expectedCloseDate: expectedClose,
                rdDealId,
                source: "rd_crm_migration",
                createdAt: rdd.created_at ? new Date(rdd.created_at) : new Date(),
                updatedAt: new Date(),
                lastActivityAt: new Date(),
              })
              .returning();

            report.deals.imported++;
            report.deals.totalValueImported += numericValue;

            // Mapear contatos associados ao negócio se houver
            if (Array.isArray(rdd.contacts)) {
              for (const c of rdd.contacts) {
                const phone = c.phones?.[0]?.phone || c.phone;
                if (phone) {
                  const cleanPhone = phone.replace(/\D/g, "");
                  const [foundContact] = await db
                    .select()
                    .from(contacts)
                    .where(
                      and(
                        eq(contacts.tenantId, tenantId),
                        eq(contacts.phone, cleanPhone)
                      )
                    )
                    .limit(1);

                  if (foundContact) {
                    await db.insert(crmDealContacts).values({
                      id: `dc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                      tenantId,
                      dealId: createdDeal.id,
                      contactId: foundContact.id,
                      role: "buyer",
                      createdAt: new Date(),
                    });
                  }
                }
              }
            }
          } catch (dealErr: any) {
            console.warn(`[RdCrmMigrator] Erro ao importar deal individual: ${dealErr.message}`);
            report.errors.push(`Erro no deal RD ${rdd.id || rdd._id}: ${dealErr.message}`);
            report.status = "partial";
          }
        }

        // Se retornou menos que a página cheia, chegou ao fim
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
        hasMore = false; // Interrompe para não ficar em loop infinito em caso de falha de rede/auth
      }
    }

    report.finishedAt = new Date().toISOString();
    console.log(
      `[RdCrmMigrator] Migração finalizada com status ${report.status}: ` +
      `${report.deals.imported} deals importados (R$ ${report.deals.totalValueImported.toFixed(2)}), ` +
      `${report.deals.unmappedStageCount} não mapeados, ` +
      `${report.deals.skippedAlreadyExists} já existentes.`
    );

    return report;
  }
}
