import { describe, expect, it } from "bun:test";
import type { RecentCrmEventItem } from "@/components/commercial/CommercialAnalysisPanels";

describe("Gestão Comercial - Logs de Últimas Alterações do CRM (Aba Operação)", () => {
  it("deve estruturar corretamente os logs detalhados com autor, ação, card e badges", () => {
    const mockEvent: RecentCrmEventItem = {
      id: "evt-12345",
      createdAt: "2026-10-08T18:48:04.000Z",
      eventType: "stage_changed",
      dealId: "deal-1791372934315-23z83",
      dealTitle: "Valem Embalagens - 50k Válvulas Spray",
      dealValue: 45000,
      accountName: "Valem Indústria",
      operatorId: "op-1",
      operatorName: "Marcelo Nardelli",
      operatorAvatar: null,
      actionTitle: 'Etapa alterada para "Proposta Enviada"',
      actionDescription: "Etapa anterior: Abordagem Comercial",
      badgeLabel: "Etapa",
      badgeVariant: "stage",
    };

    expect(mockEvent.operatorName).toBe("Marcelo Nardelli");
    expect(mockEvent.actionTitle).toContain("Proposta Enviada");
    expect(mockEvent.badgeVariant).toBe("stage");
    expect(mockEvent.dealTitle).toBe("Valem Embalagens - 50k Válvulas Spray");
    expect(mockEvent.accountName).toBe("Valem Indústria");
    expect(mockEvent.dealId).toBe("deal-1791372934315-23z83");
  });

  it("deve lidar com eventos gerados pelo Sistema ou com dados ausentes de forma defensiva", () => {
    const mockSystemEvent: RecentCrmEventItem = {
      id: "evt-system-1",
      createdAt: "2026-10-08T18:07:11.000Z",
      eventType: "created",
      dealId: "deal-1791482831883-xttpw",
      dealTitle: "Oportunidade Via Webhook",
      dealValue: null,
      accountName: null,
      operatorId: null,
      operatorName: "Sistema",
      operatorAvatar: null,
      actionTitle: "Negociação criada",
      actionDescription: null,
      badgeLabel: "Criado",
      badgeVariant: "created",
    };

    expect(mockSystemEvent.operatorName).toBe("Sistema");
    expect(mockSystemEvent.actionTitle).toBe("Negociação criada");
    expect(mockSystemEvent.badgeVariant).toBe("created");
    expect(mockSystemEvent.dealTitle).toBe("Oportunidade Via Webhook");
  });

  it("deve formatar corretamente eventos de notas comerciais e tarefas", () => {
    const noteEvent: RecentCrmEventItem = {
      createdAt: "2026-10-08T18:48:04.000Z",
      eventType: "note_created",
      dealId: "deal-1791372934315-23z83",
      dealTitle: "Cliente Interessado em Seladora",
      operatorName: "Diana Gimenes",
      actionTitle: "Anotação comercial registrada",
      actionDescription: "Cliente solicitou amostra do frasco 250ml",
      badgeLabel: "Nota",
      badgeVariant: "note",
    };

    const taskEvent: RecentCrmEventItem = {
      createdAt: "2026-10-08T18:16:11.000Z",
      eventType: "activity_completed",
      dealId: "deal-1791372934315-23z83",
      dealTitle: "Cliente Interessado em Seladora",
      operatorName: "Melissa Gomes",
      actionTitle: 'Tarefa concluída: "Enviar apresentação em PDF"',
      badgeLabel: "Concluída",
      badgeVariant: "activity",
    };

    expect(noteEvent.badgeVariant).toBe("note");
    expect(noteEvent.actionDescription).toBe("Cliente solicitou amostra do frasco 250ml");
    expect(taskEvent.badgeVariant).toBe("activity");
    expect(taskEvent.actionTitle).toContain("Enviar apresentação em PDF");
  });
});
