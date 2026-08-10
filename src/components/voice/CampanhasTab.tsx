import React, { useState } from "react";
import { Upload, Play, Pause, Square, FileSpreadsheet, CheckCircle2, Clock, AlertCircle, PhoneCall, ArrowRight } from "lucide-react";

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

  const [leads, setLeads] = useState<LeadItem[]>([
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

  const startCampaign = () => {
    setCampaignStatus("running");
  };

  const pauseCampaign = () => {
    setCampaignStatus("paused");
  };

  const stopCampaign = () => {
    setCampaignStatus("idle");
  };

  const totalLeads = leads.length;
  const completedLeads = leads.filter(l => l.status === "done").length;
  const callingLeads = leads.filter(l => l.status === "calling").length;
  const pendingLeads = leads.filter(l => l.status === "pending").length;

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto h-full text-slate-100">
      {/* Bloco de Upload / Status da Campanha */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
        <h3 className="text-base font-bold text-slate-100 mb-1">Disparo em Massa de Ligações IA</h3>
        <p className="text-xs text-slate-400 mb-4">Envie uma planilha CSV ou XLSX com os contatos para a Valentina discar automaticamente em sequência.</p>

        {campaignStatus === "idle" && !fileUploaded && (
          <div className="border-2 border-dashed border-slate-700 hover:border-blue-500/50 rounded-xl p-8 text-center flex flex-col items-center justify-center gap-3 transition-colors bg-slate-950/40">
            <div className="w-12 h-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">Arraste sua planilha ou clique para selecionar</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Suporta arquivos .CSV e .XLSX (Colunas: nome, telefone, empresa, produto_interesse)</p>
            </div>
            <label className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium cursor-pointer transition-colors mt-2">
              Selecionar Planilha
              <input type="file" accept=".csv, .xlsx" onChange={handleSimulateUpload} className="hidden" />
            </label>
          </div>
        )}

        {(fileUploaded || campaignStatus !== "idle") && (
          <div className="flex flex-col gap-4">
            {/* Barra de Progresso Ao Vivo */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="w-full md:w-1/2">
                <div className="flex justify-between text-xs text-slate-300 font-medium mb-1.5">
                  <span>Progresso da Campanha</span>
                  <span>{completedLeads} de {totalLeads} ligações ({Math.round((completedLeads/totalLeads)*100)}%)</span>
                </div>
                <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${(completedLeads/totalLeads)*100}%` }}
                  ></div>
                </div>
              </div>

              {/* Configurações de Intervalo */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <span>Intervalo:</span>
                  <select 
                    value={intervalSeconds}
                    onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                    disabled={campaignStatus === "running"}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  >
                    <option value={15}>15s entre ligações</option>
                    <option value={30}>30s entre ligações</option>
                    <option value={60}>60s entre ligações</option>
                  </select>
                </div>

                {/* Botões de Controle */}
                {campaignStatus === "idle" && (
                  <button 
                    onClick={startCampaign}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-md transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    Iniciar Campanha
                  </button>
                )}

                {campaignStatus === "running" && (
                  <button 
                    onClick={pauseCampaign}
                    className="flex items-center gap-1.5 px-4 py-2 bg-amber-500/20 border border-amber-500/40 text-amber-300 rounded-lg text-xs font-semibold transition-colors"
                  >
                    <Pause className="w-4 h-4" />
                    Pausar
                  </button>
                )}

                {campaignStatus === "paused" && (
                  <button 
                    onClick={startCampaign}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    Retomar
                  </button>
                )}

                {campaignStatus !== "idle" && (
                  <button 
                    onClick={stopCampaign}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Square className="w-3.5 h-3.5 text-rose-400" />
                    Parar
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabela de Leads da Campanha */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
        <h4 className="text-sm font-bold text-slate-200 mb-3">Leads Importados na Fila ({leads.length})</h4>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-3">Nome / Empresa</th>
                <th className="p-3">Telefone</th>
                <th className="p-3">Interesse / Contexto</th>
                <th className="p-3">Tentativas</th>
                <th className="p-3">Status do Disparo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="p-3 font-medium text-slate-100">
                    {lead.name}
                    <span className="block text-[11px] text-slate-400 font-normal">{lead.company}</span>
                  </td>
                  <td className="p-3 text-slate-300 font-mono">{lead.phone}</td>
                  <td className="p-3 text-slate-300">{lead.productInterest}</td>
                  <td className="p-3 text-slate-400">{lead.attempts} / 2</td>
                  <td className="p-3">
                    {lead.status === "done" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" /> Qualificado
                      </span>
                    )}
                    {lead.status === "calling" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-semibold rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40 animate-pulse">
                        <PhoneCall className="w-3 h-3 animate-spin" /> Discando...
                      </span>
                    )}
                    {lead.status === "pending" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-semibold rounded-full bg-slate-800 text-slate-400 border border-slate-700">
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
