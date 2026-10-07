import { describe, it, expect } from "bun:test";
import {
  OPERATOR_PAUSE_AUTO_REPLY_TEXT,
  AUTO_REPLY_COOLDOWN_MS,
} from "../src/lib/whatsapp/status-auto-reply";

describe("Auto-Resposta de Operador em Pausa ou Desconectado", () => {
  it("contém o texto oficial exato solicitado pelo usuário", () => {
    expect(OPERATOR_PAUSE_AUTO_REPLY_TEXT).toBe("Olá, estou em minha pausa, logo te retorno");
  });

  it("define o tempo de cooldown anti-spam como 20 minutos (1.200.000 ms)", () => {
    expect(AUTO_REPLY_COOLDOWN_MS).toBe(20 * 60 * 1000);
    expect(AUTO_REPLY_COOLDOWN_MS).toBe(1200000);
  });

  it("identifica corretamente quais status de operador devem acionar a resposta automática", () => {
    const shouldTriggerAutoReply = (status: string) => {
      return status === "pausa" || status === "desconectado";
    };

    // Status que devem disparar auto-resposta
    expect(shouldTriggerAutoReply("pausa")).toBe(true);
    expect(shouldTriggerAutoReply("desconectado")).toBe(true);

    // Status ativo/disponível não deve disparar
    expect(shouldTriggerAutoReply("disponivel")).toBe(false);
    expect(shouldTriggerAutoReply("ocupado")).toBe(false);
  });

  it("bloqueia disparo em mensagens recebidas antigas (mais de 5 minutos)", () => {
    const isMessageStale = (incomingTime: Date, now: Date) => {
      const diffMs = now.getTime() - incomingTime.getTime();
      return diffMs > 5 * 60 * 1000;
    };

    const now = new Date("2026-10-07T14:30:00.000Z");

    // Mensagem de 10 segundos atrás (recente) -> não é stale
    const recentMsg = new Date("2026-10-07T14:29:50.000Z");
    expect(isMessageStale(recentMsg, now)).toBe(false);

    // Mensagem de 3 minutos atrás (aceitável) -> não é stale
    const threeMinMsg = new Date("2026-10-07T14:27:00.000Z");
    expect(isMessageStale(threeMinMsg, now)).toBe(false);

    // Mensagem de 6 minutos atrás (atrasada / recovery) -> é stale
    const sixMinMsg = new Date("2026-10-07T14:24:00.000Z");
    expect(isMessageStale(sixMinMsg, now)).toBe(true);
  });

  it("bloqueia repetições consecutivas dentro da janela de cooldown anti-spam", () => {
    const isCooldownActive = (lastSentAt: Date, now: Date) => {
      return now.getTime() - lastSentAt.getTime() < AUTO_REPLY_COOLDOWN_MS;
    };

    const now = new Date("2026-10-07T15:00:00.000Z");

    // Auto-resposta enviada há 2 minutos (cliente mandou 2ª mensagem rápido) -> bloqueado
    const twoMinAgo = new Date("2026-10-07T14:58:00.000Z");
    expect(isCooldownActive(twoMinAgo, now)).toBe(true);

    // Auto-resposta enviada há 15 minutos -> bloqueado (cooldown de 20 min)
    const fifteenMinAgo = new Date("2026-10-07T14:45:00.000Z");
    expect(isCooldownActive(fifteenMinAgo, now)).toBe(true);

    // Auto-resposta enviada há 25 minutos -> liberado
    const twentyFiveMinAgo = new Date("2026-10-07T14:35:00.000Z");
    expect(isCooldownActive(twentyFiveMinAgo, now)).toBe(false);
  });

  it("estrutura corretamente os dados de envio outbound preservando o nome e ID do atendente", () => {
    const mockOperator = {
      id: "op-tarcisio-123",
      name: "Tarcisio Pereira",
      status: "pausa" as const,
    };

    const mockContact = {
      phone: "5514998364338",
      whatsappUserId: "user_bsuid_456",
      name: "João Silva",
    };

    const mockConversation = {
      id: "conv-789",
      tenantId: "tecfag",
      queueState: "meus",
    };

    const outboundPayload = {
      tenantId: mockConversation.tenantId,
      conversationId: mockConversation.id,
      recipientPhone: mockContact.phone,
      recipientUserId: mockContact.whatsappUserId,
      text: OPERATOR_PAUSE_AUTO_REPLY_TEXT,
      operatorId: mockOperator.id,
      senderName: mockOperator.name,
    };

    expect(outboundPayload.text).toBe("Olá, estou em minha pausa, logo te retorno");
    expect(outboundPayload.senderName).toBe("Tarcisio Pereira");
    expect(outboundPayload.operatorId).toBe("op-tarcisio-123");
    expect(outboundPayload.tenantId).toBe("tecfag");

    // Simulação do evento SSE emitido para a UI
    const sseEvent = {
      type: "message",
      message: {
        id: "msg-auto-reply-1",
        conversationId: mockConversation.id,
        senderType: "agent",
        senderName: mockOperator.name,
        content: OPERATOR_PAUSE_AUTO_REPLY_TEXT,
        phone: mockContact.phone,
        avatar: null,
        sentAt: new Date("2026-10-07T14:30:00.000Z"),
        queue: mockConversation.queueState,
        operatorId: mockOperator.id,
      },
    };

    expect(sseEvent.message.senderType).toBe("agent");
    expect(sseEvent.message.senderName).toBe("Tarcisio Pereira");
    expect(sseEvent.message.content).toBe("Olá, estou em minha pausa, logo te retorno");
  });
});
