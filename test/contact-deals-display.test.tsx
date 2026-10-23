import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RdMarketingJourneyControls } from "../src/components/crm/RdMarketingJourneyControls";

test("a jornada mostra andamento antes do card vendido em visualização e identifica o contato", () => {
  const common = {
    value: null,
    currency: "BRL",
    pipelineName: "Comercial",
    stageName: "Entrada",
    operatorName: "Operador",
  };
  const markup = renderToStaticMarkup(
    <RdMarketingJourneyControls
      currentDealId="closed"
      contacts={[{ id: "contact", name: "Cliente do atendimento" }]}
      contactId="contact"
      onContact={() => {}}
      onLoad={() => {}}
      journey={{
        loading: false,
        error: "",
        refresh: () => {},
        nextPages: [],
        next: () => {},
        data: {
          contactId: "contact",
          contactName: "Cliente do atendimento",
          snapshotId: "snapshot",
          syncedAt: "2026-10-23T00:00:00Z",
          cached: true,
          pages: [],
          events: [],
          relatedDeals: [
            {
              ...common,
              id: "closed",
              title: "Compra anterior",
              status: "won",
              createdAt: "2030-01-01",
            },
            {
              ...common,
              id: "open",
              title: "Máquina em negociação",
              status: "open",
              createdAt: "2026-10-21",
            },
          ],
        },
      }}
    />,
  );
  expect(markup.indexOf("Máquina em negociação")).toBeLessThan(markup.indexOf("Compra anterior"));
  expect(markup).toContain("Cliente do atendimento");
  expect(markup).toContain("Card em visualização");
  expect(markup).not.toContain("Card atual");
});
