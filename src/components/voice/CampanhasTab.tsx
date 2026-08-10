import React, { useState } from "react";
import { Upload, Play, Pause, Square, FileSpreadsheet, CheckCircle2, Clock, PhoneCall } from "lucide-react";

interface LeadItem {
  id: string;
  name: string;
  phone: string;
  company: string;
  productInterest: string;
  status: "pending" | "calling" | "done" | "no-answer" | "failed";
  attempts: number;
}

export function CampanhasTab() {
  const [fileUploaded, setFileUploaded] = useState(false);
  const [campaignStatus, setCampaignStatus] = useState<"idle" | "running" | "paused" | "completed">("idle");
  const [intervalSeconds, setIntervalSeconds] = useState(30);

  const [leads] = useState<LeadItem[]>([
    { id: "l-1", name: "João Carlos", phone: "+5514998364338", company: "Distribuidora Sol", productInterest: "Válvulas Spray 300ml", status: "done", attempts: 1 },
    { id: "l-2", name: "Ana Paula", phone: "+5511987654321", company: "Cosméticos Lux", productInterest: "Frascos Alumínio 200ml", status: "calling", attempts: 1 },
    { id: "l-3", name: "Marcos Viana", phone: "+5519976543210", company: "Embalagens Vale", productInterest: "Seladoras Automáticas", status: "pending", attempts: 0 },
    { id: "l-4", name: "Fernanda Lima", phone: "+5541965432109", company: "Indústria Alfa", productInterest: "Potes PET 500g", status: "pending", attempts: 0 },
  ]);

  const handleSimulateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFileUploaded(true);
    }
  };

  const totalLeads = leads.length;
  const completedLeads = leads.filter(l => l.status === "done").length;

  return (
    <div className="flex flex-col gap-6 overflow-y-auto h-full pr-1">
      {/* Bloco de Upload / Status da Campanha */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-soft">
        <h3 className="text-base font-bold text-foreground mb-1">Disparo em Massa de Ligações IA</h3>
        <p className="text-xs text-muted-foreground mb-4">Envie uma planilha CSV ou XLSX com os contatos para a Valentina discar automaticamente em sequência.</p>

        {campaignStatus === "idle" && !fileUploaded && (
          <div className="border-2 border-dashed border-border hover:border-primary/50 rounded-2xl p-8 text-center flex flex-col items-center justify-center gap-3 transition-colors bg-muted/20">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">Arraste sua planilha ou clique para selecionar</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Suporta arquivos .CSV e .XLSX (Colunas: nome, telefone, empresa, produto_interesse)</p>
            </div>
            <label className="px-4 py-2 bg-primary hover:opacity-90 text-primary-foreground rounded-xl text-xs font-semibold cursor-pointer transition shadow-soft mt-2">
              Selecionar Planilha
              <input type="file" accept=".csv, .xlsx" onChange={handleSimulateUpload} className="hidden" />
            </label>
          </div>
        )}

        {(fileUploaded || campaignStatus !== "idle") && (
          <div className="flex flex-col gap-4">
            {/* Barra de Progresso Ao Vivo */}
            <div className="bg-muted/30 border border-border rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="w-full md:w-1/2">
                <div className="flex justify-between text-xs text-foreground font-semibold mb-1.5">
                  <span>Progresso da Campanha</span>
                  <span>{completedLeads} de {totalLeads} ligações ({Math.round((completedLeads/totalLeads)*100)}%)</span>
                </div>
                <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden border border-border">
                  <div 
                    className="h-full bg-emerald-500 transition-all duration-500 rounded-full"
                    style={{ width: `${(completedLeads/totalLeads)*100}%` }}
                  />
                </div>
              </div>

              {/* Configurações de Intervalo */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs text-foreground font-medium">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span>Intervalo:</span>
                  <select 
                    value={intervalSeconds}
                    onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                    disabled={campaignStatus === "running"}
                    className="bg-card border border-border rounded-xl px-2.5 py-1 text-xs text-foreground"
                  >
                    <option value={15}>15s entre ligações</option>
                    <option value={30}>30s entre ligações</option>
                    <option value={60}>60s entre ligações</option>
                  </select>
                </div>

                {/* Botões de Controle */}
                {campaignStatus === "idle" && (
                  <button 
                    onClick={() => setCampaignStatus("running")}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-soft transition cursor-pointer"
                  >
                    <Play className="w-4 h-4" />
                    Iniciar Campanha
                  </button>
                )}

                {campaignStatus === "running" && (
                  <button 
                    onClick={() => setCampaignStatus("paused")}
                    className="flex items-center gap-1.5 px-4 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 rounded-xl text-xs font-semibold transition cursor-pointer"
                  >
                    <Pause className="w-4 h-4" />
                    Pausar
                  </button>
                )}

                {campaignStatus === "paused" && (
                  <button 
                    onClick={() => setCampaignStatus("running")}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-soft transition cursor-pointer"
                  >
                    <Play className="w-4 h-4" />
                    Retomar
                  </button>
                )}

                {campaignStatus !== "idle" && (
                  <button 
                    onClick={() => setCampaignStatus("idle")}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-xl text-xs font-semibold transition cursor-pointer shadow-soft"
                  >
                    <Square className="w-3.5 h-3.5 text-rose-500" />
                    Parar
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabela de Leads da Campanha */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-soft">
        <h4 className="text-sm font-bold text-foreground mb-3">Leads Importados na Fila ({leads.length})</h4>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-foreground">
            <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider border-b border-border">
              <tr>
                <th className="p-3 font-semibold">Nome / Empresa</th>
                <th className="p-3 font-semibold">Telefone</th>
                <th className="p-3 font-semibold">Interesse / Contexto</th>
                <th className="p-3 font-semibold">Tentativas</th>
                <th className="p-3 font-semibold">Status do Disparo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-bold text-foreground">
                    {lead.name}
                    <span className="block text-[11px] text-muted-foreground font-normal">{lead.company}</span>
                  </td>
                  <td className="p-3 text-foreground font-mono">{lead.phone}</td>
                  <td className="p-3 text-foreground">{lead.productInterest}</td>
                  <td className="p-3 text-muted-foreground">{lead.attempts} / 2</td>
                  <td className="p-3">
                    {lead.status === "done" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" /> Qualificado
                      </span>
                    )}
                    {lead.status === "calling" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold rounded-lg bg-primary/20 text-primary border border-primary/40 animate-pulse">
                        <PhoneCall className="w-3 h-3 animate-spin" /> Discando...
                      </span>
                    )}
                    {lead.status === "pending" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold rounded-lg bg-muted text-muted-foreground border border-border">
                        <Clock className="w-3 h-3" /> Aguardando Fila
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
