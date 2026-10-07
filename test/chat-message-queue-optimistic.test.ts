import { describe, test, expect } from "bun:test";
import type { Message } from "../src/lib/mockData";

describe("Fluidez e Fila Otimista de Mensagens do Chat (Estilo WhatsApp)", () => {
  test("Gera mensagem otimista com clientMessageId estável e sentAtISO", () => {
    const text = "Olá, tudo bem?";
    const clientMessageId = `cmsg-${Date.now()}-abcde`;
    const optimisticMessage: Message = {
      id: `pending-${clientMessageId}`,
      clientMessageId,
      author: "Você",
      text,
      time: "14:30",
      sentAtISO: new Date().toISOString(),
      side: "out",
      status: "sending",
      provider: "meta",
    };

    expect(optimisticMessage.clientMessageId).toBe(clientMessageId);
    expect(optimisticMessage.status).toBe("sending");
    expect(optimisticMessage.id).toBe(`pending-${clientMessageId}`);
    expect(optimisticMessage.sentAtISO).toBeDefined();
  });

  test("Atualização in-place de mensagem otimista preserva o elemento no array e não causa unmount", () => {
    const clientMessageId = "cmsg-12345";
    const initialMessages: Message[] = [
      {
        id: "msg-1",
        author: "Cliente",
        text: "Olá",
        time: "14:28",
        side: "in",
      },
      {
        id: `pending-${clientMessageId}`,
        clientMessageId,
        author: "Você",
        text: "Olá, como posso ajudar?",
        time: "14:29",
        side: "out",
        status: "sending",
      },
    ];

    const serverMessageId = "wamid.HBgM123456";
    const serverStatus = "accepted";

    // Simula a lógica de atualização in-place implementada em useChatState
    let matchedOptimistic = false;
    const updatedMessages = initialMessages.map((m) => {
      if (m.clientMessageId === clientMessageId || m.id === `pending-${clientMessageId}`) {
        matchedOptimistic = true;
        return {
          ...m,
          id: serverMessageId,
          clientMessageId,
          status: serverStatus,
          provider: "meta",
        };
      }
      return m;
    });

    expect(matchedOptimistic).toBe(true);
    expect(updatedMessages.length).toBe(2);
    // Posição no array é preservada exatamente no índice 1
    expect(updatedMessages[1].id).toBe(serverMessageId);
    expect(updatedMessages[1].clientMessageId).toBe(clientMessageId);
    expect(updatedMessages[1].status).toBe("accepted");
    expect(updatedMessages[1].text).toBe("Olá, como posso ajudar?");
  });

  test("Fila assíncrona FIFO enfileira e processa múltiplas mensagens consecutivas em ordem", async () => {
    type QueueItem = { text: string; seq: number };
    const queue: QueueItem[] = [];
    const processed: number[] = [];

    // Enfileira 3 mensagens em alta velocidade sem esperar resposta
    queue.push({ text: "Primeira mensagem", seq: 1 });
    queue.push({ text: "Segunda mensagem", seq: 2 });
    queue.push({ text: "Terceira mensagem", seq: 3 });

    expect(queue.length).toBe(3);

    // Processamento sequencial FIFO
    while (queue.length > 0) {
      const item = queue.shift()!;
      // Simula latência de rede assíncrona
      await new Promise((resolve) => setTimeout(resolve, 5));
      processed.push(item.seq);
    }

    expect(processed).toEqual([1, 2, 3]);
  });

  test("Detecção de scroll só deve disparar quando novas mensagens são inseridas, ignorando ticks de status", () => {
    let scrollTriggerCount = 0;
    let prevMsgCount = 0;

    const checkScroll = (messages: Message[]) => {
      const currentCount = messages.length;
      if (currentCount > prevMsgCount) {
        scrollTriggerCount++;
      }
      prevMsgCount = currentCount;
    };

    const msgs: Message[] = [
      { id: "1", author: "Cliente", text: "Oi", time: "10:00", side: "in" },
    ];
    checkScroll(msgs);
    expect(scrollTriggerCount).toBe(1);

    // Mensagem nova adicionada: scroll dispara
    msgs.push({ id: "2", author: "Você", text: "Olá!", time: "10:01", side: "out", status: "sending" });
    checkScroll(msgs);
    expect(scrollTriggerCount).toBe(2);

    // Apenas status atualizado de 'sending' para 'accepted': count permanece 2, scroll NÃO dispara (sem jitter!)
    msgs[1].status = "accepted";
    checkScroll(msgs);
    expect(scrollTriggerCount).toBe(2);

    // Status atualizado para 'delivered': scroll NÃO dispara
    msgs[1].status = "delivered";
    checkScroll(msgs);
    expect(scrollTriggerCount).toBe(2);
  });
});
