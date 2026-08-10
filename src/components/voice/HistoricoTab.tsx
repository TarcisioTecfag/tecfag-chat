import React, { useState } from "react";
import { Search, Filter, ChevronDown, ChevronUp, FileText, Sparkles, Smile, Frown, Meh, PhoneIncoming, PhoneOutgoing } from "lucide-react";

interface CallRecord {
  id: string;
  contactName: string;
  phone: string;
  direction: "inbound" | "outbound";
  date: string;
  duration: string;
  sentiment: "positive" | "neutral" | "negative";
  status: string;
  summary: string;
  extractedInfo: {
    empresa?: string;
    interesse?: string;
    objecoes?: string;
    proximoPasso?: string;
  };
  messages: Array<{ role: "user" | "assistant"; content: string; time: string }>;
}

export function HistoricoTab() {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedCallId, setExpandedCallId] = useState<string | null>("h-1");

  const [calls] = useState<CallRecord[]>([
    {
      id: "h-1",
      contactName: "João Silva",
      phone: "+55 14 99836-4338",
      direction: "inbound",
      date: "10/08/2026 11:15",
      duration: "03m 42s",
      sentiment: "positive",
      status: "Qualificado",
      summary: "Cliente interessado em válvulas spray para frascos de alumínio 300ml. Solicitou orçamento de 10.000 unidades.",
      extractedInfo: {
        empresa: "Valem Embalagens",
        interesse: "Válvulas Spray 300ml Alumínio",
        objecoes: "Nenhuma registrada",
        proximoPasso: "Enviar cotação formal em até 24 horas via WhatsApp."
      },
      messages: [
        { role: "assistant", content: "Olá, boa tarde! Aqui é a Valentina da Valem Válvulas e Embalagens. Tudo bem com você?", time: "11:15:02" },
        { role: "user", content: "Boa tarde, Valentina. Tudo ótimo. Preciso saber se vocês têm válvulas spray de alumínio de 300ml.", time: "11:15:08" },
        { role: "assistant", content: "Temos sim! Nossas válvulas spray 300ml possuem pescador sob medida e excelente retenção de pressão. Quantas unidades você está precisando?", time: "11:15:15" },
        { role: "user", content: "Estou pensando num lote inicial de 10 mil peças.", time: "11:15:24" },
        { role: "assistant", content: "Perfeito! Para essa quantidade temos faturamento direto com condições especiais. Posso enviar a proposta técnica completa para você pelo WhatsApp?", time: "11:15:32" },
        { role: "user", content: "Pode sim, por favor. Pode enviar nesse mesmo número.", time: "11:15:40" },
        { role: "assistant", content: "Ótimo! Em breve você receberá o orçamento detalhado. Muito obrigada pela atenção e um excelente dia!", time: "11:15:48" }
      ]
    },
    {
      id: "h-2",
      contactName: "Carlos Eduardo",
      phone: "+55 14 99123-4567",
      direction: "outbound",
      date: "10/08/2026 10:30",
      duration: "01m 50s",
      sentiment: "neutral",
      status: "Follow-up Agendado",
      summary: "Atendeu o retorno da campanha de frascos pet. Pediu para ligar novamente amanhã de manhã.",
      extractedInfo: {
        empresa: "Cosméticos Brasil",
        interesse: "Frascos PET 200ml",
        objecoes: "Sem tempo para falar no momento",
        proximoPasso: "Re-discar amanhã às 09:30"
      },
      messages: [
        { role: "assistant", content: "Olá Carlos! Aqui é a Valentina da Valem. Conforme combinado, estou retornando sobre seu interesse em frascos PET.", time: "10:30:00" },
        { role: "user", content: "Oi Valentina, estou numa reunião agora. Pode me ligar amanhã de manhã?", time: "10:30:12" },
        { role: "assistant", content: "Com certeza! Agendarei para amanhã às 9 e meia da manhã. Bom trabalho e até amanhã!", time: "10:30:18" }
      ]
    }
  ]);

  const filteredCalls = calls.filter(c => 
    c.contactName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone.includes(searchTerm) ||
    c.summary.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6 overflow-y-auto h-full pr-1">
      {/* Barra de Pesquisa e Filtros */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-card border border-border rounded-2xl p-4 shadow-soft">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="Buscar por nome, telefone ou resumo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-muted/40 border border-border rounded-xl pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button className="flex items-center gap-1.5 px-3.5 py-2 bg-card border border-border hover:bg-muted rounded-xl text-xs font-semibold text-foreground transition cursor-pointer shadow-soft">
            <Filter className="w-3.5 h-3.5 text-primary" />
            Filtros
          </button>
        </div>
      </div>

      {/* Lista de Chamadas Gravadas e Transcritas */}
      <div className="flex flex-col gap-4">
        {filteredCalls.map((call) => {
          const isExpanded = expandedCallId === call.id;

          return (
            <div 
              key={call.id}
              className="bg-card border border-border rounded-2xl overflow-hidden shadow-soft transition-colors"
            >
              {/* Cabeçalho do Card */}
              <div 
                onClick={() => setExpandedCallId(isExpanded ? null : call.id)}
                className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-muted/30"
              >
                <div className="flex items-center gap-3.5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    call.direction === "inbound" 
                      ? "bg-primary/10 text-primary border border-primary/20" 
                      : "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                  }`}>
                    {call.direction === "inbound" ? <PhoneIncoming className="w-5 h-5" /> : <PhoneOutgoing className="w-5 h-5" />}
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                      {call.contactName}
                      <span className="text-[11px] font-normal text-muted-foreground">({call.phone})</span>
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{call.date} • Duração: {call.duration}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 text-[11px] font-bold rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    {call.status}
                  </span>

                  <div className="flex items-center gap-1 text-xs">
                    {call.sentiment === "positive" && <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1"><Smile className="w-4 h-4" /> Positivo</span>}
                    {call.sentiment === "neutral" && <span className="text-muted-foreground font-medium flex items-center gap-1"><Meh className="w-4 h-4" /> Neutro</span>}
                    {call.sentiment === "negative" && <span className="text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1"><Frown className="w-4 h-4" /> Negativo</span>}
                  </div>

                  {isExpanded ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
                </div>
              </div>

              {/* Detalhes Expandidos: Transcript & Análise IA */}
              {isExpanded && (
                <div className="border-t border-border bg-muted/20 p-5 flex flex-col gap-5">
                  {/* Resumo da IA */}
                  <div className="bg-card border border-primary/20 rounded-xl p-4 shadow-soft">
                    <h5 className="text-xs font-bold text-primary flex items-center gap-1.5 mb-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      Resumo da Ligação (IA Gemini)
                    </h5>
                    <p className="text-xs text-foreground leading-relaxed mb-3">{call.summary}</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-border text-xs">
                      <div>
                        <span className="text-muted-foreground">Interesse Detectado:</span>
                        <p className="font-bold text-foreground">{call.extractedInfo.interesse}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Próximo Passo Automatizado:</span>
                        <p className="font-bold text-primary">{call.extractedInfo.proximoPasso}</p>
                      </div>
                    </div>
                  </div>

                  {/* Transcrição Diálogo */}
                  <div>
                    <h5 className="text-xs font-bold text-foreground mb-3 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      Transcrição Completa Diálogo
                    </h5>

                    <div className="flex flex-col gap-2.5 max-h-96 overflow-y-auto pr-2">
                      {call.messages.map((msg, idx) => (
                        <div 
                          key={idx}
                          className={`p-3.5 rounded-2xl text-xs leading-relaxed max-w-2xl ${
                            msg.role === "assistant" 
                              ? "bg-primary/10 border border-primary/20 text-foreground self-start rounded-tl-sm"
                              : "bg-card border border-border text-foreground self-end rounded-tr-sm shadow-soft"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-4 mb-1 text-[10px] text-muted-foreground">
                            <span className="font-bold text-primary">{msg.role === "assistant" ? "🤖 Valentina" : "👤 Cliente"}</span>
                            <span>{msg.time}</span>
                          </div>
                          <p>{msg.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
