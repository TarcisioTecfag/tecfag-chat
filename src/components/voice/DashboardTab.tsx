import React, { useState, useEffect, useCallback } from "react";
import {
  PhoneIncoming, UserCheck, Clock, Smile, Frown, Meh,
  RefreshCw, TrendingUp, AlertCircle, PhoneCall
} from "lucide-react";
import { motion } from "framer-motion";

interface ElevenLabsConversation {
  conversation_id: string;
  start_time_unix_secs: number;
  call_duration_secs: number;
  status: string;
  termination_reason: string | null;
  call_summary_title: string | null;
  direction: "outbound" | "inbound" | null;
  sentiment_analysis: {
    overall_label: "positive" | "neutral" | "negative";
    overall_sentiment_score: number;
  } | null;
}

function isToday(unixSecs: number): boolean {
  const d = new Date(unixSecs * 1000), now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}
function isYesterday(unixSecs: number): boolean {
  const d = new Date(unixSecs * 1000), y = new Date();
  y.setDate(y.getDate() - 1);
  return d.getDate() === y.getDate() && d.getMonth() === y.getMonth() && d.getFullYear() === y.getFullYear();
}
function formatDuration(secs: number): string {
  return `${Math.floor(secs / 60)}m ${(secs % 60).toString().padStart(2, "0")}s`;
}
function formatDateTime(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (isToday(unixSecs)) return `Hoje, ${time}`;
  if (isYesterday(unixSecs)) return `Ontem, ${time}`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function DashboardTab({ tenantId = "valem" }: { tenantId?: string }) {
  const [conversations, setConversations] = useState<ElevenLabsConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/elevenlabs-conversations?tenantId=${tenantId}`);
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data = await res.json();
      setConversations(data.conversations ?? data ?? []);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message ?? "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchConversations();
    const t = setInterval(fetchConversations, 60_000);
    return () => clearInterval(t);
  }, [fetchConversations]);

  const today = conversations.filter(c => isToday(c.start_time_unix_secs));
  const yesterday = conversations.filter(c => isYesterday(c.start_time_unix_secs));
  const withSentiment = today.filter(c => c.sentiment_analysis);
  const positive = withSentiment.filter(c => c.sentiment_analysis?.overall_label === "positive");
  const successful = today.filter(c => c.status === "done");
  const avgDuration = today.length > 0 ? Math.round(today.reduce((a, c) => a + c.call_duration_secs, 0) / today.length) : 0;
  const positivePct = withSentiment.length > 0 ? Math.round((positive.length / withSentiment.length) * 100) : 0;
  const successPct = today.length > 0 ? Math.round((successful.length / today.length) * 100) : 0;
  const delta = yesterday.length > 0 ? Math.round(((today.length - yesterday.length) / yesterday.length) * 100) : null;
  const lastCall = conversations[0] ?? null;
  const recent = conversations.slice(0, 10);

  return (
    <div className="flex flex-col gap-6 overflow-y-auto h-full pr-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : error ? <AlertCircle className="w-3.5 h-3.5 text-rose-500" /> : <span className="w-2 h-2 rounded-full bg-emerald-500" />}
          {loading ? "Carregando..." : error ? `Erro: ${error}` : `Atualizado ${lastUpdated?.toLocaleTimeString("pt-BR")}`}
        </span>
        <button onClick={fetchConversations} className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer">
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5 shadow-soft flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ligações Hoje</p>
            <h3 className="text-2xl font-extrabold text-foreground mt-1">{loading ? "—" : today.length}</h3>
            {delta !== null ? <span className={`text-[11px] font-semibold ${delta >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{delta >= 0 ? "↑" : "↓"} {Math.abs(delta)}% que ontem</span> : <span className="text-[11px] text-muted-foreground">{yesterday.length} ontem</span>}
          </div>
          <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary"><PhoneIncoming className="w-5 h-5" /></div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5 shadow-soft flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Atendidas por Valentina</p>
            <h3 className="text-2xl font-extrabold text-foreground mt-1">{loading ? "—" : successful.length} <span className="text-xs text-muted-foreground font-normal">({loading ? "—" : `${successPct}%`})</span></h3>
            <span className="text-[11px] text-muted-foreground">Qualificação automatizada</span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600"><UserCheck className="w-5 h-5" /></div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5 shadow-soft flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Duração Média</p>
            <h3 className="text-2xl font-extrabold text-foreground mt-1">{loading ? "—" : formatDuration(avgDuration)}</h3>
            <span className="text-[11px] text-muted-foreground">Tempo de engajamento</span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary"><Clock className="w-5 h-5" /></div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5 shadow-soft flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sentimento</p>
            <h3 className="text-2xl font-extrabold text-foreground mt-1">{loading ? "—" : `${positivePct}% Positivo`}</h3>
            <span className={`text-[11px] font-semibold ${positivePct >= 70 ? "text-emerald-600" : positivePct >= 40 ? "text-amber-600" : "text-rose-500"}`}>{positivePct >= 70 ? "Excelente recepção" : positivePct >= 40 ? "Recepção moderada" : "Requer atenção"}</span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600"><Smile className="w-5 h-5" /></div>
        </div>
      </div>

      {lastCall ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-2xl p-5 shadow-soft">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold text-foreground flex items-center gap-2"><PhoneCall className="w-4 h-4 text-primary" />Última Ligação</h4>
            <span className="text-xs text-muted-foreground">{formatDateTime(lastCall.start_time_unix_secs)}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-muted/40 rounded-xl p-3"><span className="text-muted-foreground block mb-1">Duração</span><span className="font-bold text-foreground">{formatDuration(lastCall.call_duration_secs)}</span></div>
            <div className="bg-muted/40 rounded-xl p-3"><span className="text-muted-foreground block mb-1">Status</span><span className={`font-bold ${lastCall.status === "done" ? "text-emerald-600" : "text-amber-600"}`}>{lastCall.status === "done" ? "Finalizada" : lastCall.status}</span></div>
            <div className="bg-muted/40 rounded-xl p-3"><span className="text-muted-foreground block mb-1">Sentimento</span>
              <span className={`font-bold flex items-center gap-1 ${lastCall.sentiment_analysis?.overall_label === "positive" ? "text-emerald-600" : lastCall.sentiment_analysis?.overall_label === "negative" ? "text-rose-500" : "text-muted-foreground"}`}>
                {lastCall.sentiment_analysis?.overall_label === "positive" && <><Smile className="w-3.5 h-3.5" />Positivo</>}
                {lastCall.sentiment_analysis?.overall_label === "neutral" && <><Meh className="w-3.5 h-3.5" />Neutro</>}
                {lastCall.sentiment_analysis?.overall_label === "negative" && <><Frown className="w-3.5 h-3.5" />Negativo</>}
                {!lastCall.sentiment_analysis && "—"}
              </span>
            </div>
            <div className="bg-muted/40 rounded-xl p-3"><span className="text-muted-foreground block mb-1">Encerramento</span><span className="font-bold text-foreground text-[11px]">{lastCall.termination_reason ?? "—"}</span></div>
          </div>
          {lastCall.call_summary_title && <div className="mt-3 bg-primary/5 border border-primary/20 rounded-xl px-3.5 py-2.5 text-xs"><span className="text-primary font-semibold">Resumo: </span>{lastCall.call_summary_title}</div>}
        </motion.div>
      ) : !loading && (
        <div className="bg-card border border-dashed border-border rounded-2xl p-6 text-center text-muted-foreground text-xs shadow-soft">
          Nenhuma ligação registrada ainda. Realize a primeira chamada de saída pelo botão no topo.
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl p-5 shadow-soft">
        <h4 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" />Últimas Ligações</h4>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-xs gap-2"><RefreshCw className="w-4 h-4 animate-spin" />Carregando...</div>
        ) : recent.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">Nenhuma ligação encontrada.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-foreground">
              <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider border-b border-border">
                <tr>
                  <th className="p-3 font-semibold">Resumo / Tipo</th>
                  <th className="p-3 font-semibold">Data / Hora</th>
                  <th className="p-3 font-semibold">Duração</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold">Sentimento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recent.map((conv) => (
                  <tr key={conv.conversation_id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-bold text-foreground">
                      {conv.call_summary_title ?? "Ligação"}
                      <span className="block text-[11px] text-muted-foreground font-normal capitalize">{conv.direction === "outbound" ? "Saída" : conv.direction === "inbound" ? "Entrada" : "—"}</span>
                    </td>
                    <td className="p-3 text-muted-foreground">{formatDateTime(conv.start_time_unix_secs)}</td>
                    <td className="p-3 text-foreground">{formatDuration(conv.call_duration_secs)}</td>
                    <td className="p-3">
                      <span className={`inline-flex px-2.5 py-0.5 text-[10px] font-bold rounded-lg border ${conv.status === "done" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-amber-500/10 text-amber-600 border-amber-500/20"}`}>
                        {conv.status === "done" ? "IA Finalizou" : conv.status}
                      </span>
                    </td>
                    <td className="p-3">
                      {conv.sentiment_analysis?.overall_label === "positive" && <span className="text-emerald-600 flex items-center gap-1 font-medium"><Smile className="w-3.5 h-3.5" />Positivo</span>}
                      {conv.sentiment_analysis?.overall_label === "neutral" && <span className="text-muted-foreground flex items-center gap-1 font-medium"><Meh className="w-3.5 h-3.5" />Neutro</span>}
                      {conv.sentiment_analysis?.overall_label === "negative" && <span className="text-rose-500 flex items-center gap-1 font-medium"><Frown className="w-3.5 h-3.5" />Negativo</span>}
                      {!conv.sentiment_analysis && <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
