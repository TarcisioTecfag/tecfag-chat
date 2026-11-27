// @ts-expect-error bun:test is provided by Bun runtime
import { describe, expect, it } from "bun:test";
import { getConversationSortTimestamp, type Conversation, type Message } from "../lib/mockData";
import {
  classifyConversationMessageSender,
  formatBrtDateDDMMYYYY,
  formatBrtTimeAndDate,
  formatBrtTimeHHMM,
  getConversationLastRealMessage,
  getConversationPreviewMessage,
  getConversationPreviewPrefix,
  getConversationPreviewTime,
} from "../lib/chat-preview";

function makeMsg(overrides: Partial<Message>): Message {
  return {
    id: `m-${Math.random().toString(36).slice(2, 7)}`,
    author: "Teste",
    text: "Mensagem",
    time: "10:00",
    side: "in",
    ...overrides,
  };
}

function makeConv(overrides: Partial<Conversation>): Conversation {
  return {
    id: "conv-1",
    name: "Cliente Teste",
    avatar: "",
    tags: [],
    channel: "whatsapp",
    queue: "meus",
    messages: [],
    lastMessageTime: "10:00",
    unreadCount: 0,
    ...overrides,
  };
}

describe("chat-preview sender classification & prefixes", () => {
  it("classifies client messages as 'client' with prefix 'Ele'", () => {
    const msg = makeMsg({ side: "in", senderType: "client", author: "João", text: "Bom dia" });
    expect(classifyConversationMessageSender(msg)).toBe("client");
    expect(getConversationPreviewPrefix(msg)).toBe("Ele");
  });

  it("classifies operator messages (with or without senderType) as 'operator' with prefix 'Você'", () => {
    const confirmed = makeMsg({ side: "out", senderType: "agent", author: "Você", text: "Olá!" });
    const optimistic = makeMsg({ side: "out", author: "Você", text: "Enviando..." });
    const bot = makeMsg({
      side: "out",
      senderType: "bot",
      author: "Fagner",
      text: "Posso ajudar?",
    });

    expect(classifyConversationMessageSender(confirmed)).toBe("operator");
    expect(getConversationPreviewPrefix(confirmed)).toBe("Você");
    expect(classifyConversationMessageSender(optimistic)).toBe("operator");
    expect(getConversationPreviewPrefix(optimistic)).toBe("Você");
    expect(classifyConversationMessageSender(bot)).toBe("operator");
    expect(getConversationPreviewPrefix(bot)).toBe("Você");
  });

  it("returns 'none' / null prefix for internal notes and system logs", () => {
    const note = makeMsg({
      side: "out",
      senderType: "agent",
      isInternalNote: true,
      text: "Nota interna",
    });
    const sys = makeMsg({
      side: "out",
      senderType: "system",
      author: "Sistema",
      text: "Transferido",
    });

    expect(classifyConversationMessageSender(note)).toBe("none");
    expect(getConversationPreviewPrefix(note)).toBeNull();
    expect(classifyConversationMessageSender(sys)).toBe("none");
    expect(getConversationPreviewPrefix(sys)).toBeNull();
  });

  it("keeps card color based on the last REAL message even when followed by an internal note or system log", () => {
    const clientThenNote = [
      makeMsg({ id: "1", side: "in", senderType: "client", text: "Oi, qual o valor?" }),
      makeMsg({
        id: "2",
        side: "out",
        senderType: "agent",
        isInternalNote: true,
        text: "Responder urgente",
      }),
    ];
    const lastReal1 = getConversationLastRealMessage(clientThenNote);
    expect(lastReal1?.id).toBe("1");
    expect(classifyConversationMessageSender(lastReal1)).toBe("client");

    const operatorThenSystem = [
      makeMsg({ id: "1", side: "in", senderType: "client", text: "Oi" }),
      makeMsg({ id: "2", side: "out", senderType: "agent", text: "Enviei a proposta!" }),
      makeMsg({
        id: "3",
        side: "out",
        senderType: "system",
        author: "Sistema",
        text: "Negociação atual vinculada",
      }),
    ];
    const lastReal2 = getConversationLastRealMessage(operatorThenSystem);
    expect(lastReal2?.id).toBe("2");
    expect(classifyConversationMessageSender(lastReal2)).toBe("operator");
  });
});

