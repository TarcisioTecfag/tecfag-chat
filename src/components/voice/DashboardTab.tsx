import React, { useState } from "react";
import { PhoneCall, PhoneIncoming, UserCheck, UserX, Clock, Smile, Frown, Meh, Mic, PhoneOff, Volume2 } from "lucide-react";
import { motion } from "framer-motion";

export function DashboardTab() {
  // Mock data para estatísticas e chamada ativa
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

  const handleEndCall = () => {
    setActiveCall(null);
  };

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto h-full text-slate-100">
      {/* Cards de Métricas Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs font-medium text-slate-400">Ligações Hoje</p>
            <h3 className="text-2xl font-bold text-slate-100 mt-1">14</h3>
            <span className="text-[11px] text-emerald-400 font-medium">↑ +25% que ontem</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <PhoneIncoming className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs font-medium text-slate-400">Atendidas por Valentina</p>
            <h3 className="text-2xl font-bold text-emerald-400 mt-1">12 <span className="text-xs text-slate-400 font-normal">(85.7%)</span></h3>
            <span className="text-[11px] text-slate-400">Qualificação automatizada</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <UserCheck className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs font-medium text-slate-400">Duração Média</p>
            <h3 className="text-2xl font-bold text-purple-400 mt-1">3m 18s</h3>
            <span className="text-[11px] text-slate-400">Tempo de engajamento</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs font-medium text-slate-400">Sentimento Predominante</p>
            <h3 className="text-2xl font-bold text-amber-400 mt-1">82% Positivo</h3>
            <span className="text-[11px] text-emerald-400">Excelente recepção</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Smile className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Monitor de Chamada em Tempo Real */}
      {activeCall ? (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900/90 border border-emerald-500/40 rounded-xl p-5 shadow-lg relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 px-4 py-1 bg-emerald-500/20 border-l border-b border-emerald-500/40 text-emerald-400 text-xs font-semibold flex items-center gap-2 rounded-bl-xl">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            EM ANDAMENTO ({activeCall.duration})
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <div>
              <h4 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <PhoneCall className="w-5 h-5 text-emerald-400 animate-pulse" />
                {activeCall.contactName}
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">{activeCall.from}</p>
            </div>

            <div className="flex items-center gap-2">
              <button 
                title="Ouvir em tempo real (Modo silencioso)"
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors"
              >
                <Volume2 className="w-4 h-4 text-blue-400" />
                Ouvir
              </button>
              <button 
                title="Entrar na ligação via WebRTC (Modo Conferência)"
                className="px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-xs font-medium text-amber-300 flex items-center gap-1.5 transition-colors"
              >
                <Mic className="w-4 h-4 text-amber-400" />
                Intervir (WebRTC)
              </button>
              <button 
                onClick={handleEndCall}
                title="Encerrar chamada imediatamente"
                className="px-3 py-2 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 rounded-lg text-xs font-medium text-rose-300 flex items-center gap-1.5 transition-colors"
              >
                <PhoneOff className="w-4 h-4 text-rose-400" />
                Encerrar
              </button>
            </div>
          </div>

          {/* Transcript Ao Vivo */}
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-3 text-xs text-slate-300 font-mono leading-relaxed">
            <span className="text-emerald-400 font-semibold">[Transcrição ao vivo]:</span> {activeCall.liveTranscript}
          </div>
        </motion.div>
      ) : (
        <div className="bg-slate-900/40 border border-slate-800/60 border-dashed rounded-xl p-6 text-center text-slate-500 text-xs">
          Nenhuma ligação em andamento neste momento. Novas chamadas recebidas ou disparadas aparecerão aqui automaticamente.
        </div>
      )}

      {/* Tabela de Chamadas Recentes */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
        <h4 className="text-sm font-bold text-slate-200 mb-4">Últimas Ligações Atendidas</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-3">Cliente / Telefone</th>
                <th className="p-3">Data / Hora</th>
                <th className="p-3">Duração</th>
                <th className="p-3">Status</th>
                <th className="p-3">Sentimento</th>
                <th className="p-3">Resumo da IA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {recentCalls.map((call) => (
                <tr key={call.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="p-3 font-medium text-slate-100">
                    {call.name}
                    <span className="block text-[11px] text-slate-400 font-normal">{call.from}</span>
                  </td>
                  <td className="p-3 text-slate-400">{call.date}</td>
                  <td className="p-3 text-slate-300">{call.duration}</td>
                  <td className="p-3">
                    <span className={`inline-flex px-2 py-0.5 text-[10px] font-semibold rounded-full border ${
                      call.status.includes("IA") 
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    }`}>
                      {call.status}
                    </span>
                  </td>
                  <td className="p-3">
                    {call.sentiment === "positive" && <span className="text-emerald-400 flex items-center gap-1"><Smile className="w-3.5 h-3.5" /> Positivo</span>}
                    {call.sentiment === "neutral" && <span className="text-slate-400 flex items-center gap-1"><Meh className="w-3.5 h-3.5" /> Neutro</span>}
                    {call.sentiment === "negative" && <span className="text-rose-400 flex items-center gap-1"><Frown className="w-3.5 h-3.5" /> Negativo</span>}
                  </td>
                  <td className="p-3 text-slate-400 max-w-xs truncate">{call.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
