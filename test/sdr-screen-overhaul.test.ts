import { describe, it, expect } from "bun:test";
import {
  resolveFaithfulSdrStatus,
  resolveCleanTargetFunnel,
} from "../src/routes/api/valentina/sdr";
import { computeIndustrialTriageProgress } from "../src/lib/triage/industrial-policy";
import {
  resolveSweepDateRange,
  getBrtDateKeyFromDate,
} from "../src/lib/triage/sdr-sweep";
import {
  DEFAULT_SDR_FILTER_STATE,
  filterSdrSessions,
  hasActiveSdrFilters,
} from "../src/components/valentina/sdr-kanban-data";
import {
  buildSdrTimelineItems,
  type SdrTriageSession,
} from "../src/components/valentina/SdrTab";

function makeSession(overrides: Partial<SdrTriageSession> = {}): SdrTriageSession {
  return {
    id: "fs-1",
    conversationId: "conv-1",
    contactName: "Tarcisio Pereira Do Nascimento",
    company: "TECFAG COMERCIO E IMPORTACAO DE MAQUINAS LTDA",
    phone: "5514998364338",
    currentStep: "Sem Resposta",
    collectedData: {},
    startedAt: "2026-10-28T16:57:09.000Z",
    lastClientMessageAt: "2026-11-19T18:51:46.000Z",
    lastMessageAt: "2026-11-19T18:59:36.870Z",
    status: "abandoned",
    outcome: "abandoned",
    responsibleName: "Denise Gomes",
    channel: "whatsapp",
    unreadCount: 0,
    messages: [],
    ...overrides,
  };
}

