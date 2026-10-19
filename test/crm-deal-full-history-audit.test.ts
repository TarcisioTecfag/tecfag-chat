import { describe, expect, it } from "vitest";
import { formatDealEvent } from "../src/lib/crm/deal-event-format";
import {
  diffCustomFieldValues,
  formatCustomFieldLabel,
  type CustomFieldDefinition,
} from "../src/lib/crm/custom-fields";
import type { CrmDealEventType } from "../src/lib/crm/crm-types";

describe("CRM Deal Full History Audit — Formatters & Diffs", () => {
  const stageNames = new Map<string, string>([
    ["stg-1", "Qualificação"],
    ["stg-2", "Proposta Enviada"],
    ["stg-3", "Fechamento"],
  ]);

  const operatorNames = new Map<string, string>([
    ["op-1", "Carlos Vendedor"],
    ["op-2", "Ana Comercial"],
  ]);

  it("formata todos os 35+ tipos de evento com textos ricos De -> Para sem cair no fallback genérico", () => {
    const cases: Array<{
      eventType: CrmDealEventType;
      metadata: Record<string, unknown>;
      expectedTitleIncludes: string;
      expectedDescIncludes?: string;
    }> = [
      {
        eventType: "created",
        metadata: {},
        expectedTitleIncludes: "Negociação criada",
      },
      {
        eventType: "title_changed",
        metadata: { fromTitle: "Negócio Antigo", toTitle: "Negócio Novo" },
        expectedTitleIncludes: 'Título alterado para "Negócio Novo"',
        expectedDescIncludes: 'Antes: "Negócio Antigo"',
      },
      {
        eventType: "value_changed",
        metadata: { previousValue: "1000.00", newValue: "2500.50", reason: "manual" },
        expectedTitleIncludes: "Valor atualizado para",
        expectedDescIncludes: "Antes:",
      },
      {
        eventType: "rating_changed",
        metadata: { fromRating: 2, toRating: 5 },
        expectedTitleIncludes: "Qualificação alterada para 5★",
        expectedDescIncludes: "Antes: 2★",
      },
      {
        eventType: "owner_changed",
        metadata: {
          fromOperatorId: "op-1",
          fromOperatorName: "Carlos Vendedor",
          toOperatorId: "op-2",
          toOperatorName: "Ana Comercial",
        },
        expectedTitleIncludes: "Responsável alterado para Ana Comercial",
        expectedDescIncludes: "Antes: Carlos Vendedor",
      },
      {
        eventType: "expected_close_date_changed",
        metadata: { fromDate: "2026-10-10", toDate: "2026-11-25" },
        expectedTitleIncludes: "Previsão de fechamento alterada para 25/11/2026",
        expectedDescIncludes: "Antes: 10/10/2026",
      },
      {
        eventType: "source_changed",
        metadata: { fromSource: "Indicação", toSource: "Google Ads" },
        expectedTitleIncludes: 'Origem alterada para "Google Ads"',
        expectedDescIncludes: "Antes: Indicação",
      },
      {
        eventType: "campaign_changed",
        metadata: { fromCampaign: null, toCampaign: "Black Friday 2026" },
        expectedTitleIncludes: 'Campanha alterada para "Black Friday 2026"',
        expectedDescIncludes: "Antes: Não informada",
      },
      {
        eventType: "pipeline_changed",
        metadata: {
          fromPipelineId: "pipe-1",
          fromPipelineName: "Pré-Vendas",
          toPipelineId: "pipe-2",
          toPipelineName: "Vendas Consultivas",
          fromStageId: "stg-1",
          fromStageName: "Qualificação",
          toStageId: "stg-2",
          toStageName: "Proposta Enviada",
        },
        expectedTitleIncludes: "Funil alterado para Vendas Consultivas",
        expectedDescIncludes: "Funil anterior: Pré-Vendas · Etapa: Qualificação → Proposta Enviada",
      },
      {
        eventType: "stage_changed",
        metadata: {
          fromStageId: "stg-1",
          fromStageName: "Qualificação",
          toStageId: "stg-2",
          toStageName: "Proposta Enviada",
        },
        expectedTitleIncludes: "Etapa alterada para Proposta Enviada",
        expectedDescIncludes: "Etapa anterior: Qualificação",
      },
      {
        eventType: "status_changed",
        metadata: {
          fromStatus: "open",
          toStatus: "paused",
          pausedReason: "Cliente aguardando aprovação de diretoria",
        },
        expectedTitleIncludes: "Status alterado para Pausado",
        expectedDescIncludes: "Antes: Em aberto · Motivo: Cliente aguardando aprovação de diretoria",
      },
      {
        eventType: "bulk_updated",
        metadata: {
          previousStageId: "stg-1",
          newStageId: "stg-3",
          previousStatus: "open",
          newStatus: "won",
        },
        expectedTitleIncludes: "Negociação atualizada em lote",
        expectedDescIncludes: "Etapa: Qualificação → Fechamento",
      },
      {
        eventType: "custom_fields_changed",
        metadata: {
          changes: [
            {
              fieldId: "cf-1",
              fieldName: "Prazo de Entrega",
              fieldType: "single",
              fromLabel: "15 dias",
              toLabel: "30 dias",
            },
          ],
        },
        expectedTitleIncludes: "Campo personalizado da negociação atualizado",
        expectedDescIncludes: 'Prazo de Entrega: "15 dias" → "30 dias"',
      },
      {
        eventType: "account_linked",
        metadata: { accountName: "Indústria ABC Ltda", accountDocument: "12345678000199" },
        expectedTitleIncludes: "Comprador vinculado: Indústria ABC Ltda",
        expectedDescIncludes: "Documento: 12345678000199",
      },
      {
        eventType: "account_unlinked",
        metadata: { fromAccountName: "Indústria ABC Ltda" },
        expectedTitleIncludes: "Comprador desvinculado: Indústria ABC Ltda",
      },
      {
        eventType: "account_changed",
        metadata: { fromAccountName: "Empresa A", toAccountName: "Empresa B" },
        expectedTitleIncludes: "Comprador alterado para Empresa B",
        expectedDescIncludes: "Antes: Empresa A",
      },
      {
        eventType: "account_updated",
        metadata: {
          accountName: "Empresa B",
          changes: [{ fieldLabel: "Segmento", fromValue: "Varejo", toValue: "Atacado" }],
        },
        expectedTitleIncludes: "Dados do comprador atualizados (Empresa B)",
        expectedDescIncludes: 'Segmento: "Varejo" → "Atacado"',
      },
      {
        eventType: "account_archived",
        metadata: { accountName: "Empresa Antiga" },
        expectedTitleIncludes: "Comprador arquivado: Empresa Antiga",
      },
      {
        eventType: "participant_added",
        metadata: {
          contactName: "João Silva",
          contactPhone: "5511999999999",
          role: "decisor",
          isPrimary: true,
        },
        expectedTitleIncludes: "Participante vinculado: João Silva",
        expectedDescIncludes: "Papel: Decisor · Contato principal · Tel: 5511999999999",
      },
      {
        eventType: "participant_removed",
        metadata: { contactName: "João Silva", role: "comprador" },
        expectedTitleIncludes: "Participante removido: João Silva",
        expectedDescIncludes: "Papel anterior: Comprador",
      },
      {
        eventType: "participant_role_changed",
        metadata: { contactName: "Maria Souza", fromRole: "comprador", toRole: "decisor" },
        expectedTitleIncludes: "Papel do participante Maria Souza alterado para Decisor",
        expectedDescIncludes: "Antes: Comprador",
      },
      {
        eventType: "primary_contact_changed",
        metadata: { fromContactName: "João Silva", toContactName: "Maria Souza" },
        expectedTitleIncludes: "Contato principal alterado para Maria Souza",
        expectedDescIncludes: "Antes: João Silva",
      },
      {
        eventType: "contact_updated",
        metadata: {
          contactName: "Maria Souza",
          changes: [{ fieldLabel: "E-mail", fromValue: "antigo@emp.com", toValue: "novo@emp.com" }],
        },
        expectedTitleIncludes: "Dados do contato atualizados (Maria Souza)",
        expectedDescIncludes: 'E-mail: "antigo@emp.com" → "novo@emp.com"',
      },
      {
        eventType: "conversation_linked",
        metadata: { contactName: "Maria Souza", contactPhone: "5511988887777" },
        expectedTitleIncludes: "Conversa vinculada à negociação",
        expectedDescIncludes: "Contato: Maria Souza · Tel: 5511988887777",
      },
      {
        eventType: "conversation_unlinked",
        metadata: { contactName: "Maria Souza" },
        expectedTitleIncludes: "Conversa desvinculada da negociação",
        expectedDescIncludes: "Contato: Maria Souza",
      },
      {
        eventType: "activity_created",
        metadata: { activityTitle: "Ligar para cliente", dueDate: "2026-10-20" },
        expectedTitleIncludes: "Tarefa criada: Ligar para cliente",
        expectedDescIncludes: "Prazo: 20/10/2026",
      },
      {
        eventType: "note_created",
        metadata: { activityTitle: "Resumo da reunião" },
        expectedTitleIncludes: "Nota comercial registrada",
        expectedDescIncludes: "Resumo da reunião",
      },
      {
        eventType: "activity_completed",
        metadata: { activityTitle: "Ligar para cliente" },
        expectedTitleIncludes: "Tarefa concluída: Ligar para cliente",
      },
      {
        eventType: "activity_reopened",
        metadata: { activityTitle: "Ligar para cliente" },
        expectedTitleIncludes: "Tarefa reaberta: Ligar para cliente",
      },
      {
        eventType: "activity_cancelled",
        metadata: { activityTitle: "Ligar para cliente" },
        expectedTitleIncludes: "Tarefa cancelada: Ligar para cliente",
      },
      {
        eventType: "activity_rescheduled",
        metadata: {
          activityTitle: "Reunião de alinhamento",
          previousDueDate: "2026-10-15",
          dueDate: "2026-10-22",
        },
        expectedTitleIncludes: "Tarefa reagendada: Reunião de alinhamento",
        expectedDescIncludes: "Prazo: 15/10/2026 → 22/10/2026",
      },
      {
        eventType: "activity_updated",
        metadata: {
          activityTitle: "Reunião técnica",
          changes: [{ fieldLabel: "Título", fromValue: "Reunião", toValue: "Reunião técnica" }],
        },
        expectedTitleIncludes: "Tarefa atualizada: Reunião técnica",
        expectedDescIncludes: 'Título: "Reunião" → "Reunião técnica"',
      },
      {
        eventType: "activity_deleted",
        metadata: { activityTitle: "Tarefa duplicada" },
        expectedTitleIncludes: "Tarefa excluída: Tarefa duplicada",
      },
      {
        eventType: "message_marked_as_evidence",
        metadata: { note: "Cliente aprovou valor no WhatsApp" },
        expectedTitleIncludes: "Mensagem marcada como evidência",
        expectedDescIncludes: "Cliente aprovou valor no WhatsApp",
      },
      {
        eventType: "message_evidence_removed",
        metadata: {},
        expectedTitleIncludes: "Marcação de evidência removida",
      },
      {
        eventType: "product_added",
        metadata: { name: "Seladora Automática", totalPrice: "15000.00" },
        expectedTitleIncludes: "Produto adicionado: Seladora Automática",
        expectedDescIncludes: "Total:",
      },
      {
        eventType: "product_removed",
        metadata: { name: "Seladora Automática" },
        expectedTitleIncludes: "Produto removido: Seladora Automática",
      },
      {
        eventType: "proposal_created",
        metadata: { proposalNumber: "PROP-2026-0001", total: "15000.00" },
        expectedTitleIncludes: "Proposta PROP-2026-0001 criada",
        expectedDescIncludes: "Valor:",
      },
      {
        eventType: "proposal_status_changed",
        metadata: {
          proposalNumber: "PROP-2026-0001",
          previousStatus: "draft",
          newStatus: "copied",
        },
        expectedTitleIncludes: "Proposta PROP-2026-0001 alterada para Texto copiado",
        expectedDescIncludes: "Antes: Rascunho",
      },
      {
        eventType: "deal_file_uploaded",
        metadata: { fileName: "contrato.pdf" },
        expectedTitleIncludes: "Arquivo anexado: contrato.pdf",
      },
      {
        eventType: "deal_file_deleted",
        metadata: { fileName: "contrato.pdf" },
        expectedTitleIncludes: "Arquivo removido: contrato.pdf",
      },
      {
        eventType: "deal_questionnaire_saved",
        metadata: { formTitle: "Qualificação Técnica" },
        expectedTitleIncludes: "Questionário salvo: Qualificação Técnica",
      },
      {
        eventType: "deal_email_logged",
        metadata: { direction: "outbound", subject: "Envio de Proposta" },
        expectedTitleIncludes: "E-mail registrado: Envio de Proposta",
      },
      {
        eventType: "deal_ai_priority_calculated",
        metadata: { reason: "[IA Vertex]: Cliente com alta urgência e ticket elevado." },
        expectedTitleIncludes: "Prioridade comercial atualizada",
        expectedDescIncludes: "Cliente com alta urgência e ticket elevado.",
      },
    ];

    for (const tc of cases) {
      const res = formatDealEvent(
        { eventType: tc.eventType, metadata: tc.metadata },
        stageNames,
        operatorNames,
      );
      expect(res.title).not.toBe("Alteração registrada na negociação");
      expect(res.title).toContain(tc.expectedTitleIncludes);
      if (tc.expectedDescIncludes) {
        expect(res.description).toContain(tc.expectedDescIncludes);
      }
    }
  });

  it("resolve labels legíveis e calcula diffs De -> Para de campos personalizados (single, multiple, date, text)", () => {
    const definitions: CustomFieldDefinition[] = [
      {
        id: "cf-single",
        tenantId: "tecfag",
        entityType: "deal",
        name: "Urgência",
        fieldType: "single",
        required: false,
        requiredRule: "always",
        requiredFromStageId: null,
        visibleOnCreate: true,
        isUnique: false,
        showInCard: false,
        allPipelines: true,
        pipelineIds: [],
        options: [
          { id: "opt-baixa", label: "Baixa" },
          { id: "opt-alta", label: "Alta Urgência" },
        ],
        sortOrder: 0,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "cf-multi",
        tenantId: "tecfag",
        entityType: "deal",
        name: "Interesses",
        fieldType: "multiple",
        required: false,
        requiredRule: "always",
        requiredFromStageId: null,
        visibleOnCreate: true,
        isUnique: false,
        showInCard: false,
        allPipelines: true,
        pipelineIds: [],
        options: [
          { id: "m-1", label: "Seladora" },
          { id: "m-2", label: "Envasadora" },
          { id: "m-3", label: "Rotuladora" },
        ],
        sortOrder: 1,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "cf-date",
        tenantId: "tecfag",
        entityType: "deal",
        name: "Data da Visita",
        fieldType: "date",
        required: false,
        requiredRule: "always",
        requiredFromStageId: null,
        visibleOnCreate: true,
        isUnique: false,
        showInCard: false,
        allPipelines: true,
        pipelineIds: [],
        options: [],
        sortOrder: 2,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    expect(formatCustomFieldLabel(definitions[0], "opt-alta")).toBe("Alta Urgência");
    expect(formatCustomFieldLabel(definitions[1], ["m-1", "m-3"])).toBe("Seladora, Rotuladora");
    expect(formatCustomFieldLabel(definitions[2], "2026-12-01")).toBe("01/12/2026");

    const diffs = diffCustomFieldValues(
      definitions,
      {
        "cf-single": "opt-baixa",
        "cf-multi": ["m-1"],
        "cf-date": null,
      },
      {
        "cf-single": "opt-alta",
        "cf-multi": ["m-1", "m-2"],
        "cf-date": "2026-12-01",
      },
    );

    expect(diffs).toHaveLength(3);
    expect(diffs[0]).toMatchObject({
      fieldId: "cf-single",
      fieldName: "Urgência",
      fromLabel: "Baixa",
      toLabel: "Alta Urgência",
    });
    expect(diffs[1]).toMatchObject({
      fieldId: "cf-multi",
      fieldName: "Interesses",
      fromLabel: "Seladora",
      toLabel: "Seladora, Envasadora",
    });
    expect(diffs[2]).toMatchObject({
      fieldId: "cf-date",
      fieldName: "Data da Visita",
      fromLabel: null,
      toLabel: "01/12/2026",
    });
  });

  it("permite remover contato de uma negociação (inclusive o primeiro após vincular um segundo ou deixar a negociação sem contato), mantendo DealRequiredError apenas na conversa/atendimento", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const crmServiceSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/crm/crm-service.ts"),
      "utf8",
    );

    const removeMethodStart = crmServiceSource.indexOf("async removeDealContact(");
    const setPrimaryMethodStart = crmServiceSource.indexOf("async setPrimaryDealContact(");
    expect(removeMethodStart).toBeGreaterThan(-1);
    expect(setPrimaryMethodStart).toBeGreaterThan(removeMethodStart);

    const removeMethodBody = crmServiceSource.slice(removeMethodStart, setPrimaryMethodStart);
    expect(removeMethodBody).not.toContain("throw new DealRequiredError()");
    expect(removeMethodBody).toContain('"participant_removed"');
    expect(removeMethodBody).toContain('"primary_contact_changed"');

    const unlinkMethodStart = crmServiceSource.indexOf("async unlinkConversationDeal(");
    expect(unlinkMethodStart).toBeGreaterThan(-1);
    const unlinkMethodBody = crmServiceSource.slice(unlinkMethodStart, unlinkMethodStart + 1800);
    expect(unlinkMethodBody).toContain("throw new DealRequiredError()");
  });
});

