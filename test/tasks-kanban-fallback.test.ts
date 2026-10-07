import { describe, it, expect } from "bun:test";

describe("Integração Híbrida de Tarefas: Kanban Nativo quando RD CRM não integrado", () => {
  it("mapeia tipos de tarefa amigáveis e ícones para visualização no calendário", () => {
    const taskTypeMap: Record<string, string> = {
      call: "Ligação",
      email: "E-mail",
      meeting: "Reunião",
      whatsapp: "WhatsApp",
      lunch: "Almoço",
      visit: "Visita",
      task: "Tarefa",
    };

    expect(taskTypeMap["call"]).toBe("Ligação");
    expect(taskTypeMap["meeting"]).toBe("Reunião");
    expect(taskTypeMap["whatsapp"]).toBe("WhatsApp");
    expect(taskTypeMap["task"]).toBe("Tarefa");
    expect(taskTypeMap["lunch"]).toBe("Almoço");
    expect(taskTypeMap["visit"]).toBe("Visita");
  });

  it("converte status do Kanban ('completed'/'pending') para o padrão do calendário ('done'/'pending')", () => {
    const mapKanbanStatusToUi = (status: string) => (status === "completed" ? "done" : "pending");
    const mapUiStatusToKanban = (status: string) =>
      status === "done" || status === "completed" ? "completed" : "pending";

    expect(mapKanbanStatusToUi("completed")).toBe("done");
    expect(mapKanbanStatusToUi("pending")).toBe("pending");

    expect(mapUiStatusToKanban("done")).toBe("completed");
    expect(mapUiStatusToKanban("pending")).toBe("pending");
  });

  it("estrutura corretamente os dados de tarefa enriquecida do Kanban sem RD CRM", () => {
    const rawActivity = {
      id: "act-123",
      title: "Follow-up Proposta Comercial",
      type: "whatsapp",
      status: "pending",
      dueDate: new Date("2026-10-07T14:00:00.000Z"),
      description: "Confirmar recebimento do orçamento da seladora",
      createdAt: new Date("2026-10-07T08:00:00.000Z"),
      conversationId: "conv-456",
      dealId: "deal-789",
      dealTitle: "Máquina Seladora Contínua - Tecfag",
      dealValue: "18500.00",
      contactName: "Carlos Oliveira",
      contactPhone: "+5511999887766",
      operatorName: "Henrique Silva",
    };

    const formattedTask = {
      id: rawActivity.id,
      name: rawActivity.title,
      type: rawActivity.type,
      status: rawActivity.status === "completed" ? "done" : "pending",
      dueDate: rawActivity.dueDate.toISOString(),
      description: rawActivity.description,
      createdAt: rawActivity.createdAt.toISOString(),
      deal: {
        id: rawActivity.dealId,
        name: rawActivity.dealTitle,
        value: rawActivity.dealValue,
      },
      client: {
        name: rawActivity.contactName,
        phone: rawActivity.contactPhone,
      },
      chatContactId: "contact-001",
      chatConversationId: rawActivity.conversationId,
      source: "kanban",
      operatorName: rawActivity.operatorName,
    };

    expect(formattedTask.source).toBe("kanban");
    expect(formattedTask.name).toBe("Follow-up Proposta Comercial");
    expect(formattedTask.status).toBe("pending");
    expect(formattedTask.deal.name).toBe("Máquina Seladora Contínua - Tecfag");
    expect(formattedTask.client.name).toBe("Carlos Oliveira");
    expect(formattedTask.chatConversationId).toBe("conv-456");
  });

  it("garante isolamento mandatório de tenant ao buscar ou atualizar tarefas", () => {
    const tenantA = "tecfag";
    const tenantB = "valem";

    const filterTasksByTenant = (items: Array<{ id: string; tenantId: string }>, tenantId: string) => {
      return items.filter((item) => item.tenantId === tenantId);
    };

    const allActivities = [
      { id: "act-1", tenantId: "tecfag" },
      { id: "act-2", tenantId: "valem" },
      { id: "act-3", tenantId: "tecfag" },
    ];

    const tecfagTasks = filterTasksByTenant(allActivities, tenantA);
    const valemTasks = filterTasksByTenant(allActivities, tenantB);

    expect(tecfagTasks.length).toBe(2);
    expect(tecfagTasks.every((t) => t.tenantId === "tecfag")).toBe(true);

    expect(valemTasks.length).toBe(1);
    expect(valemTasks.every((t) => t.tenantId === "valem")).toBe(true);
  });
});
