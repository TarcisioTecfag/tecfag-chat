import React, { useState } from "react";
import { Phone, Clock, MessageSquare, ShieldAlert, Save, Check } from "lucide-react";

export function ConfiguracaoTab() {
  const [twilioNumber, setTwilioNumber] = useState("+55 14 398-0186");
  const [greeting, setGreeting] = useState("Olá, boa tarde! Aqui é a Valentina da Valem Válvulas e Embalagens. Tudo bem com você?");
  const [maxDuration, setMaxDuration] = useState("10");
  const [autoWhatsappFollowup, setAutoWhatsappFollowup] = useState(true);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6 overflow-y-auto h-full pr-1 max-w-4xl">
      <div className="bg-card border border-border rounded-2xl p-5 shadow-soft flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-foreground">Configurações do Agente de Voz (Valentina)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Ajuste os parâmetros operacionais da IA para chamadas telefônicas via Twilio.</p>
        </div>

        <button 
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:opacity-90 text-primary-foreground rounded-xl text-xs font-semibold shadow-soft transition cursor-pointer"
        >
          {saved ? <Check className="w-4 h-4 text-emerald-300" /> : <Save className="w-4 h-4" />}
          {saved ? "Salvo com sucesso!" : "Salvar Alterações"}
        </button>
      </div>

      {/* Grid de Form de Configuração */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Número de Telefone Twilio */}
        <div className="bg-card border border-border rounded-2xl p-5 shadow-soft flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Phone className="w-4 h-4 text-primary" />
            Número de Telefone Ativo
          </div>
          <p className="text-xs text-muted-foreground">Número da linha Twilio conectada ao Webhook de atendimento da Valentina.</p>
          <input 
            type="text"
            value={twilioNumber}
            onChange={(e) => setTwilioNumber(e.target.value)}
            className="bg-muted/40 border border-border rounded-xl px-3.5 py-2.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary"
          />
        </div>

        {/* Duração Máxima por Chamada */}
        <div className="bg-card border border-border rounded-2xl p-5 shadow-soft flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Clock className="w-4 h-4 text-purple-500" />
            Duração Máxima da Chamada
          </div>
          <p className="text-xs text-muted-foreground">Limite máximo em minutos antes do encerramento automático pela IA.</p>
          <select 
            value={maxDuration}
            onChange={(e) => setMaxDuration(e.target.value)}
            className="bg-muted/40 border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary"
          >
            <option value="5">5 minutos</option>
            <option value="10">10 minutos (Recomendado)</option>
            <option value="15">15 minutos</option>
            <option value="20">20 minutos</option>
          </select>
        </div>
      </div>

      {/* Saudação Inicial Editável */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-soft flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          <MessageSquare className="w-4 h-4 text-emerald-500" />
          Saudação Inicial (Script Falado)
        </div>
        <p className="text-xs text-muted-foreground">Primeira frase falada pela Valentina imediatamente após o cliente atender.</p>
        <textarea 
          rows={3}
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          className="bg-muted/40 border border-border rounded-xl p-3.5 text-xs text-foreground leading-relaxed focus:outline-none focus:border-primary resize-none"
        />
      </div>

      {/* Opção WhatsApp Follow-up */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-soft flex items-center justify-between">
        <div>
          <h4 className="text-xs font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            WhatsApp de Follow-up Automático
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">Enviar mensagem no WhatsApp do cliente assim que a ligação for finalizada com o resumo do acordo.</p>
        </div>

        <button 
          onClick={() => setAutoWhatsappFollowup(!autoWhatsappFollowup)}
          className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer ${
            autoWhatsappFollowup ? "bg-primary" : "bg-muted border border-border"
          }`}
        >
          <div className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ease-in-out ${
            autoWhatsappFollowup ? "translate-x-6" : "translate-x-0"
          }`} />
        </button>
      </div>
    </div>
  );
}
