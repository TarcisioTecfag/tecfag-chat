import { ArrowUpRight, BriefcaseBusiness, Loader2, UserRound } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemTooltip } from "@/components/ui/tooltip";
import type { RdJourney, RelatedDeal } from "@/lib/rd-marketing/journey-types";
import type { RdEventPage } from "@/lib/rd-marketing/api-types";
import { DealStatusBadge } from "./deal-status-config";
import { sortContactDeals } from "@/lib/crm/conversation-deal-policy";

export function ContactDealsList({
  deals,
  currentDealId,
  contactName,
}: {
  deals: RelatedDeal[];
  currentDealId: string;
  contactName?: string;
}) {
  if (!deals.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
        <BriefcaseBusiness className="mx-auto mb-2 h-6 w-6 text-muted-foreground/60" />
        <p className="text-xs font-semibold text-foreground">
          Nenhuma negociação vinculada a este contato
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Quando o contato participar de negociações, elas aparecerão listadas aqui.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Negociações vinculadas ao contato"
      className="rounded-xl border border-border bg-card p-3 sm:p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <BriefcaseBusiness className="h-4 w-4 text-primary shrink-0" />
        <h3 className="text-sm font-semibold text-foreground">Negociações deste contato</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">
          {deals.length}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {contactName ? (
          <>
            Contato: <strong>{contactName}</strong>.{" "}
          </>
        ) : null}
        As negociações em andamento aparecem primeiro, seguidas pelo histórico.
      </p>
      <div className="grid gap-3 md:grid-cols-2 max-h-[420px] overflow-y-auto pr-1">
        {sortContactDeals(deals).map((deal) => {
          const current = deal.id === currentDealId;
          let value = "Valor não informado";
          if (deal.value !== null && Number.isFinite(Number(deal.value))) {
            try {
              value = new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: deal.currency || "BRL",
              }).format(Number(deal.value));
            } catch {
              value = `${deal.value} ${deal.currency || "BRL"}`;
            }
          }
          return (
            <SystemTooltip
              key={deal.id}
              content={
                current
                  ? "Você já está visualizando esta negociação"
                  : `Abrir negociação "${deal.title}"`
              }
            >
              <a
                href={`/crm/deals/${encodeURIComponent(deal.id)}`}
                aria-current={current ? "page" : undefined}
                className={`group min-w-0 rounded-lg border p-3 space-y-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  current ? "border-primary/30 bg-primary/5" : "border-border bg-background"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <DealStatusBadge status={deal.status} size="sm" className="rounded-full" />
                  {current && (
                    <span className="text-[11px] font-semibold text-primary">
                      Card em visualização
                    </span>
                  )}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground break-words">
                    {deal.title}
                  </span>
                  <ArrowUpRight
                    className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary"
                    aria-hidden="true"
                  />
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Funil</dt>
                    <dd className="mt-0.5 break-words text-foreground">
                      {deal.pipelineName || "Não informado"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Etapa</dt>
                    <dd className="mt-0.5 break-words text-foreground">
                      {deal.stageName || "Não informada"}
                    </dd>
                  </div>
                </dl>
                <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="break-words">{deal.operatorName || "Sem responsável"}</span>
                </div>
                <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-2 text-xs">
                  <span className="font-semibold text-foreground">{value}</span>
                  <span className="text-muted-foreground">
                    Criada em {new Date(deal.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </a>
            </SystemTooltip>
          );
        })}
      </div>
    </section>
  );
}

type Props = {
  currentDealId: string;
  contacts: { id: string; name: string }[];
  contactId: string;
  onContact: (id: string) => void;
  onLoad: () => void;
  hideRelatedDeals?: boolean;
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
  currentDealId,
  contacts,
  contactId,
  onContact,
  onLoad,
  hideRelatedDeals = false,
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
        <SystemTooltip
          content={
            journey.data
              ? "Consultar o RD Marketing novamente para buscar novos eventos"
              : "Carregar e salvar a jornada RD Marketing deste contato"
          }
        >
          <button
            type="button"
            disabled={journey.loading || !contactId}
            onClick={() => (journey.data ? journey.refresh() : onLoad())}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-2 cursor-pointer hover:bg-muted/60 transition-colors"
          >
            {journey.loading && <Loader2 className="w-3 h-3 animate-spin" />}
            {journey.data ? "Atualizar jornada" : "Carregar jornada RD Marketing"}
          </button>
        </SystemTooltip>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Conversões e oportunidades de toda a jornada deste contato, inclusive anteriores a este
        card. Cada contato possui sua própria jornada salva permanentemente no sistema.
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
          {!hideRelatedDeals && !!journey.data.relatedDeals?.length && (
            <ContactDealsList
              deals={journey.data.relatedDeals}
              currentDealId={currentDealId}
              contactName={journey.data.contactName}
            />
          )}
          <p className="text-[11px] text-muted-foreground">
            Última consulta ao RD: {new Date(journey.data.syncedAt).toLocaleString("pt-BR")}.{" "}
            Histórico salvo permanentemente. Use Atualizar jornada apenas se quiser buscar novos eventos.
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