describe("SDR Screen Overhaul — Status, Progresso, Timeline, Filtros e Varredura", () => {
  it("resolveFaithfulSdrStatus NUNCA mascara triagem abandoned/stopped como completed quando humano assume", () => {
    expect(resolveFaithfulSdrStatus("abandoned", "manual")).toBe("abandoned");
    expect(resolveFaithfulSdrStatus("abandoned", "closed")).toBe("abandoned");
    expect(resolveFaithfulSdrStatus("stopped", "manual")).toBe("stopped");
    expect(resolveFaithfulSdrStatus("transferred", "manual")).toBe("completed");
    expect(resolveFaithfulSdrStatus("completed", "closed")).toBe("completed");
    expect(resolveFaithfulSdrStatus("in_progress", "manual")).toBe("manual");
    expect(resolveFaithfulSdrStatus("in_progress", "collecting")).toBe("active");
    expect(resolveFaithfulSdrStatus("in_progress", "no_response")).toBe("abandoned");
  });

  it("resolveCleanTargetFunnel bloqueia vazamento de 'Aguardando...' em campos pending", () => {
    expect(
      resolveCleanTargetFunnel(
        {},
        { "SETOR / FUNIL DE DESTINO": { value: "Aguardando...", status: "pending" } },
      ),
    ).toBeUndefined();

    expect(
      resolveCleanTargetFunnel(
        { targetFunnel: "Aguardando..." },
        { "SETOR / FUNIL DE DESTINO": { value: "Aguardando...", status: "filled" } },
      ),
    ).toBeUndefined();

    expect(
      resolveCleanTargetFunnel(
        {},
        { "SETOR / FUNIL DE DESTINO": { value: "Máquinas", status: "filled" } },
      ),
    ).toBe("Máquinas");

    expect(resolveCleanTargetFunnel({ targetFunnel: "Peças" }, {})).toBe("Peças");
  });

  it("computeIndustrialTriageProgress calcula porcentagem fiel a Campos X/Y sem forçar 100%", () => {
    const partial = computeIndustrialTriageProgress({
      collectedData: {
        "NOME COMPLETO": { value: "Tarcisio", status: "filled" },
        EMPRESA: { value: "Tecfag", status: "filled" },
        "CNPJ OU CPF": { value: "12.345.678/0001-99", status: "filled" },
      },
      isCompleted: true,
    });
    expect(partial.filledCount).toBe(3);
    expect(partial.totalCount).toBe(7);
    expect(partial.percentage).toBe(43);

    const empty = computeIndustrialTriageProgress({
      collectedData: {},
      isCompleted: true,
    });
    expect(empty.filledCount).toBe(0);
    expect(empty.totalCount).toBe(7);
    expect(empty.percentage).toBe(0);
  });

  it("buildSdrTimelineItems preserva eventos genéricos de sistema sem fabricar ciclos falsos do Fagner nem 'Setor: Aguardando...'", () => {
    const session = makeSession({
      targetFunnel: "Aguardando...",
      messages: [
        {
          id: "m1",
          sender: "agent",
          senderName: "Tarcisio Pereira",
          text: "L",
          time: "16:29",
          date: "13/11/2026",
          sentAt: "2026-11-13T19:29:10.000Z",
        },
        {
          id: "sys1",
          sender: "system",
          senderName: "Sistema",
          text: "Atendimento encerrado e encaminhado para os Finalizados.",
          time: "15:35",
          date: "19/11/2026",
          sentAt: "2026-11-19T18:35:19.000Z",
          isCycleReset: false,
        },
        {
          id: "sys2",
          sender: "system",
          senderName: "Sistema",
          text: "Atendimento assumido por Denise Gomes.",
          time: "15:51",
          date: "19/11/2026",
          sentAt: "2026-11-19T18:51:10.000Z",
          isCycleReset: false,
        },
        {
          id: "m2",
          sender: "client",
          senderName: "Tarcisio Pereira Do Nascimento",
          text: "Oi",
          time: "15:51",
          date: "19/11/2026",
          sentAt: "2026-11-19T18:51:46.000Z",
        },
        {
          id: "m3",
          sender: "agent",
          senderName: "Denise Gomes",
          text: "oi",
          time: "15:59",
          date: "19/11/2026",
          sentAt: "2026-11-19T18:59:36.000Z",
        },
      ],
    });

    const timeline = buildSdrTimelineItems(session, "Fagner");
    const cycleDividers = timeline.filter((i) => i.type === "cycle-divider");
    const systemEvents = timeline.filter((i) => i.type === "system-event");

    // Zero ciclos falsos ou handoffs falsos!
    expect(cycleDividers.length).toBe(0);
    // Os dois eventos reais do sistema aparecem com o texto verdadeiro
    expect(systemEvents.length).toBe(2);
    expect(systemEvents[0].type === "system-event" && systemEvents[0].text).toContain("Finalizados");
    expect(systemEvents[1].type === "system-event" && systemEvents[1].text).toContain("Denise Gomes");
  });

  it("buildSdrTimelineItems cria divisores de ciclo quando há reset explícito de triagem", () => {
    const session = makeSession({
      status: "completed",
      targetFunnel: "Máquinas",
      messages: [
        {
          id: "m1",
          sender: "bot",
          senderName: "Fagner",
          text: "Olá!",
          time: "10:00",
          date: "18/11/2026",
          sentAt: "2026-11-18T13:00:00.000Z",
        },
        {
          id: "reset1",
          sender: "system",
          senderName: "Sistema",
          text: "Fluxo de triagem reiniciado",
          time: "10:00",
          date: "19/11/2026",
          sentAt: "2026-11-19T13:00:00.000Z",
          isCycleReset: true,
        },
        {
          id: "m2",
          sender: "bot",
          senderName: "Fagner",
          text: "Bom dia, como posso ajudar?",
          time: "10:01",
          date: "19/11/2026",
          sentAt: "2026-11-19T13:01:00.000Z",
        },
        {
          id: "m3",
          sender: "agent",
          senderName: "Denise Gomes",
          text: "Assumi por aqui!",
          time: "10:05",
          date: "19/11/2026",
          sentAt: "2026-11-19T13:05:00.000Z",
        },
      ],
    });

    const timeline = buildSdrTimelineItems(session, "Fagner");
    const cycleDividers = timeline.filter((i) => i.type === "cycle-divider");
    expect(cycleDividers.some((c) => c.type === "cycle-divider" && c.variant === "previous-triage")).toBe(true);
    expect(cycleDividers.some((c) => c.type === "cycle-divider" && c.variant === "new-triage")).toBe(true);
    const handoff = cycleDividers.find((c) => c.type === "cycle-divider" && c.variant === "operator-handoff");
    expect(handoff).toBeDefined();
    expect(handoff?.type === "cycle-divider" && handoff.subtitle).toBe("Setor: Máquinas");
  });

  it("filterSdrSessions unifica busca, canal (whatsapp/site), status, showCompleted e período em Brasília", () => {
    const now = new Date("2026-11-19T18:00:00.000Z"); // 15:00 BRT
    const sessions: SdrTriageSession[] = [
      makeSession({
        id: "s-active-site",
        contactName: "Maria Site",
        channel: "site",
        status: "active",
        unreadCount: 2,
        lastClientMessageAt: "2026-11-19T17:30:00.000Z",
        lastMessagePreview: "Quero uma seladora",
      }),
      makeSession({
        id: "s-completed-wpp",
        contactName: "João WhatsApp",
        channel: "whatsapp",
        status: "completed",
        unreadCount: 0,
        lastClientMessageAt: "2026-11-10T15:00:00.000Z",
      }),
      makeSession({
        id: "s-abandoned-wpp",
        contactName: "Globo Aço",
        channel: "whatsapp",
        status: "abandoned",
        unreadCount: 0,
        lastClientMessageAt: "2026-11-11T17:06:00.000Z",
      }),
    ];

    expect(
      filterSdrSessions(sessions, { ...DEFAULT_SDR_FILTER_STATE, searchQuery: "seladora" }, now).map((s) => s.id),
    ).toEqual(["s-active-site"]);

    expect(
      filterSdrSessions(sessions, { ...DEFAULT_SDR_FILTER_STATE, channelFilter: "site" }, now).map((s) => s.id),
    ).toEqual(["s-active-site"]);

    expect(
      filterSdrSessions(
        sessions,
        { ...DEFAULT_SDR_FILTER_STATE, statusFilter: "completed", showCompleted: false },
        now,
      ).map((s) => s.id),
    ).toEqual(["s-completed-wpp"]);

    expect(
      filterSdrSessions(sessions, { ...DEFAULT_SDR_FILTER_STATE, periodFilter: "hoje" }, now).map((s) => s.id),
    ).toEqual(["s-active-site"]);

    expect(hasActiveSdrFilters(DEFAULT_SDR_FILTER_STATE)).toBe(false);
    expect(hasActiveSdrFilters({ ...DEFAULT_SDR_FILTER_STATE, channelFilter: "site" })).toBe(true);
  });

  it("resolveSweepDateRange calcula corretamente Hoje, Tempo definido (inclusive invertido) e Todo tempo em Brasília", () => {
    const fixedNow = new Date("2026-11-20T01:30:00.000Z"); // 22:30 BRT de 19/11/2026!
    expect(getBrtDateKeyFromDate(fixedNow)).toBe("2026-11-19");

    const today = resolveSweepDateRange({ period: "today", now: fixedNow });
    expect(today.startUtc?.toISOString()).toBe("2026-11-19T03:00:00.000Z");
    expect(today.endUtc?.toISOString()).toBe("2026-11-20T02:59:59.999Z");

    const range = resolveSweepDateRange({
      period: "range",
      startDate: "2026-11-15",
      endDate: "2026-11-10",
      now: fixedNow,
    });
    expect(range.startUtc?.toISOString()).toBe("2026-11-10T03:00:00.000Z");
    expect(range.endUtc?.toISOString()).toBe("2026-11-16T02:59:59.999Z");

    const all = resolveSweepDateRange({ period: "all", now: fixedNow });
    expect(all.startUtc).toBeNull();
    expect(all.endUtc).toBeNull();
  });
});
