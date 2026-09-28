/**
 * rd-migrator.ts
 * Utilitário de Migração & Backfill do RD Station CRM para o CRM Proprietário Tecfag/Valem.
 * 
 * Permite a transição soberana e definitiva do RD Station CRM para o banco local,
 * importando funis, etapas, organizações e negociações com preservação total de vínculos.
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
import { crmService } from "./crm-service";

export interface RdMigrationSummary {
  tenantId: string;
  importedPipelines: number;
  importedStages: number;
  importedAccounts: number;
  importedDeals: number;
  errors: string[];
}

export class RdCrmMigrator {
  /**
   * Executa o processo de migração completo a partir do RD Station CRM para o tenant especificado.
   */
  static async migrateAll(tenantId: string, operatorId?: string | null): Promise<RdMigrationSummary> {
    const summary: RdMigrationSummary = {
      tenantId,
      importedPipelines: 0,
      importedStages: 0,
      importedAccounts: 0,
      importedDeals: 0,
      errors: [],
    };

    console.log(`[RdCrmMigrator] Iniciando migração do RD Station CRM para tenant: ${tenantId}...`);

    // 1. IMPORTAR PIPELINES E ETAPAS
    const pipelineStageMap = new Map<string, string>(); // rdStageId -> localStageId
    const pipelineMap = new Map<string, string>(); // rdPipelineId -> localPipelineId

    try {
      const rdPipelines = await rdRequest<any[]>(tenantId, "GET", "/deal_pipelines");

      if (Array.isArray(rdPipelines)) {
        for (const [pIndex, rdp] of rdPipelines.entries()) {
          const rdPipelineId = String(rdp.id || rdp._id);
          
          // Verifica se o pipeline já existe localmente
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
                name: rdp.name || `Funil RD ${rdPipelineId}`,
                color: "#1677ff",
                isDefault: pIndex === 0,
                orderIndex: pIndex,
                coolingDays: 10,
                rdPipelineId,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
            localPipeline = created;
            summary.importedPipelines++;
          }

          pipelineMap.set(rdPipelineId, localPipeline.id);

          // Importar Etapas (stages) do Pipeline
          const stages = rdp.deal_stages || rdp.stages || [];
          for (const [sIndex, rds] of stages.entries()) {
            const rdStageId = String(rds.id || rds._id);

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
                  name: rds.name || `Etapa ${sIndex + 1}`,
                  orderIndex: rds.order ?? sIndex,
                  rdStageId,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                })
                .returning();
              localStage = createdStage;
              summary.importedStages++;
            }

            pipelineStageMap.set(rdStageId, localStage.id);
          }
        }
      }
    } catch (err: any) {
      const msg = `Falha ao importar funis/etapas do RD: ${err.message}`;
      console.error(`[RdCrmMigrator] ${msg}`);
      summary.errors.push(msg);
      // Se não conseguiu nem puxar os funis, não tem como continuar os deals
      return summary;
    }

    // 2. IMPORTAR NEGÓCIOS (DEALS)
    let page = 1;
    const limit = 50;
    let hasMore = true;

    while (hasMore && page <= 10) { // Máximo de 500 deals por rodada
      try {
        const queryParams = new URLSearchParams({
          page: String(page),
          limit: String(limit),
        });

        const dealsResponse = await rdRequest<any>(tenantId, "GET", `/deals?${queryParams.toString()}`);
        const dealsList: any[] = Array.isArray(dealsResponse) 
          ? dealsResponse 
          : (dealsResponse?.deals || dealsResponse?.data || []);

        if (dealsList.length === 0) {
          hasMore = false;
          break;
        }

        for (const rdd of dealsList) {
          try {
            const rdDealId = String(rdd.id || rdd._id);

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
              continue; // Idempotência: pula os já importados
            }

            // Identifica Pipeline e Stage
            const rddPipelineId = String(rdd.deal_pipeline_id || rdd.pipeline_id || "");
            const rddStageId = String(rdd.deal_stage_id || rdd.stage_id || "");

            let targetPipelineId = pipelineMap.get(rddPipelineId);
            let targetStageId = pipelineStageMap.get(rddStageId);

            // Fallback se não bater o ID do estágio
            if (!targetPipelineId || !targetStageId) {
              const allPipelines = await crmService.getPipelines(tenantId);
              const defaultPipeline = allPipelines.find((p) => p.isDefault) || allPipelines[0];
              if (defaultPipeline && defaultPipeline.stages.length > 0) {
                targetPipelineId = targetPipelineId || defaultPipeline.id;
                targetStageId = targetStageId || defaultPipeline.stages[0].id;
              } else {
                continue;
              }
            }

            // Mapear Organização/Conta
            let localAccountId: string | null = null;
            if (rdd.organization || rdd.organization_id) {
              const org = rdd.organization || {};
              const orgName = org.name || "Empresa Importada RD";
              const rdOrgId = String(org.id || rdd.organization_id);

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
                summary.importedAccounts++;
              }
            }

            // Mapear Status
            let status: "open" | "won" | "lost" = "open";
            if (rdd.win || rdd.status === "won") status = "won";
            else if (rdd.win === false || rdd.status === "lost") status = "lost";

            // Criar Negociação Local
            const newDealId = `deal-rd-${rdDealId}`;
            const dealValue = (rdd.amount_montly || rdd.amount_unique || rdd.value || 0).toString();

            const [createdDeal] = await db
              .insert(crmDeals)
              .values({
                id: newDealId,
                tenantId,
                title: rdd.name || `Negócio RD ${rdDealId}`,
                pipelineId: targetPipelineId!,
                stageId: targetStageId!,
                accountId: localAccountId,
                status,
                value: parseFloat(dealValue).toFixed(2),
                currency: "BRL",
                rdDealId,
                source: "rd_crm_migration",
                createdAt: rdd.created_at ? new Date(rdd.created_at) : new Date(),
                updatedAt: new Date(),
                lastActivityAt: new Date(),
              })
              .returning();

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
                      role: "participant",
                      createdAt: new Date(),
                    });
                  }
                }
              }
            }

            summary.importedDeals++;
          } catch (dealErr: any) {
            console.warn(`[RdCrmMigrator] Erro ao importar deal: ${dealErr.message}`);
          }
        }

        if (dealsList.length < limit) {
          hasMore = false;
        } else {
          page++;
        }
      } catch (pageErr: any) {
        summary.errors.push(`Erro na página ${page} de negócios: ${pageErr.message}`);
        hasMore = false;
      }
    }

    console.log(`[RdCrmMigrator] Migração concluída: ${summary.importedDeals} deals, ${summary.importedPipelines} funis, ${summary.importedAccounts} contas.`);
    return summary;
  }
}
