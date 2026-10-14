import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RdJourney } from "@/lib/rd-marketing/journey-types";
import type { RdEventPage } from "@/lib/rd-marketing/api-types";

type Props = {
  contacts: { id: string; name: string }[];
  contactId: string;
  onContact: (id: string) => void;
  onLoad: () => void;
  journey: {
    data: RdJourney | null;
    loading: boolean;
    error: string;
    refresh: () => unknown;
    nextPages: RdEventPage[];
    next: (page: RdEventPage) => unknown;
  };
};
export function RdMarketingJourneyControls({
  contacts,
  contactId,
  onContact,
  onLoad,
  journey,
}: Props) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold">Jornada RD Marketing do contato</span>
        {contacts.length > 1 && (
          <Select value={contactId} onValueChange={onContact} disabled={journey.loading}>
            <SelectTrigger className="w-52 h-8 text-xs" aria-label="Contato da jornada">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {contacts.map((contact) => (
                <SelectItem key={contact.id} value={contact.id}>
                  {contact.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {contacts.length === 1 && (
          <span className="text-xs text-muted-foreground">{contacts[0].name}</span>
        )}
        <button
          type="button"
          disabled={journey.loading || !contactId}
          onClick={() => (journey.data ? journey.refresh() : onLoad())}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-2"
        >
          {journey.loading && <Loader2 className="w-3 h-3 animate-spin" />}
          {journey.data ? "Atualizar jornada" : "Carregar jornada RD Marketing"}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Conversões e oportunidades de toda a jornada deste contato, inclusive anteriores a este
        card. Cada contato possui sua própria jornada.
      </p>
      {!contactId && (
        <p className="text-xs text-muted-foreground">
          Vincule um contato à negociação para consultar a jornada.
        </p>
      )}
      {journey.error && (
        <p role="alert" className="text-xs text-destructive">
          {journey.error}
        </p>
      )}
      {journey.data && (
        <>
          <p className="text-[11px] text-muted-foreground">
            Consultado em {new Date(journey.data.syncedAt).toLocaleString("pt-BR")}
            {journey.data.cached ? " · Dados em cache" : ""}. Visitas, cliques e automações só
            aparecem se disponibilizados pela API.
          </p>
          {journey.data.pages.some((page) => !page.recognized) && (
            <p className="text-xs text-amber-700">
              O RD retornou um formato de histórico ainda não reconhecido. O administrador pode
              verificar o JSON nas configurações.
            </p>
          )}
          {!journey.data.events.length && journey.data.pages.every((page) => page.recognized) && (
            <p className="text-xs text-muted-foreground">
              Nenhuma conversão ou oportunidade retornada nas páginas consultadas.
            </p>
          )}
          {journey.nextPages.map((page) => (
            <button
              key={page.eventType}
              type="button"
              disabled={journey.loading}
              onClick={() => journey.next(page)}
              className="mr-2 rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Carregar mais {page.eventType === "CONVERSION" ? "conversões" : "oportunidades"}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
