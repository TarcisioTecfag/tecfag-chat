import React, { useState, useEffect } from "react";
import {
  Search,
  Phone,
  MessageSquare,
  ExternalLink,
  Tag,
  PhoneCall,
  Smile,
  Meh,
  Frown,
  RefreshCw,
  User,
} from "lucide-react";

// Interface retornada por /api/voice-clients
interface VoiceClient {
  phone: string;
  contactId: string | null;
  name: string; // nome do contato OU número formatado
  avatar: string | null;
  rdCrmDealLink: string | null;
  tags: string[];
  totalCalls: number;
  lastCallDate: string; // ISO string
  lastCallDuration: number; // segundos
  sentiments: { positive: number; neutral: number; negative: number };
  calls: Array<{
    id: string;
    direction: string;
    status: string;
    startedAt: string | null;
    durationSeconds: number | null;
    sentiment: string | null;
    summary: string | null;
  }>;
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13)
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.length === 11)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return phone;
}

function formatRelativeDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Hoje";
    if (diffDays === 1) return "Ontem";
    if (diffDays < 7) return `${diffDays} dias atrás`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} sem. atrás`;
    return date.toLocaleDateString("pt-BR");
  } catch {
    return isoString;
  }
}

function SentimentBar({
  sentiments,
}: {
  sentiments: VoiceClient["sentiments"];
}) {
  const total = sentiments.positive + sentiments.neutral + sentiments.negative;
  if (total === 0) return null;

  const pct = (n: number) => Math.round((n / total) * 100);
  const pos = pct(sentiments.positive);
  const neu = pct(sentiments.neutral);
  const neg = pct(sentiments.negative);

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[10px] text-muted-foreground font-semibold">
          Sentimentos
        </span>
        <span className="flex items-center gap-0.5 text-[10px] text-emerald-500">
          <Smile className="w-3 h-3" />
          {pos}%
        </span>
        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
          <Meh className="w-3 h-3" />
          {neu}%
        </span>
        <span className="flex items-center gap-0.5 text-[10px] text-red-400">
          <Frown className="w-3 h-3" />
          {neg}%
        </span>
      </div>
      <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
        {pos > 0 && (
          <div
            className="bg-emerald-500 rounded-full"
            style={{ width: `${pos}%` }}
          />
        )}
        {neu > 0 && (
          <div
            className="bg-muted-foreground/40 rounded-full"
            style={{ width: `${neu}%` }}
          />
        )}
        {neg > 0 && (
          <div
            className="bg-red-400 rounded-full"
            style={{ width: `${neg}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function ClientesTab({ tenantId = "valem" }: { tenantId?: string }) {
  const [clients, setClients] = useState<VoiceClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchClients = () => {
    setLoading(true);
    fetch(`/api/voice-clients?tenantId=${tenantId}`)
      .then((r) => r.json())
      .then((data) => setClients(data.clients ?? data ?? []))
      .catch(() => setClients([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Botão Ligar — outbound real
  const handleCall = async (phone: string) => {
    await fetch("/api/trigger-outbound-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, tenantId }),
    });
  };

  const filtered = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm)
  );

  return (
    <div className="flex flex-col gap-6 overflow-y-auto h-full pr-1">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-card border border-border rounded-2xl p-4 shadow-soft">
        <div>
          <h3 className="text-base font-bold text-foreground">
            Base de Clientes por Voz
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Contatos cruzados com ligações reais — histórico, sentimento e
            ações rápidas.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filtrar por nome ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-muted/40 border border-border rounded-xl pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={fetchClients}
            disabled={loading}
            title="Atualizar lista"
            className="p-2 bg-muted hover:bg-muted/80 border border-border rounded-xl transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw
              className={`w-4 h-4 text-muted-foreground ${loading ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center items-center py-16 text-muted-foreground text-sm gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Carregando clientes...
        </div>
      )}

      {/* Sem resultados */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-2">
          <User className="w-8 h-8 opacity-30" />
          <span>Nenhum cliente encontrado.</span>
        </div>
      )}

      {/* Grid de Cards */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((client) => {
            const whatsappUrl = `https://wa.me/${client.phone.replace(/\D/g, "")}`;
            const initial = client.name?.[0]?.toUpperCase() ?? "?";

            return (
              <div
                key={client.phone}
                className="bg-card border border-border rounded-2xl p-5 shadow-soft flex flex-col justify-between gap-4"
              >
                {/* Topo: avatar + nome + badges */}
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-3">
                      {client.avatar ? (
                        <img
                          src={client.avatar}
                          alt={client.name}
                          className="w-10 h-10 rounded-full object-cover border border-border flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-bold text-primary">
                            {initial}
                          </span>
                        </div>
                      )}

                      <div>
                        <h4 className="text-sm font-bold text-foreground leading-tight">
                          {client.name}
                        </h4>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {formatPhone(client.phone)}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      {client.contactId && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-lg text-[10px] font-bold">
                          Contato no Sistema
                        </span>
                      )}
                      {client.rdCrmDealLink && (
                        <a
                          href={client.rdCrmDealLink}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 rounded-lg text-[10px] font-bold transition-colors"
                        >
                          RD Station
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Estatísticas */}
                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-2">
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {client.totalCalls}{" "}
                      {client.totalCalls === 1 ? "ligação" : "ligações"}
                    </span>
                    <span>
                      Última:{" "}
                      <span className="text-foreground font-medium">
                        {formatRelativeDate(client.lastCallDate)}
                      </span>
                    </span>
                  </div>

                  {/* Barra de sentimentos */}
                  <SentimentBar sentiments={client.sentiments} />

                  {/* Tags */}
                  {client.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {client.tags.map((tag, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/10 text-primary border border-primary/20 rounded-lg text-[10px] font-bold"
                        >
                          <Tag className="w-2.5 h-2.5" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Rodapé — ações */}
                <div className="pt-3 border-t border-border flex items-center justify-end gap-2">
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-xs font-semibold border border-border transition cursor-pointer shadow-soft"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                    WhatsApp
                  </a>
                  <button
                    onClick={() => handleCall(client.phone)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:opacity-90 text-primary-foreground rounded-xl text-xs font-semibold transition cursor-pointer shadow-soft"
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                    Ligar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
