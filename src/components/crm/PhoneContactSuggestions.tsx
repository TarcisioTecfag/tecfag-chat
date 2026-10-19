import { useEffect, useState } from "react";
import { phoneRegistrationError, formatPhoneNumber } from "@/lib/utils";
import {
  Phone,
  Mail,
  Building2,
  Columns3,
  UserCheck,
  Users,
  CheckCircle2,
  RotateCcw,
  ArrowRight,
  User,
} from "lucide-react";

export interface LinkedDealSummary {
  id: string;
  title: string;
  status?: string | null;
  value?: number | string | null;
  pipelineId?: string | null;
  stageId?: string | null;
}

export interface ExistingPhoneContact {
  id: string;
  name: string;
  phone: string | null;
  email?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  accountDocument?: string | null;
  mainChannel?: string | null;
  responsibleName?: string | null;
  dealsCount?: number;
  linkedDeals?: LinkedDealSummary[];
}

function getInitials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function isPhoneMatch(contactPhone?: string | null, queryPhone?: string): boolean {
  const cleanContact = (contactPhone || "").replace(/\D/g, "");
  const cleanQuery = (queryPhone || "").replace(/\D/g, "");
  if (cleanContact.length < 8 || cleanQuery.length < 8) return false;
  const suffix8Contact = cleanContact.slice(-8);
  const suffix8Query = cleanQuery.slice(-8);
  return suffix8Contact === suffix8Query;
}

