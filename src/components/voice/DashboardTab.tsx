import React, { useState } from "react";
import { PhoneCall, PhoneIncoming, UserCheck, Clock, Smile, Frown, Meh, Mic, PhoneOff, Volume2 } from "lucide-react";
import { motion } from "framer-motion";

export function DashboardTab() {
  const [activeCall, setActiveCall] = useState<{
    id: string;
    from: string;
    contactName: string;
    duration: string;
    sentiment: "positive" | "neutral" | "negative";
    liveTranscript: string;
  } | null>({
    id: "call-1",
    from: "+55 14 99836-4338",
    contactName: "João Silva (Valem)",
    duration: "02:14",
    sentiment: "positive",
    liveTranscript: "Valentina: Entendo perfeitamente! Nossas válvulas aerossol de 300ml possuem certificação de vazão e estão com pronta entrega..."
  });

  const [recentCalls] = useState([
    { id: "c-101", from: "+55 14 99123-4567", name: "Carlos Eduardo", date: "Hoje, 11:20", duration: "3m 45s", sentiment: "positive", status: "IA Finalizou", summary: "Interessado em 5.000 unidades de válvulas spray." },
    { id: "c-102", from: "+55 11 98765-4321", name: "Mariana Costa", date: "Hoje, 10:45", duration: "1m 12s", sentiment: "neutral", status: "IA Finalizou", summary: "Pediu tabela de preços por WhatsApp." },
    { id: "c-103", from: "+55 19 97654-3210", name: "Roberto Alves", date: "Hoje, 09:30", duration: "5m 02s", sentiment: "positive", status: "Humano Interveio", summary: "Transferido para vendedor devido a negociação de prazo." },
    { id: "c-104", from: "+55 41 96543-2109", name: "Empresa Embalagens LTDA", date: "Ontem, 16:50", duration: "2m 30s", sentiment: "negative", status: "IA Finalizou", summary: "Reclamou de atraso na entrega da última nota." },
  ]);

  return (
    <div className="flex flex-col gap-6 overflow-y-auto h-full pr-1">
      {/* Cards de Métricas Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5 shadow-soft flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ligações Hoje</p>
            <h3 className="text-2xl font-extrabold text-foreground mt-1">14</h3>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">↑ +25% que ontem</span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <PhoneIncoming className="w-5.5 h-5.5" />
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5 shadow-soft flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Atendidas por Valentina</p>
            <h3 className="text-2xl font-extrabold text-foreground mt-1">12 <span className="text-xs text-muted-foreground font-normal">(85.7%)</span></h3>
            <span className="text-[11px] text-muted-foreground">Qualificação automatizada</span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <UserCheck className="w-5.5 h-5.5" />
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5 shadow-soft flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Duração Média</p>
            <h3 className="text-2xl font-extrabold text-foreground mt-1">3m 18s</h3>
            <span className="text-[11px] text-muted-foreground">Tempo de engajamento</span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
            <Clock className="w-5.5 h-5.5" />
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5 shadow-soft flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sentimento</p>
            <h3 className="text-2xl font-extrabold text-foreground mt-1">82% Positivo</h3>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">Excelente recepção</span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Smile className="w-5.5 h-5.5" />
          </div>
        </div>
      </div>

      {/* Monitor de Chamada em Tempo Real */}
      {activeCall ? (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-primary/40 rounded-2xl p-5 shadow-soft relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 px-4 py-1 bg-primary/10 border-l border-b border-primary/30 text-primary text-xs font-extrabold flex items-center gap-2 rounded-bl-2xl">
            <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
            AO VIVO ({activeCall.duration})
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <div>
              <h4 className="text-base font-extrabold text-foreground flex items-center gap-2">
                <PhoneCall className="w-5 h-5 text-primary animate-pulse" />
                {activeCall.contactName}
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">{activeCall.from}</p>
            </div>

            <div className="flex items-center gap-2">
              <button className="px-3.5 py-2 bg-muted hover:bg-muted/80 border border-border rounded-xl text-xs font-semibold text-foreground flex items-center gap-1.5 transition cursor-pointer shadow-soft">
                <Volume2 className="w-4 h-4 text-primary" />
                Ouvir
              </button>
              <button className="px-3.5 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 transition cursor-pointer shadow-soft">
                <Mic className="w-4 h-4 text-amber-500" />
                Intervir (WebRTC)
              </button>
              <button 
                onClick={() => setActiveCall(null)}
                className="px-3.5 py-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5 transition cursor-pointer shadow-soft"
              >
                <PhoneOff className="w-4 h-4 text-rose-500" />
                Encerrar
              </button>
            </div>
          </div>

          {/* Transcript Ao Vivo */}
          <div className="bg-muted/40 border border-border rounded-xl p-3.5 text-xs text-foreground font-mono leading-relaxed">
            <span className="text-primary font-bold">[Transcrição ao vivo]:</span> {activeCall.liveTranscript}
          </div>
        </motion.div>
      ) : (
        <div className="bg-card border border-border border-dashed rounded-2xl p-6 text-center text-muted-foreground text-xs shadow-soft">
          Nenhuma ligação em andamento neste momento. Novas chamadas recebidas ou disparadas aparecerão aqui automaticamente.
        </div>
      )}

      {/* Tabela de Chamadas Recentes */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-soft">
        <h4 className="text-sm font-bold text-foreground mb-4">Últimas Ligações Atendidas</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-foreground">
            <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider border-b border-border">
              <tr>
                <th className="p-3 font-semibold">Cliente / Telefone</th>
                <th className="p-3 font-semibold">Data / Hora</th>
                <th className="p-3 font-semibold">Duração</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold">Sentimento</th>
                <th className="p-3 font-semibold">Resumo da IA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recentCalls.map((call) => (
                <tr key={call.id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-bold text-foreground">
                    {call.name}
                    <span className="block text-[11px] text-muted-foreground font-normal">{call.from}</span>
                  </td>
                  <td className="p-3 text-muted-foreground">{call.date}</td>
                  <td className="p-3 text-foreground">{call.duration}</td>
                  <td className="p-3">
                    <span className={`inline-flex px-2.5 py-0.5 text-[10px] font-bold rounded-lg border ${
                      call.status.includes("IA") 
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                    }`}>
                      {call.status}
                    </span>
                  </td>
                  <td className="p-3">
                    {call.sentiment === "positive" && <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium"><Smile className="w-3.5 h-3.5" /> Positivo</span>}
                    {call.sentiment === "neutral" && <span className="text-muted-foreground flex items-center gap-1 font-medium"><Meh className="w-3.5 h-3.5" /> Neutro</span>}
                    {call.sentiment === "negative" && <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1 font-medium"><Frown className="w-3.5 h-3.5" /> Negativo</span>}
                  </td>
                  <td className="p-3 text-muted-foreground max-w-xs truncate">{call.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
