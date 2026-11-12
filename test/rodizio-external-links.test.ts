import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildRodizioChatHref,
  buildRodizioNegotiationHref,
  buildRodizioTriageHref,
  parseSdrTargetFromSearch,
} from "../src/lib/rodizio-external-links";
import type { CrmDeal, OperatorCard } from "../src/components/valentina/rodizio-dashboard-types";

describe("Rodizio External Links (Nova Guia)", () => {
  const sampleCard: OperatorCard = {
    id: "conv-rafael-123",
    name: "Rafael Lima",
    company: "Tecfag Clientes",
    created_at: "2026-11-12T14:00:00.000Z",
    chatId: "conv-rafael-123",
    rdDealId: "deal-998877",
    phone: "+55 (16) 99123-4567",
    subject: "FUNIL MÁQUINAS",
  };

  const sampleDeals: CrmDeal[] = [
    {
      id: "deal-998877",
      rd_deal_id: "deal-998877",
      name: "Rafael Lima",
      company: "Tecfag Clientes",
      phone: "+55 (16) 99123-4567",
      operator_name: "Beatriz Ribeiro",
      sector: "maquinas",
      funnel: "FUNIL MÁQUINAS",
      created_at: "2026-11-12T14:00:00.000Z",
    },
  ];

  test("buildRodizioTriageHref gera link para /ia/sdr com parâmetros completos e faz round-trip em parseSdrTargetFromSearch", () => {
    const href = buildRodizioTriageHref(sampleCard);
    expect(href.startsWith("/ia/sdr?")).toBe(true);

    const search = href.slice("/ia/sdr".length);
    const parsed = parseSdrTargetFromSearch(search);
    expect(parsed).not.toBeNull();
    expect(parsed?.conversationId).toBe("conv-rafael-123");
    expect(parsed?.dealId).toBe("deal-998877");
    expect(parsed?.phone).toBe("5516991234567");
    expect(parsed?.leadName).toBe("Rafael Lima");
  });

  test("buildRodizioChatHref prioriza chatId, depois id de conversa, dealId e telefone", () => {
    expect(buildRodizioChatHref(sampleCard)).toBe("/chat/conv-rafael-123");

    const dealOnlyCard: OperatorCard = {
      id: "deal-abc-1",
      name: "Cliente Sem Conv Direta",
      created_at: "2026-11-12T14:00:00.000Z",
      rdDealId: "deal-abc-1",
      phone: "(11) 98888-7777",
    };
    expect(buildRodizioChatHref(dealOnlyCard)).toBe("/chat/deal-abc-1");

    const phoneOnlyCard: OperatorCard = {
      id: "",
      name: "Cliente Telefone",
      created_at: "2026-11-12T14:00:00.000Z",
      phone: "(11) 98888-7777",
    };
    expect(buildRodizioChatHref(phoneOnlyCard)).toBe("/chat/11988887777");
  });

  test("buildRodizioNegotiationHref abre /crm/deals/:dealId?from=valentina ou fallback /negociacoes/quadro", () => {
    expect(buildRodizioNegotiationHref(sampleCard, sampleDeals)).toBe(
      "/crm/deals/deal-998877?from=valentina",
    );

    const cardWithoutDeal: OperatorCard = {
      id: "conv-pos-venda-1",
      name: "Cliente Pós Venda",
      created_at: "2026-11-12T14:00:00.000Z",
    };
    expect(buildRodizioNegotiationHref(cardWithoutDeal, sampleDeals)).toBe(
      "/negociacoes/quadro",
    );
  });

  test("LeadOpenActionPopup em RodizioTab.tsx renderiza Ver Triagem, Ver Conversa e Ver Negociação com target='_blank' sem navegar na guia atual", () => {
    const rodizioSource = readFileSync(
      resolve(process.cwd(), "src/components/valentina/RodizioTab.tsx"),
      "utf8",
    );

    const popupStart = rodizioSource.indexOf("function LeadOpenActionPopup");
    const popupEnd = rodizioSource.indexOf("function LeadCardItem");
    expect(popupStart).toBeGreaterThan(-1);
    expect(popupEnd).toBeGreaterThan(popupStart);

    const popupBlock = rodizioSource.slice(popupStart, popupEnd);
    expect(popupBlock).toContain("Ver Triagem");
    expect(popupBlock).toContain("Ver Conversa");
    expect(popupBlock).toContain("Ver Negociação");

    const targetBlankMatches = popupBlock.match(/target="_blank"/g) || [];
    expect(targetBlankMatches.length).toBe(3);

    const noopenerMatches = popupBlock.match(/rel="noopener noreferrer"/g) || [];
    expect(noopenerMatches.length).toBe(3);

    expect(popupBlock).not.toContain("setActiveView(");
    expect(popupBlock).not.toContain("setSelectedChatId(");
    expect(popupBlock).not.toContain("navigate(");
  });
});
