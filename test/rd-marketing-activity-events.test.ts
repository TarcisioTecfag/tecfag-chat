import { describe, expect, test } from "bun:test";
import {
  isRdActivityLead,
  rdActivityOrigin,
  rdActivityPayload,
  RD_ACTIVITY_EVENTS,
} from "../src/lib/rd-marketing/activity-events";

describe("RD: atividades complementares", () => {
  test("sete identificadores fixos carregam o evento e a URL de cada registro", () => {
    expect(Object.keys(RD_ACTIVITY_EVENTS)).toHaveLength(7);
    const snapshot = {
      publicBaseUrl: "https://chat.example.com",
      subjectType: "task",
      dealId: "deal/123",
      taskId: "task-1",
      taskTitle: "Retornar",
      completedAt: "2026-10-16T12:00:00Z",
      actor: "Operador",
      source: "Google",
      campaign: "Campanha original",
    };
    const payload = rdActivityPayload({
      id: "event-1",
      eventType: "TASK_COMPLETED",
      snapshot,
      payload: { email: "test@example.com" },
    });
    expect(payload).toMatchObject({
      conversion_identifier: "tecfag-chat-tarefa-concluida",
      cf_tecfag_chat_evento_id: "event-1",
      cf_tecfag_chat_registro_url: "https://chat.example.com/crm/deals/deal%2F123",
    });
    expect(payload.cf_tecfag_chat_detalhes).toContain("Autor da ação: Operador");
    expect(payload).not.toHaveProperty("cf_utm_source");
    expect(payload).not.toHaveProperty("traffic_source");
    const chat = rdActivityPayload({
      id: "event-2",
      eventType: "CHAT_STARTED",
      snapshot: {
        ...snapshot,
        subjectType: "conversation",
        conversationId: "chat-1",
        deals: [{ dealId: "other", dealTitle: "Outro card" }],
      },
      payload: { phone: "+5511999999999" },
    });
    expect(chat.cf_tecfag_chat_registro_url).toBe("https://chat.example.com/chat/chat-1");
    expect(chat.cf_tecfag_chat_detalhes).toContain("https://chat.example.com/crm/deals/other");
  });
  test("eventos próprios recebidos são reconhecidos sem confundir campos persistentes do perfil", () => {
    expect(
      isRdActivityLead({ rd_event: { event_identifier: "tecfag-chat-conversa-finalizada" } }),
    ).toBe(true);
    expect(
      isRdActivityLead({
        last_conversion: { content: { identificador: "tecfag-chat-tarefa-criada" } },
      }),
    ).toBe(true);
    expect(
      isRdActivityLead({
        last_conversion: { content: { identifier: "tecfag-chat-tarefa-criada" } },
      }),
    ).toBe(true);
    expect(
      isRdActivityLead({
        cf_tecfag_chat_evento_id: "old",
        last_conversion: { conversion_identifier: "formulario-real" },
      }),
    ).toBe(false);
  });
  test("links rejeitam protocolos não navegáveis e credenciais", () => {
    expect(() => rdActivityOrigin("javascript:alert(1)")).toThrow();
    expect(() => rdActivityOrigin("https://user:password@example.com")).toThrow();
    expect(() => rdActivityOrigin("http://example.com")).toThrow();
    expect(rdActivityOrigin("https://chat.example.com/path?token=unused")).toBe(
      "https://chat.example.com",
    );
  });
});
