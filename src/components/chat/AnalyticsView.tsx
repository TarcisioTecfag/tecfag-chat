import React, { useState, useEffect, useCallback } from "react";
import { useChat } from "@/hooks/useChatState";
import {
  BarChart2, Clock, Users, ArrowUpRight, ArrowDownRight,
  MessageSquare, RefreshCw, Percent, FileText, CheckCircle2,
  AlertTriangle, Info, Shield, HelpCircle, Activity, Star,
  TrendingUp, TrendingDown, Eye, Coins
} from "lucide-react";
// Componentes migrados do Monitoramento
import { OverviewTab, CostsTab } from "@/components/chat/MonitorView";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, BarChart, Bar, Cell, PieChart, Pie, RadialBarChart, RadialBar
} from "recharts";

// ── Tipos ───────────────────────────────────────────────────────────────────
type AnalyticsTab = "overview" | "performance" | "sla" | "contacts" | "reports" | "costs";

type HistoricalVolume = {
  name: string;
  chats: number;
  atendidos: number;
  sla: number;
};

type ChannelVolume = {
  name: string;
  value: number;
  color: string;
};

type SectorPerformance = {
  name: string;
  avgResponse: number;
  completed: number;
  slaPct: number;
};

type OperatorPerformance = {
  id?: string;
  name: string;
  chats: number;
  avgResponseSeconds: number;
  slaPct: number;
};

type ClientMetric = {
  name: string;
  novos: number;
  recorrentes: number;
};

type AiReportData = {
  id: string;
  type: "daily" | "weekly";
  period: string;
  reportMarkdown: string;
  generatedAt: string;
};

// ── Helpers de Renderização de Markdown Simples ──────────────────────────────
function parseMarkdown(md: string) {
  if (!md) return null;
  const lines = md.split("\n");
  
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      return (
        <h2 key={idx} className="text-sm font-extrabold text-foreground mt-4 mb-2 border-b border-line pb-1.5 flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-primary" />
          {trimmed.slice(3)}
        </h2>
      );
    }
    if (trimmed.startsWith("### ")) {
      return (
        <h3 key={idx} className="text-xs font-bold text-foreground mt-3 mb-1.5">
          {trimmed.slice(4)}
        </h3>
      );
    }
    if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
      return (
        <li key={idx} className="text-xs text-muted-foreground list-disc list-inside ml-3 py-0.5">
          {trimmed.slice(2)}
        </li>
      );
    }
    if (trimmed.startsWith("> [!NOTE]")) {
      return null;
    }
    if (line.startsWith("> ")) {
      return (
        <div key={idx} className="my-3 p-3 bg-primary-soft/50 border border-primary/20 text-foreground rounded-xl text-xs flex gap-2">
          <Info className="h-4.5 w-4.5 text-primary shrink-0 mt-0.5" />
          <div className="font-medium">{line.replace(/^>\s*(\[!NOTE\])?\s*/i, "").trim()}</div>
        </div>
      );
    }
    if (!trimmed) {
      return <div key={idx} className="h-2" />;
    }
    return (
      <p key={idx} className="text-xs text-muted-foreground leading-relaxed py-0.5">
        {trimmed}
      </p>
    );
  });
}

// ── Sub-Views ────────────────────────────────────────────────────────────────

