/**
 * Gerenciador de Pré-carregamento e Cache em Memória do CRM (Client-side)
 * 
 * Otimizado especificamente para computadores corporativos sem GPU dedicada:
 * - Reduz o tempo de abertura de negociações para 0ms (sensação instantânea).
 * - Evita tráfego duplicado de rede e ciclos de processamento desnecessários da CPU.
 * - Suporta prefetch silencioso em hover (onMouseEnter) nos cards e linhas de lista.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// TTL padrão: 60 segundos para negociações individuais
const DEAL_CACHE_TTL_MS = 60 * 1000;

// TTL para funis (estruturas estáveis): 5 minutos
const PIPELINES_CACHE_TTL_MS = 5 * 60 * 1000;

// Cache em memória de detalhes de negociação
const dealCache = new Map<string, CacheEntry<any>>();
const inFlightDealFetches = new Map<string, Promise<any>>();

// Cache em memória de funis e etapas
let cachedPipelines: CacheEntry<any[]> | null = null;
let inFlightPipelinesFetch: Promise<any[]> | null = null;

/**
 * Pré-carrega os dados detalhados de um deal quando o cursor passa sobre ele (hover).
 * Executa em background de forma silenciosa e não-bloqueante.
 */
export function prefetchDealDetail(dealId: string): void {
  if (!dealId) return;

  const now = Date.now();
  const cached = dealCache.get(dealId);
  if (cached && now - cached.timestamp < DEAL_CACHE_TTL_MS) {
    return; // Já está fresco na memória RAM
  }

  if (inFlightDealFetches.has(dealId)) {
    return; // Requisição já em voo
  }

  // Dispara fetch silencioso
  const fetchPromise = fetch(`/api/crm/deals/${dealId}`, {
    credentials: "include",
    headers: { "X-Prefetch": "true" },
  })
    .then(async (res) => {
      if (!res.ok) throw new Error("Falha no prefetch");
      const data = await res.json();
      dealCache.set(dealId, {
        data,
        timestamp: Date.now(),
      });
      return data;
    })
    .catch((err) => {
      // Falhas no prefetch são silenciosas e não quebram a interface
      console.debug("[Prefetch] Falha silenciosa no prefetch do deal:", dealId, err?.message);
      return null;
    })
    .finally(() => {
      inFlightDealFetches.delete(dealId);
    });

  inFlightDealFetches.set(dealId, fetchPromise);
}

/**
 * Obtém os dados detalhados de uma negociação aproveitando o cache em memória
 * ou aguardando o fetch já iniciado pelo prefetch no hover.
 */
export async function fetchDealDetailWithCache(dealId: string): Promise<any> {
  if (!dealId) throw new Error("dealId obrigatório");

  const now = Date.now();
  const cached = dealCache.get(dealId);
  if (cached && now - cached.timestamp < DEAL_CACHE_TTL_MS) {
    return cached.data;
  }

  const inFlight = inFlightDealFetches.get(dealId);
  if (inFlight) {
    const data = await inFlight;
    if (data) return data;
  }

  // Fetch padrão caso não estivesse em cache nem em voo
  const res = await fetch(`/api/crm/deals/${dealId}`, { credentials: "include" });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Não foi possível carregar a negociação.");
  }
  const data = await res.json();
  dealCache.set(dealId, {
    data,
    timestamp: Date.now(),
  });
  return data;
}

/**
 * Invalida o cache de uma negociação (ao salvar, mover ou alterar etapa).
 */
export function invalidateDealCache(dealId?: string): void {
  if (dealId) {
    dealCache.delete(dealId);
    inFlightDealFetches.delete(dealId);
  } else {
    dealCache.clear();
    inFlightDealFetches.clear();
  }
}

/**
 * Pré-carrega a lista de funis da empresa.
 */
export async function fetchPipelinesCached(): Promise<any[]> {
  const now = Date.now();
  if (cachedPipelines && now - cachedPipelines.timestamp < PIPELINES_CACHE_TTL_MS) {
    return cachedPipelines.data;
  }

  if (inFlightPipelinesFetch) {
    return inFlightPipelinesFetch;
  }

  inFlightPipelinesFetch = fetch("/api/crm/pipelines", { credentials: "include" })
    .then(async (res) => {
      if (!res.ok) throw new Error("Falha ao carregar funis");
      const data = await res.json();
      const pipelines = data.pipelines || [];
      cachedPipelines = {
        data: pipelines,
        timestamp: Date.now(),
      };
      return pipelines;
    })
    .finally(() => {
      inFlightPipelinesFetch = null;
    });

  return inFlightPipelinesFetch;
}

/**
 * Invalida o cache de funis se forem editados pelo usuário.
 */
export function invalidatePipelinesCache(): void {
  cachedPipelines = null;
  inFlightPipelinesFetch = null;
}