describe("getConversationSortTimestamp (sort on both client and operator messages)", () => {
  it("moves conversation to the top when operator sends a newer message", () => {
    const convWithNewerClient = makeConv({
      id: "conv-client",
      lastMessageAtISO: "2026-11-19T13:10:00.000Z",
      lastClientMessageAtISO: "2026-11-19T13:10:00.000Z",
      messages: [
        makeMsg({
          id: "c1",
          side: "in",
          senderType: "client",
          sentAtISO: "2026-11-19T13:10:00.000Z",
        }),
      ],
    });

    const convRepliedByOperator = makeConv({
      id: "conv-operator",
      lastMessageAtISO: "2026-11-19T13:15:00.000Z",
      lastClientMessageAtISO: "2026-11-19T13:00:00.000Z",
      messages: [
        makeMsg({
          id: "o1",
          side: "in",
          senderType: "client",
          sentAtISO: "2026-11-19T13:00:00.000Z",
        }),
        makeMsg({
          id: "o2",
          side: "out",
          senderType: "agent",
          sentAtISO: "2026-11-19T13:15:00.000Z",
        }),
      ],
    });

    const ordered = [convWithNewerClient, convRepliedByOperator].sort(
      (a, b) => getConversationSortTimestamp(b) - getConversationSortTimestamp(a),
    );
    expect(ordered[0].id).toBe("conv-operator");
    expect(ordered[1].id).toBe("conv-client");
  });

  it("keeps client message rising to the top when client replies later", () => {
    const convOperatorEarlier = makeConv({
      id: "conv-operator",
      lastMessageAtISO: "2026-11-19T13:15:00.000Z",
      messages: [
        makeMsg({ side: "out", senderType: "agent", sentAtISO: "2026-11-19T13:15:00.000Z" }),
      ],
    });

    const convClientLater = makeConv({
      id: "conv-client",
      lastMessageAtISO: "2026-11-19T13:20:00.000Z",
      lastClientMessageAtISO: "2026-11-19T13:20:00.000Z",
      messages: [
        makeMsg({ side: "in", senderType: "client", sentAtISO: "2026-11-19T13:20:00.000Z" }),
      ],
    });

    const ordered = [convOperatorEarlier, convClientLater].sort(
      (a, b) => getConversationSortTimestamp(b) - getConversationSortTimestamp(a),
    );
    expect(ordered[0].id).toBe("conv-client");
  });

  it("ignores internal notes and system messages when computing sort timestamp", () => {
    const convWithNote = makeConv({
      id: "conv-note",
      lastMessageAtISO: "2026-11-19T13:00:00.000Z",
      messages: [
        makeMsg({ side: "in", senderType: "client", sentAtISO: "2026-11-19T13:00:00.000Z" }),
        makeMsg({
          side: "out",
          senderType: "agent",
          isInternalNote: true,
          sentAtISO: "2026-11-19T13:50:00.000Z",
        }),
        makeMsg({
          side: "out",
          senderType: "system",
          author: "Sistema",
          sentAtISO: "2026-11-19T13:55:00.000Z",
        }),
      ],
    });

    const convNewerReal = makeConv({
      id: "conv-real",
      lastMessageAtISO: "2026-11-19T13:10:00.000Z",
      messages: [
        makeMsg({ side: "out", senderType: "agent", sentAtISO: "2026-11-19T13:10:00.000Z" }),
      ],
    });

    expect(getConversationSortTimestamp(convWithNote)).toBe(Date.parse("2026-11-19T13:00:00.000Z"));
    expect(getConversationSortTimestamp(convNewerReal)).toBe(
      Date.parse("2026-11-19T13:10:00.000Z"),
    );
    expect(getConversationSortTimestamp(convNewerReal)).toBeGreaterThan(
      getConversationSortTimestamp(convWithNote),
    );
  });
});

describe("getConversationPreviewTime (HH:mm - DD/MM/YYYY in BRT)", () => {
  it("formats ISO timestamps in America/Sao_Paulo including UTC day rollover", () => {
    expect(formatBrtTimeHHMM("2026-11-27T13:08:00.000Z")).toBe("10:08");
    expect(formatBrtDateDDMMYYYY("2026-11-27T13:08:00.000Z")).toBe("27/11/2026");
    expect(formatBrtTimeAndDate("2026-11-27T13:08:00.000Z")).toBe("10:08 - 27/11/2026");
    // 01:15 UTC em 28/11 equivale a 22:15 BRT de 27/11
    expect(formatBrtTimeAndDate("2026-11-28T01:15:00.000Z")).toBe("22:15 - 27/11/2026");
    expect(formatBrtTimeAndDate("invalid-date")).toBeNull();
  });

  it("shows time and date from the last non-system message", () => {
    const conv = makeConv({
      lastMessageTime: "15:47",
      lastMessageAtISO: "2026-11-26T18:47:00.000Z",
      messages: [
        makeMsg({
          id: "m1",
          side: "out",
          senderType: "agent",
          time: "15:47",
          sentAtISO: "2026-11-26T18:47:00.000Z",
          text: "Olá, seja bem-vindo(a)",
        }),
        makeMsg({
          id: "m2",
          side: "out",
          senderType: "system",
          author: "Sistema",
          time: "16:00",
          sentAtISO: "2026-11-27T19:00:00.000Z",
          text: "Transferido",
        }),
      ],
    });

    const previewMsg = getConversationPreviewMessage(conv.messages);
    expect(previewMsg?.id).toBe("m1");
    expect(getConversationPreviewTime(conv, previewMsg)).toBe("15:47 - 26/11/2026");
  });

  it("combines time and date fields when message has no sentAtISO", () => {
    const convWithDateField = makeConv({
      lastMessageTime: "10:08",
      messages: [
        makeMsg({
          id: "m1",
          time: "10:08",
          date: "27/11/2026",
          sentAtISO: undefined,
        }),
      ],
    });
    expect(getConversationPreviewTime(convWithDateField)).toBe("10:08 - 27/11/2026");

    const convWithConvIsoFallback = makeConv({
      lastMessageTime: "08:43",
      lastMessageAtISO: "2026-11-26T11:43:00.000Z",
      messages: [
        makeMsg({
          id: "m2",
          time: "08:43",
          date: undefined,
          sentAtISO: undefined,
        }),
      ],
    });
    expect(getConversationPreviewTime(convWithConvIsoFallback)).toBe("08:43 - 26/11/2026");
  });

  it("falls back to conversation.lastMessageAtISO when messages are empty and to lastMessageTime when no ISO exists", () => {
    const emptyMsgsWithIso = makeConv({
      lastMessageTime: "12:22",
      lastMessageAtISO: "2026-11-26T15:22:00.000Z",
      messages: [],
    });
    expect(getConversationPreviewTime(emptyMsgsWithIso)).toBe("12:22 - 26/11/2026");

    const legacyNoIso = makeConv({
      lastMessageTime: "Agora",
      lastMessageAtISO: undefined,
      messages: [],
    });
    expect(getConversationPreviewTime(legacyNoIso)).toBe("Agora");
  });
});