// 1. Aba: Desempenho e Volumes
function PerformanceTab({ volumes, channels, sectors }: { 
  volumes: HistoricalVolume[]; 
  channels: ChannelVolume[]; 
  sectors: SectorPerformance[];
}) {
  const totalVolume = channels.reduce((sum, c) => sum + c.value, 0);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 overflow-y-auto scrollbar-thin pr-1">
      {/* Gráfico de Volume de Conversas */}
      <div className="xl:col-span-2 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col min-h-[320px]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xs font-extrabold text-foreground">Volumetria Semanal</h3>
            <p className="text-[10px] text-muted-foreground">Evolução de chats recebidos vs. finalizados por dia</p>
          </div>
          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100 flex items-center gap-0.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Operação Ativa
          </span>
        </div>
        <div className="flex-1 w-full h-[220px]">
          {volumes.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={volumes} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorChats" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.01}/>
                  </linearGradient>
                  <linearGradient id="colorAtendidos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.01}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: 12, fontSize: 11 }} />
                <Area type="monotone" dataKey="chats" name="Recebidas" stroke="var(--primary)" strokeWidth={2} fillOpacity={1} fill="url(#colorChats)" />
                <Area type="monotone" dataKey="atendidos" name="Finalizadas" stroke="#4f46e5" strokeWidth={2} fillOpacity={1} fill="url(#colorAtendidos)" />
                <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: 10 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Sem dados de volumetria registrados nos últimos 7 dias.
            </div>
          )}
        </div>
      </div>

      {/* Gráfico de Canais (Pie) */}
      <div className="bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col justify-between">
        <div>
          <h3 className="text-xs font-extrabold text-foreground">Distribuição por Canal</h3>
          <p className="text-[10px] text-muted-foreground">Volume acumulado por meio de comunicação</p>
        </div>
        <div className="h-[140px] flex items-center justify-center relative my-3">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={channels}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={60}
                paddingAngle={4}
                dataKey="value"
              >
                {channels.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute text-center">
            <p className="text-lg font-black text-foreground">{totalVolume}</p>
            <p className="text-[9px] text-muted-foreground uppercase font-semibold">Chats</p>
          </div>
        </div>
        <div className="space-y-1.5">
          {channels.map((chan) => (
            <div key={chan.name} className="flex items-center justify-between text-[11px] font-semibold">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: chan.color }} />
                <span className="text-muted-foreground">{chan.name}</span>
              </div>
              <span className="text-foreground">{chan.value} ({totalVolume > 0 ? Math.round((chan.value / totalVolume) * 100) : 0}%)</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tabela de Desempenho por Setores */}
      <div className="xl:col-span-3 bg-card rounded-2xl border border-border shadow-soft overflow-hidden mt-2">
        <div className="px-5 py-4 border-b border-line">
          <h3 className="text-xs font-extrabold text-foreground">Volume por Setor/Departamento</h3>
          <p className="text-[10px] text-muted-foreground">Atendimento e cumprimento de SLA consolidado</p>
        </div>
        <div className="overflow-x-auto">
          {sectors.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Nenhum setor cadastrado ou com atendimentos registrados.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground font-semibold border-b border-line">
                  <th className="px-5 py-3">Setor</th>
                  <th className="px-5 py-3">Conversas Concluídas</th>
                  <th className="px-5 py-3">TME de Resposta</th>
                  <th className="px-5 py-3">SLA Cumprido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sectors.map((sec) => (
                  <tr key={sec.name} className="hover:bg-muted/30 transition font-medium">
                    <td className="px-5 py-3 text-foreground font-bold">{sec.name}</td>
                    <td className="px-5 py-3 text-muted-foreground">{sec.completed}</td>
                    <td className="px-5 py-3 text-foreground">
                      {sec.avgResponse >= 60 ? `${Math.floor(sec.avgResponse / 60)}min` : `${sec.avgResponse}s`}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${sec.slaPct >= 90 ? "bg-emerald-500" : "bg-amber-400"}`} />
                        <span className={sec.slaPct >= 90 ? "text-emerald-600 font-bold" : "text-amber-600"}>{sec.slaPct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// 2. Aba: SLA e Tempos
function SlaTab({
  overallSlaPct,
  overdueCount,
  operators,
}: {
  overallSlaPct: number;
  overdueCount: number;
  operators: OperatorPerformance[];
}) {
  const avgSla = overallSlaPct;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 overflow-y-auto scrollbar-thin pr-1">
      {/* Gauge Circular SLA */}
      <div className="bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col justify-between items-center text-center">
        <div className="w-full text-left">
          <h3 className="text-xs font-extrabold text-foreground">SLA Geral da Operação</h3>
          <p className="text-[10px] text-muted-foreground">Porcentagem de chamados respondidos sob 15 minutos</p>
        </div>

        <div className="h-[140px] w-full flex items-center justify-center relative my-4">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              cx="50%"
              cy="50%"
              innerRadius="75%"
              outerRadius="95%"
              barSize={10}
              data={[{ name: "SLA", value: avgSla, fill: "var(--primary)" }]}
              startAngle={180}
              endAngle={-180}
            >
              <RadialBar background dataKey="value" cornerRadius={5} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute text-center">
            <span className="text-3xl font-black text-foreground">{avgSla}%</span>
            <p className={`text-[9px] font-bold px-2 py-0.5 rounded-full border mt-0.5 ${
              avgSla >= 90 ? "text-emerald-600 bg-emerald-50 border-emerald-100" : "text-amber-600 bg-amber-50 border-amber-100"
            }`}>
              {avgSla >= 90 ? "DENTRO DA META" : "ATENÇÃO"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-line pt-4 w-full text-xs font-semibold">
          <div>
            <span className="text-muted-foreground block text-[10px] uppercase">Meta SLA</span>
            <span className="text-foreground font-black text-sm">15 min</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px] uppercase">Excedidos</span>
            <span className={`font-black text-sm ${overdueCount > 0 ? "text-red-500" : "text-foreground"}`}>
              {overdueCount} chats
            </span>
          </div>
        </div>
      </div>

      {/* SLA por Operador */}
      <div className="xl:col-span-2 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col min-h-[300px]">
        <div>
          <h3 className="text-xs font-extrabold text-foreground">Cumprimento de SLA por Operador</h3>
          <p className="text-[10px] text-muted-foreground">Ranking de conformidade por agente</p>
        </div>
        <div className="flex-1 w-full h-[200px] mt-4">
          {operators.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={operators} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--line)" />
                <XAxis type="number" stroke="#94a3b8" fontSize={9} domain={[0, 100]} />
                <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={9} width={90} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="slaPct" name="SLA %" radius={[0, 4, 4, 0]}>
                  {operators.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.slaPct >= 90 ? "var(--primary)" : "#f59e0b"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Nenhum operador com métricas de SLA registradas.
            </div>
          )}
        </div>
      </div>

      {/* Tempo Médio de Resposta por Operador */}
      <div className="xl:col-span-3 bg-card rounded-2xl border border-border shadow-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-line">
          <h3 className="text-xs font-extrabold text-foreground">Métricas de Tempo e SLA por Operador</h3>
          <p className="text-[10px] text-muted-foreground">Visão detalhada e desagregada da performance diária</p>
        </div>
        <div className="overflow-x-auto">
          {operators.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Sem dados de atendimento por operador.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground font-semibold border-b border-line">
                  <th className="px-5 py-3">Agente</th>
                  <th className="px-5 py-3">Atendimentos</th>
                  <th className="px-5 py-3">Tempo Médio de Resposta</th>
                  <th className="px-5 py-3">SLA Cumprido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {operators.map((op) => (
                  <tr key={op.name} className="hover:bg-muted/30 transition font-medium">
                    <td className="px-5 py-3 text-foreground font-bold">{op.name}</td>
                    <td className="px-5 py-3 text-muted-foreground">{op.chats}</td>
                    <td className="px-5 py-3 text-foreground">
                      {op.chats > 0 && op.avgResponseSeconds > 0
                        ? (op.avgResponseSeconds >= 60
                            ? `${Math.floor(op.avgResponseSeconds / 60)}min ${op.avgResponseSeconds % 60}s`
                            : `${op.avgResponseSeconds}s`)
                        : "–"}
                    </td>
                    <td className="px-5 py-3">
                      {op.chats > 0 ? (
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          op.slaPct >= 90 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                        }`}>
                          {op.slaPct}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground font-mono text-xs">–</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// 3. Aba: Clientes e Frequência
function ContactsTab({
  clientMetrics,
  avgDaysWithoutService,
  avgFrequency,
  ragConversionPct,
}: {
  clientMetrics: ClientMetric[];
  avgDaysWithoutService: number;
  avgFrequency: number;
  ragConversionPct: number;
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 overflow-y-auto scrollbar-thin pr-1">
      {/* Novos vs Recorrentes */}
      <div className="xl:col-span-2 bg-card rounded-2xl p-5 border border-border shadow-soft flex flex-col min-h-[300px]">
        <div>
          <h3 className="text-xs font-extrabold text-foreground">Novos Clientes vs. Recorrentes</h3>
          <p className="text-[10px] text-muted-foreground">Aquisição de novos leads vs. retenção de contatos ativos</p>
        </div>
        <div className="flex-1 w-full h-[200px] mt-4">
          {clientMetrics.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clientMetrics} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} />
                <YAxis stroke="#94a3b8" fontSize={9} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} iconType="circle" />
                <Bar dataKey="novos" name="Novos Clientes" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="recorrentes" name="Recorrentes" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Sem dados de aquisição de contatos nas últimas semanas.
            </div>
          )}
        </div>
      </div>

      {/* Cartões Estatísticos de Contato */}
      <div className="space-y-4">
        <div className="bg-card rounded-2xl p-5 border border-border shadow-soft">
          <span className="text-[10px] font-bold text-muted-foreground uppercase">Tempo Médio Sem Atendimento</span>
          <p className="text-2xl font-black text-foreground mt-1">
            {avgDaysWithoutService > 0 ? `${avgDaysWithoutService} dias` : "–"}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">Média desde o último atendimento finalizado</p>
        </div>
        
        <div className="bg-card rounded-2xl p-5 border border-border shadow-soft">
          <span className="text-[10px] font-bold text-muted-foreground uppercase">Frequência Média</span>
          <p className="text-2xl font-black text-foreground mt-1">
            {avgFrequency > 0 ? `${avgFrequency} vezes/mês` : "–"}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">Contatos recorrentes que reabrem chats</p>
        </div>

        <div className="bg-card rounded-2xl p-5 border border-border shadow-soft">
          <span className="text-[10px] font-bold text-muted-foreground uppercase">Taxa de Conversão RAG/CSAT</span>
          <p className="text-2xl font-black text-foreground mt-1">{ragConversionPct}%</p>
          <p className="text-[10px] text-muted-foreground mt-1">Satisfação estimada em auditorias de contatos recorrentes</p>
        </div>
      </div>
    </div>
  );
}