export function SelectedExistingContactBanner({
  contact,
  onClear,
}: {
  contact: ExistingPhoneContact;
  onClear: () => void;
}) {
  const linkedDeals = contact.linkedDeals || [];
  const dealsCount = contact.dealsCount ?? linkedDeals.length;

  return (
    <div
      className="rounded-2xl border border-emerald-500/40 bg-emerald-500/[0.06] dark:bg-emerald-500/[0.08] p-3.5 shadow-xs space-y-2.5 animate-in fade-in duration-150"
      role="status"
    >
      <div className="flex items-center justify-between gap-2 border-b border-emerald-500/20 pb-2">
        <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="text-[11px] font-extrabold uppercase tracking-wider">
            Cadastro Existente Selecionado
          </span>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-foreground hover:bg-muted hover:text-primary transition cursor-pointer shadow-2xs"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Voltar ao cadastro</span>
        </button>
      </div>

      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500/15 border border-emerald-500/30 text-xs font-extrabold text-emerald-700 dark:text-emerald-300">
          {getInitials(contact.name)}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-extrabold text-foreground truncate">
              {contact.name}
            </span>
            {dealsCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                <Columns3 className="h-2.5 w-2.5" />
                {dealsCount} {dealsCount === 1 ? "negociação" : "negociações"}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-mono font-semibold text-foreground/90">
              <Phone className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
              {contact.phone ? formatPhoneNumber(contact.phone) : "Sem telefone"}
            </span>
            {contact.email && (
              <span className="inline-flex items-center gap-1 truncate max-w-[220px]">
                <Mail className="h-3 w-3 shrink-0 opacity-70" />
                <span className="truncate">{contact.email}</span>
              </span>
            )}
            {contact.accountName && (
              <span className="inline-flex items-center gap-1 font-semibold text-foreground/80">
                <Building2 className="h-3 w-3 text-primary shrink-0" />
                <span className="truncate max-w-[180px]">{contact.accountName}</span>
              </span>
            )}
          </div>

          {linkedDeals.length > 0 && (
            <div className="pt-1 flex flex-wrap gap-1.5">
              {linkedDeals.slice(0, 3).map((deal) => (
                <span
                  key={deal.id}
                  className="inline-flex items-center gap-1 rounded-md bg-card border border-border/80 px-2 py-0.5 text-[10px] font-semibold text-foreground shadow-2xs"
                >
                  <Columns3 className="h-2.5 w-2.5 text-primary shrink-0" />
                  <span className="truncate max-w-[180px]">{deal.title}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PhoneContactSuggestions({
  phone,
  name = "",
  endpoint = "/api/contacts",
  onSelect,
}: {
  phone: string;
  name?: string;
  endpoint?: string;
  onSelect: (contact: ExistingPhoneContact) => void;
}) {
  const [contacts, setContacts] = useState<ExistingPhoneContact[]>([]);
  const cleanPhone = (phone || "").replace(/\D/g, "");
  const cleanName = (name || "").trim();

  useEffect(() => {
    setContacts([]);
    const hasPhoneQuery = cleanPhone.length >= 8;
    const hasNameQuery = cleanName.length >= 3;
    if (!hasPhoneQuery && !hasNameQuery) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: "8" });
        if (hasPhoneQuery) params.set("identityPhone", phone);
        if (hasNameQuery) params.set("identityName", cleanName);

        const res = await fetch(`${endpoint}?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!controller.signal.aborted) {
          const list: ExistingPhoneContact[] = Array.isArray(data.contacts) ? data.contacts : [];
          // Ordena priorizando match exato de telefone, depois quantidade de negociações
          const sorted = [...list].sort((a, b) => {
            const aPhone = isPhoneMatch(a.phone, phone) ? 1 : 0;
            const bPhone = isPhoneMatch(b.phone, phone) ? 1 : 0;
            if (aPhone !== bPhone) return bPhone - aPhone;
            return (b.dealsCount || 0) - (a.dealsCount || 0);
          });
          setContacts(sorted);
        }
      } catch {
        /* O cadastro ainda verifica duplicidade no servidor. */
      }
    }, 280);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [phone, cleanPhone, cleanName, endpoint]);

  if (!contacts.length) return null;

  const hasAnyPhoneMatch = contacts.some((c) => isPhoneMatch(c.phone, phone));
  const missingDdd = cleanPhone.length >= 8 && Boolean(phoneRegistrationError(phone));

  return (
    <div
      className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.06] to-card p-3.5 shadow-xs space-y-3 animate-in fade-in duration-150"
      role="status"
    >
      {/* Header do Alerta de Contatos Encontrados */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/20 mt-0.5">
            {hasAnyPhoneMatch ? <UserCheck className="h-4 w-4" /> : <Users className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-extrabold text-foreground leading-snug">
                {missingDdd
                  ? "Possíveis contatos existentes (confira o DDD)"
                  : hasAnyPhoneMatch
                    ? "Encontramos contatos com este número"
                    : "Encontramos contatos já cadastrados com este nome"}
              </p>
              <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-extrabold text-primary">
                {contacts.length} {contacts.length === 1 ? "cadastro" : "cadastros"}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              {hasAnyPhoneMatch
                ? "Confira o DDD, empresa e negociações abaixo e selecione o cadastro existente para continuar."
                : "Selecione um contato existente caso seja a mesma pessoa para manter o histórico unificado."}
            </p>
          </div>
        </div>
      </div>

      {/* Lista de Cards de Contatos Encontrados */}
      <div className="max-h-56 overflow-y-auto space-y-2 pr-0.5 scrollbar-thin">
        {contacts.map((contact) => {
          const matchedByPhone = isPhoneMatch(contact.phone, phone);
          const linkedDeals = contact.linkedDeals || [];
          const dealsCount = contact.dealsCount ?? linkedDeals.length;

          return (
            <button
              key={contact.id}
              type="button"
              onClick={() => onSelect(contact)}
              className="group flex w-full items-start gap-3 rounded-xl border border-border/80 bg-card p-2.5 text-left text-xs transition-all duration-150 hover:border-primary/60 hover:bg-primary/[0.02] hover:shadow-sm cursor-pointer"
            >
              {/* Avatar com Iniciais */}
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 border border-primary/20 text-[11px] font-extrabold text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                {getInitials(contact.name)}
              </div>

              {/* Informações do Contato */}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span className="font-bold text-xs text-foreground group-hover:text-primary transition-colors truncate">
                      {contact.name}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${
                        matchedByPhone
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25"
                      }`}
                    >
                      {matchedByPhone ? "Mesmo número" : "Nome similar"}
                    </span>
                  </div>

                  <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-muted group-hover:bg-primary group-hover:text-primary-foreground px-2 py-1 text-[10px] font-bold text-foreground transition-colors">
                    <span>Usar cadastro</span>
                    <ArrowRight className="h-3 w-3" />
                  </span>
                </div>

                {/* Linha de Telefone e E-mail */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1 font-mono font-semibold text-foreground/85">
                    <Phone className="h-3 w-3 text-primary shrink-0" />
                    {contact.phone ? formatPhoneNumber(contact.phone) : "Sem telefone"}
                  </span>
                  {contact.email && (
                    <span className="inline-flex items-center gap-1 truncate max-w-[190px]">
                      <Mail className="h-3 w-3 shrink-0 opacity-70" />
                      <span className="truncate">{contact.email}</span>
                    </span>
                  )}
                </div>

                {/* Badges de Empresa, Negociações e Responsável */}
                {(contact.accountName || dealsCount > 0 || contact.responsibleName) && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {contact.accountName && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted/70 border border-border/60 px-1.5 py-0.5 text-[10px] font-semibold text-foreground/85">
                        <Building2 className="h-2.5 w-2.5 text-primary shrink-0" />
                        <span className="truncate max-w-[150px]">{contact.accountName}</span>
                      </span>
                    )}
                    {dealsCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                        <Columns3 className="h-2.5 w-2.5 shrink-0" />
                        <span>
                          {dealsCount} {dealsCount === 1 ? "card" : "cards"}
                          {linkedDeals[0]?.title ? `: ${linkedDeals[0].title}` : ""}
                        </span>
                      </span>
                    )}
                    {contact.responsibleName && contact.responsibleName !== "Na Fila" && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <User className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate max-w-[110px]">{contact.responsibleName}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
