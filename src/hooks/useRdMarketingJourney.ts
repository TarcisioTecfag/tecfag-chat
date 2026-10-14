import { useCallback, useEffect, useRef, useState } from "react";
import type { RdJourney } from "@/lib/rd-marketing/journey-types";
import type { RdEventPage } from "@/lib/rd-marketing/api-types";

export function mergeJourney(previous: RdJourney, next: RdJourney): RdJourney {
  if (previous.contactId !== next.contactId || previous.snapshotId !== next.snapshotId) return next;
  const events = new Map(previous.events.map((event) => [event.key, event]));
  for (const event of next.events) events.set(event.key, event);
  const pages = new Map(previous.pages.map((page) => [`${page.eventType}:${page.page}`, page]));
  for (const page of next.pages) pages.set(`${page.eventType}:${page.page}`, page);
  return { ...next, events: [...events.values()], pages: [...pages.values()] };
}

export function useRdMarketingJourney(
  tenant: string | null,
  dealId: string | null,
  contactId: string | null,
  enabled: boolean,
) {
  const key = JSON.stringify([tenant, dealId, contactId]);
  const [state, setState] = useState<{
    key: string;
    data: RdJourney | null;
    error: string;
    loading: boolean;
  }>({ key, data: null, error: "", loading: false });
  const pending = useRef<AbortController | null>(null);
  const request = useCallback(
    async (query: Record<string, string>, append = false) => {
      if (!dealId || !contactId) return;
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      setState((old) => ({
        key,
        data: old.key === key ? old.data : null,
        loading: true,
        error: "",
      }));
      try {
        const params = new URLSearchParams({ contactId, ...query });
        const response = await fetch(
          `/api/crm/deals/${encodeURIComponent(dealId)}/rd-marketing?${params}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Não foi possível consultar a jornada RD Marketing.");
        if (!controller.signal.aborted)
          setState((old) => ({
            key,
            data: append && old.key === key && old.data ? mergeJourney(old.data, data) : data,
            loading: false,
            error: "",
          }));
      } catch (error) {
        if (!controller.signal.aborted)
          setState((old) => ({
            key,
            data: old.key === key ? old.data : null,
            loading: false,
            error: error instanceof Error ? error.message : "Falha ao consultar a jornada.",
          }));
      }
    },
    [key, dealId, contactId],
  );
  useEffect(() => {
    if (enabled) void request({});
    return () => pending.current?.abort();
  }, [enabled, request]);
  const data = state.key === key ? state.data : null;
  const nextPages =
    data?.pages.filter(
      (page) =>
        page.nextPage &&
        !data.pages.some(
          (other) => other.eventType === page.eventType && other.page === page.nextPage,
        ),
    ) || [];
  return {
    data,
    loading: state.key === key && state.loading,
    error: state.key === key ? state.error : "",
    refresh: () => request({ refresh: "true" }),
    nextPages,
    next: (page: RdEventPage) =>
      data && page.nextPage
        ? request(
            { eventType: page.eventType, page: String(page.nextPage), snapshotId: data.snapshotId },
            true,
          )
        : undefined,
  };
}
