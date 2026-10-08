import { useEffect, useState } from "react";
import { fetchUnclassifiedCohortDeals } from "@/lib/commercial/cohort-drilldown-client";
import type { TVUnclassifiedDeal } from "@/lib/commercial/safras-cohorts-data";

export function useCommercialCohortDeals(month: string | null, division: string) {
  const [deals, setDeals] = useState<TVUnclassifiedDeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!month) return;
    const controller = new AbortController();
    setDeals([]);
    setError(null);
    setLoading(true);
    void fetchUnclassifiedCohortDeals(month, division, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setDeals(items);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Falha ao carregar negócios da safra.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [month, division]);
  return { deals, loading, error };
}