// 4. Aba: Relatórios Automáticos de IA
function ReportsTab({ reports, loading }: { reports: AiReportData[]; loading: boolean }) {
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  useEffect(() => {
    if (reports.length > 0 && !selectedReportId) {
      setSelectedReportId(reports[0].id);
    }
  }, [reports, selectedReportId]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  const selectedReport = reports.find((r) => r.id === selectedReportId) || reports[0];

  return (
    <div className="flex gap-5 h-full overflow-hidden">
      {/* Lateral: Lista de Relatórios */}
      <div className="w-60 shrink-0 flex flex-col gap-2 overflow-y-auto scrollbar-thin pr-1">
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider px-2 block mb-1">
          Histórico de Relatórios
        </span>
        {reports.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground border border-dashed border-border rounded-xl text-center">
            Nenhum relatório de IA gerado ainda. Os relatórios são compilados diariamente às 18h.
          </div>
        ) : (
          reports.map((rep) => (
            <button
              key={rep.id}
              onClick={() => setSelectedReportId(rep.id)}
              className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                selectedReportId === rep.id
                  ? "border-primary bg-primary-soft/50 text-primary font-bold shadow-soft"
                  : "border-border bg-card text-foreground hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="capitalize">{rep.type === "weekly" ? "Semanal" : "Diário"}</span>
                <span className="text-[9px] text-muted-foreground font-mono">
                  {rep.period}
                </span>
              </div>
              <p className="text-[9px] text-muted-foreground/80">
                Gerado em: {new Date(rep.generatedAt).toLocaleDateString("pt-BR")}
              </p>
            </button>
          ))
        )}
      </div>

      {/* Principal: Visualizador Markdown */}
      <div className="flex-1 bg-card rounded-2xl border border-border shadow-soft p-6 overflow-y-auto scrollbar-thin">
        {selectedReport ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                  selectedReport.type === "weekly" ? "bg-violet-50 text-violet-700 border border-violet-100" : "bg-blue-50 text-blue-700 border border-blue-100"
                }`}>
                  Relatório {selectedReport.type === "weekly" ? "Semanal" : "Diário"}
                </span>
                <span className="text-[10px] text-muted-foreground ml-2">Período: {selectedReport.period}</span>
              </div>
              
              <span className="text-[9px] text-muted-foreground font-medium">
                Sincronizado via IA em {new Date(selectedReport.generatedAt).toLocaleString("pt-BR")}
              </span>
            </div>

            {/* Renderizador de Markdown */}
            <div className="space-y-3 font-sans">
              {parseMarkdown(selectedReport.reportMarkdown)}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
            Selecione um relatório para visualizar.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Componente Principal ─────────────────────────────────────────────────────
export function AnalyticsView() {
  const { tenant } = useChat();
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("overview");
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // Estados para dados reais das abas
  const [overview, setOverview] = useState<any | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [audits, setAudits] = useState<any[]>([]);

  const [performanceData, setPerformanceData] = useState<{
    volumes: HistoricalVolume[];
    channels: ChannelVolume[];
    sectors: SectorPerformance[];
  }>({
    volumes: [],
    channels: [],
    sectors: [],
  });

  const [slaData, setSlaData] = useState<{
    overallSlaPct: number;
    overdueCount: number;
    operators: OperatorPerformance[];
  }>({
    overallSlaPct: 100,
    overdueCount: 0,
    operators: [],
  });

  const [contactsData, setContactsData] = useState<{
    clientMetrics: ClientMetric[];
    avgDaysWithoutService: number;
    avgFrequency: number;
    ragConversionPct: number;
  }>({
    clientMetrics: [],
    avgDaysWithoutService: 0,
    avgFrequency: 0,
    ragConversionPct: 100,
  });

  const [reports, setReports] = useState<AiReportData[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Buscar dados reais de todas as APIs do módulo de estatísticas em paralelo
      const [ovRes, alRes, auRes, perfRes, slaRes, contRes, repRes] = await Promise.all([
        fetch(`/api/gestao/overview?tenantId=${tenant}`),
        fetch(`/api/gestao/alerts?tenantId=${tenant}`),
        fetch(`/api/gestao/audits?tenantId=${tenant}&limit=50`),
        fetch(`/api/gestao/performance?tenantId=${tenant}`),
        fetch(`/api/gestao/sla?tenantId=${tenant}`),
        fetch(`/api/gestao/contacts-analytics?tenantId=${tenant}`),
        fetch(`/api/gestao/reports?tenantId=${tenant}`),
      ]);

      if (ovRes.ok) setOverview(await ovRes.json());
      if (alRes.ok) setAlerts(await alRes.json());
      if (auRes.ok) setAudits(await auRes.json());

      if (perfRes.ok) {
        const pData = await perfRes.json();
        setPerformanceData({
          volumes: pData.volumes || [],
          channels: pData.channels || [],
          sectors: pData.sectors || [],
        });
      }

      if (slaRes.ok) {
        const sData = await slaRes.json();
        setSlaData({
          overallSlaPct: sData.overallSlaPct ?? 100,
          overdueCount: sData.overdueCount ?? 0,
          operators: sData.operators || [],
        });
      }

      if (contRes.ok) {
        const cData = await contRes.json();
        setContactsData({
          clientMetrics: cData.clientMetrics || [],
          avgDaysWithoutService: cData.avgDaysWithoutService ?? 0,
          avgFrequency: cData.avgFrequency ?? 0,
          ragConversionPct: cData.ragConversionPct ?? 100,
        });
      }

      if (repRes.ok) {
        const rData = await repRes.json();
        if (Array.isArray(rData)) setReports(rData);
      }

      setLastRefresh(new Date());
    } catch (e) {
      console.error("[AnalyticsView] Erro ao carregar dados reais de BI:", e);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const tabs: { id: AnalyticsTab; label: string; icon: React.ElementType }[] = [
    { id: "overview",     label: "Visão Geral",   icon: Eye },
    { id: "performance",  label: "Desempenho",     icon: BarChart2 },
    { id: "sla",          label: "SLA & Tempos",   icon: Clock },
    { id: "contacts",     label: "Clientes",       icon: Users },
    { id: "reports",      label: "Relatórios IA",  icon: FileText },
    { id: "costs",        label: "Custos",         icon: Coins },
  ];

  return (
    <div className="flex flex-col h-full bg-card rounded-3xl border border-border shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
        <div>
          <h1 className="text-base font-extrabold text-foreground flex items-center gap-2">
            <BarChart2 className="h-4.5 w-4.5 text-primary" />
            Estatísticas da Operação
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">Análise e BI de performance histórica consolidada</p>
        </div>
        <button
          onClick={fetchData}
          title="Atualizar agora"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
          {lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </button>
      </div>

      {/* Interna Tab Bar */}
      <div className="flex items-center gap-1 px-5 py-2.5 border-b border-line bg-muted/30 shrink-0">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden px-5 py-4 flex flex-col">
        {activeTab === "overview" && (
          <OverviewTab
            overview={overview}
            alerts={alerts}
            audits={audits}
            onSwitchTab={() => {}}
          />
        )}
        {activeTab === "performance" && (
          <PerformanceTab
            volumes={performanceData.volumes}
            channels={performanceData.channels}
            sectors={performanceData.sectors}
          />
        )}
        {activeTab === "sla" && (
          <SlaTab
            overallSlaPct={slaData.overallSlaPct}
            overdueCount={slaData.overdueCount}
            operators={slaData.operators}
          />
        )}
        {activeTab === "contacts" && (
          <ContactsTab
            clientMetrics={contactsData.clientMetrics}
            avgDaysWithoutService={contactsData.avgDaysWithoutService}
            avgFrequency={contactsData.avgFrequency}
            ragConversionPct={contactsData.ragConversionPct}
          />
        )}
        {activeTab === "reports" && (
          <ReportsTab reports={reports} loading={loading} />
        )}
        {activeTab === "costs" && (
          <CostsTab tenant={tenant} />
        )}
      </div>
    </div>
  );
}
