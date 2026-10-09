import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  prefetchDealDetail,
  fetchDealDetailWithCache,
  invalidateDealCache,
  fetchPipelinesCached,
  invalidatePipelinesCache,
} from "../src/lib/crm/deal-prefetch";

describe("CRM Performance — Hover Prefetching & Client-Side Cache (Fase 1)", () => {
  beforeEach(() => {
    invalidateDealCache();
    invalidatePipelinesCache();
  });

  it("deve carregar dados detalhados da negociação e servir do cache sem chamada de rede redundante", async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = mock((url: string | URL | Request) => {
      fetchCalls++;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          deal: {
            id: "deal-perf-1",
            title: "Envasadora Automática 500ml",
            value: "75000.00",
            status: "open",
          },
        }),
      } as Response);
    }) as any;

    try {
      // Primeira busca: dispara requisição de rede
      const result1 = await fetchDealDetailWithCache("deal-perf-1");
      expect(result1.deal.id).toBe("deal-perf-1");
      expect(result1.deal.title).toBe("Envasadora Automática 500ml");
      expect(fetchCalls).toBe(1);

      // Segunda busca imediata: deve vir direto da memória RAM (0ms)
      const result2 = await fetchDealDetailWithCache("deal-perf-1");
      expect(result2.deal.id).toBe("deal-perf-1");
      expect(fetchCalls).toBe(1); // Continua 1, rede NÃO foi acionada
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("deve pré-carregar em hover (prefetch) e entregar imediatamente quando o modal solicitar", async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = mock((url: string | URL | Request) => {
      fetchCalls++;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          deal: {
            id: "deal-hover-99",
            title: "Seladora a Vácuo Industrial",
            value: "18500.00",
          },
        }),
      } as Response);
    }) as any;

    try {
      // Simula evento onMouseEnter (usuário passa o mouse por cima do card)
      prefetchDealDetail("deal-hover-99");
      expect(fetchCalls).toBe(1);

      // Usuário passa o mouse de novo (debounce/proteção contra requisição duplicada)
      prefetchDealDetail("deal-hover-99");
      expect(fetchCalls).toBe(1);

      // Simula o clique do usuário 150ms depois: o modal pede os dados
      const data = await fetchDealDetailWithCache("deal-hover-99");
      expect(data.deal.title).toBe("Seladora a Vácuo Industrial");
      expect(fetchCalls).toBe(1); // Não gerou segunda requisição
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("deve permitir invalidar o cache cirurgicamente após edição da negociação", async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = mock(() => {
      fetchCalls++;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          deal: { id: "deal-edit-1", title: "Versão " + fetchCalls },
        }),
      } as Response);
    }) as any;

    try {
      await fetchDealDetailWithCache("deal-edit-1");
      expect(fetchCalls).toBe(1);

      // Invalidação cirúrgica do deal modificado
      invalidateDealCache("deal-edit-1");

      // Nova busca deve buscar versão atualizada do servidor
      const freshData = await fetchDealDetailWithCache("deal-edit-1");
      expect(freshData.deal.title).toBe("Versão 2");
      expect(fetchCalls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("deve reter funis em cache compartilhado evitando múltiplos downloads de /api/crm/pipelines", async () => {
    let pipelineFetchCalls = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = mock(() => {
      pipelineFetchCalls++;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          pipelines: [
            { id: "pipe-1", name: "Funil Máquinas" },
            { id: "pipe-2", name: "Funil Peças" },
          ],
        }),
      } as Response);
    }) as any;

    try {
      const p1 = await fetchPipelinesCached();
      const p2 = await fetchPipelinesCached();
      expect(p1.length).toBe(2);
      expect(p2.length).toBe(2);
      expect(pipelineFetchCalls).toBe(1); // Apenas 1 requisição para ambos
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
