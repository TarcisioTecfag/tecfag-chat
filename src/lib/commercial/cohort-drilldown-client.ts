import type { TVUnclassifiedDeal } from "./safras-cohorts-data";

type ApiDeal = {
  id: string;
  title: string;
  operatorId?: string | null;
  operatorName: string | null;
  operatorAvatar?: string | null;
  division: string | null;
  pipelineName: string;
  stageName: string;
  value: number;
  createdAt: string;
  status: string;
  accountName: string | null;
};

export async function fetchUnclassifiedCohortDeals(
  month: string,
  division: string,
  signal: AbortSignal,
): Promise<TVUnclassifiedDeal[]> {
  const result: ApiDeal[] = [];
  let page = 1;
  let total = 0;
  do {
    const params = new URLSearchParams({
      view: "cohort-deals",
      month,
      unclassified: "true",
      page: String(page),
      limit: "100",
    });
    if (division) params.set("division", division);
    const response = await fetch(`/api/commercial/analysis?${params}`, {
      credentials: "same-origin",
      signal,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Falha ao carregar negócios da safra.");
    total = body.total;
    result.push(...body.deals);
    page += 1;
  } while (result.length < total && !signal.aborted);
  return result.map((deal) => ({
    id: deal.id,
    name: deal.title,
    userName: deal.operatorName || "Consultor",
    userAvatar: deal.operatorAvatar || undefined,
    team:
      deal.division === "maquinas"
        ? "Máquinas"
        : deal.division === "personnalite"
          ? "Personnalité"
          : "Comercial",
    pipelineName: deal.pipelineName,
    stageName: deal.stageName,
    totalPrice: deal.value,
    dealCreatedAt: deal.createdAt,
    status: deal.status,
    companyName: deal.accountName || undefined,
  }));
}
