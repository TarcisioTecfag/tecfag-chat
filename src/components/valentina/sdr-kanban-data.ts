// ══════════════════════════════════════════════════════════════════════════════
// 📋 SDR KANBAN DATA & TYPES — Organização do Funil de Triagem Fagner / Valentina
// ══════════════════════════════════════════════════════════════════════════════

import React from "react";
import {
  Target,
  Wrench,
  Package,
  Settings,
  Sparkles,
  CircleDollarSign,
  Component,
  Shuffle,
  Layers,
  AlertTriangle,
  MessageSquareOff,
} from "lucide-react";
import { SdrTriageSession } from "./SdrTab";

export type KanbanColumnKey =
  | "triagem"
  | "assistencia_tecnica"
  | "pos_venda"
  | "maquinas"
  | "personalite"
  | "financeiro"
  | "pecas"
  | "avulso"
  | "outros"
  | "problemas"
  | "sem_resposta";

export interface KanbanColumnDef {
  key: KanbanColumnKey;
  label: string;
  icon: React.ElementType;
  headerBorder: string;
  headerBg: string;
  badgeBg: string;
  badgeText: string;
  accentColor: string;
  emptyText: string;
}

export const KANBAN_COLUMNS: KanbanColumnDef[] = [
  {
    key: "triagem",
    label: "TRIAGEM",
    icon: Target,
    headerBorder: "border-slate-300 dark:border-slate-700",
    headerBg: "bg-slate-100/80 dark:bg-slate-800/60",
    badgeBg: "bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200",
    badgeText: "text-slate-800 dark:text-slate-200",
    accentColor: "#64748b",
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "assistencia_tecnica",
    label: "ASSISTÊNCIA TÉCNICA",
    icon: Wrench,
    headerBorder: "border-sky-300 dark:border-sky-800/60",
    headerBg: "bg-sky-50/70 dark:bg-sky-950/30",
    badgeBg: "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300",
    badgeText: "text-sky-700 dark:text-sky-300",
    accentColor: "#0284c7",
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "pos_venda",
    label: "PÓS VENDA",
    icon: Package,
    headerBorder: "border-blue-300 dark:border-blue-800/60",
    headerBg: "bg-blue-50/70 dark:bg-blue-950/30",
    badgeBg: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
    badgeText: "text-blue-700 dark:text-blue-300",
    accentColor: "#2563eb",
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "maquinas",
    label: "MÁQUINAS",
    icon: Settings,
    headerBorder: "border-indigo-300 dark:border-indigo-800/60",
    headerBg: "bg-indigo-50/70 dark:bg-indigo-950/30",
    badgeBg: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300",
    badgeText: "text-indigo-700 dark:text-indigo-300",
    accentColor: "#6366f1",
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "personalite",
    label: "PERSONNALITÉ",
    icon: Sparkles,
    headerBorder: "border-fuchsia-300 dark:border-fuchsia-800/60",
    headerBg: "bg-fuchsia-50/70 dark:bg-fuchsia-950/30",
    badgeBg: "bg-fuchsia-100 dark:bg-fuchsia-900/40 text-fuchsia-700 dark:text-fuchsia-300",
    badgeText: "text-fuchsia-700 dark:text-fuchsia-300",
    accentColor: "#d946ef",
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "financeiro",
    label: "FINANCEIRO",
    icon: CircleDollarSign,
    headerBorder: "border-emerald-300 dark:border-emerald-800/60",
    headerBg: "bg-emerald-50/70 dark:bg-emerald-950/30",
    badgeBg: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
    badgeText: "text-emerald-700 dark:text-emerald-300",
    accentColor: "#10b981",
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "pecas",
    label: "PEÇAS",
    icon: Component,
    headerBorder: "border-purple-300 dark:border-purple-800/60",
    headerBg: "bg-purple-50/70 dark:bg-purple-950/30",
    badgeBg: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
    badgeText: "text-purple-700 dark:text-purple-300",
    accentColor: "#9333ea",
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "avulso",
    label: "AVULSO",
    icon: Shuffle,
    headerBorder: "border-violet-300 dark:border-violet-800/60",
    headerBg: "bg-violet-50/70 dark:bg-violet-950/30",
    badgeBg: "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300",
    badgeText: "text-violet-700 dark:text-violet-300",
    accentColor: "#8b5cf6",
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "outros",
    label: "OUTROS",
    icon: Layers,
    headerBorder: "border-zinc-400 dark:border-zinc-700",
    headerBg: "bg-zinc-100/90 dark:bg-zinc-800/70",
    badgeBg: "bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200",
    badgeText: "text-zinc-800 dark:text-zinc-200",
    accentColor: "#52525b",
    emptyText: "A IA moverá clientes automaticamente",
  },
  {
    key: "problemas",
    label: "PROBLEMAS",
    icon: AlertTriangle,
    headerBorder: "border-rose-300 dark:border-rose-800/70",
    headerBg: "bg-rose-50/80 dark:bg-rose-950/30",
    badgeBg: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300",
    badgeText: "text-rose-700 dark:text-rose-300",
    accentColor: "#f43f5e",
    emptyText: "Nenhum problema reportado",
  },
  {
    key: "sem_resposta",
    label: "SEM RESPOSTA",
    icon: MessageSquareOff,
    headerBorder: "border-amber-300 dark:border-amber-800/70",
    headerBg: "bg-amber-50/80 dark:bg-amber-950/30",
    badgeBg: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    badgeText: "text-amber-700 dark:text-amber-300",
    accentColor: "#f59e0b",
    emptyText: "Nenhum contato pendente de resposta",
  },
];

// ─── Classificador Inteligente de Funil ──────────────────────────────────────
export function classifySessionToColumn(session: SdrTriageSession): KanbanColumnKey {
  if ((session as any).funnelStage) {
    return (session as any).funnelStage as KanbanColumnKey;
  }

  const norm = (str: string = "") =>
    str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const outcome = norm(session.outcome);
  const step = norm(session.currentStep);
  const resp = norm(session.responsibleName);
  const qualif = norm(session.collectedData?.["TIPO DE QUALIFICAÇÃO"]?.value);
  const prod = norm(session.collectedData?.["QUAL O TIPO DE PRODUTO?"]?.value);

  // 1. Sem Resposta / Abandonado
  if (
    session.status === "abandoned" ||
    outcome === "abandoned" ||
    outcome.includes("sem resposta") ||
    outcome.includes("sem_resposta") ||
    outcome === "no_reply"
  ) {
    return "sem_resposta";
  }

  // 2. Problemas / Escalação
  if (outcome === "problem" || outcome === "escalated" || step.includes("problema") || step.includes("bloqueio")) {
    return "problemas";
  }

  // 3. Setores Específicos
  if (qualif.includes("peca") || prod.includes("peca") || step.includes("peca")) {
    return "pecas";
  }
  if (qualif.includes("personalite") || prod.includes("personalite") || resp.includes("personalite")) {
    return "personalite";
  }
  if (qualif.includes("maquina") || prod.includes("maquina") || prod.includes("seladora") || prod.includes("embaladora") || resp.includes("maquina")) {
    return "maquinas";
  }
  if (qualif.includes("assistencia") || qualif.includes("suporte") || step.includes("assistencia") || step.includes("suporte") || resp.includes("assistencia")) {
    return "assistencia_tecnica";
  }
  if (qualif.includes("pos venda") || qualif.includes("pos-venda") || resp.includes("pos venda") || step.includes("pos venda")) {
    return "pos_venda";
  }
  if (qualif.includes("financeiro") || step.includes("financeiro") || resp.includes("financeiro")) {
    return "financeiro";
  }
  if (qualif.includes("avulso") || resp.includes("avulso") || step.includes("avulso")) {
    return "avulso";
  }

  // 4. Concluída sem setor específico
  if (session.status === "completed" || outcome === "completed" || outcome === "transferred") {
    return "outros";
  }

  // 5. Em andamento / Triagem
  return "triagem";
}

// ─── Dados de Referência e Benchmark Fidedignos às Fotos ─────────────────────
export const BENCHMARK_SDR_SESSIONS: SdrTriageSession[] = [
  // ── COLUNA: TRIAGEM ──
  {
    id: "sdr-tr-1",
    conversationId: "conv-teirs-1",
    contactName: "Teirs acessórios para maquinas",
    company: "Teirs Comércio de Acessórios",
    phone: "(11) 98765-4321",
    currentStep: "Qualificação de Produtos",
    startedAt: new Date(Date.now() - 1000 * 60 * 105).toISOString(), // 1h 45 min
    status: "active",
    outcome: "in_progress",
    responsibleName: "IA (Em Triagem)",
    collectedData: {
      "NOME COMPLETO": { value: "Teirs Acessórios", status: "filled" },
      "EMPRESA": { value: "Teirs Comércio de Acessórios", status: "filled" },
      "CNPJ": { value: "45.123.456/0001-89", status: "filled" },
      "EMAIL": { value: "Aguardando...", status: "pending" },
      "QUAL O TIPO DE PRODUTO?": { value: "Peças de reposição e esteiras", status: "filled" },
      "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO": { value: "Aguardando...", status: "pending" },
      "TIPO DE QUALIFICAÇÃO": { value: "Aguardando...", status: "pending" },
      "QUALIFICAÇÃO (TEMPERATURA)": { value: "Morna", status: "filled" },
    },
    messages: [
      { sender: "client", text: "Olá, boa tarde! Gostaria de consultar peças e acessórios para máquinas industriais.", time: "14:15" },
      { sender: "bot", text: "Olá! Seja muito bem-vindo. Sou o Fagner, consultor virtual da Tecfag. Com certeza posso te ajudar com peças e acessórios! Poderia me informar seu nome completo e o nome da sua empresa?", time: "14:15" },
      { sender: "client", text: "Me chamo Roberto, da Teirs Acessórios para Máquinas.", time: "14:18" },
      { sender: "bot", text: "Prazer, Roberto! Para agilizar seu atendimento e cotação, qual é o modelo exato da máquina e quais peças você precisa no momento?", time: "14:19" },
    ],
    ...({
      funnelStage: "triagem",
      progressPct: 60,
      triageStatus: "analisando",
      botStatus: "ativo",
      timeAgo: "1h 45 min",
      unreadCount: 1,
    } as any),
  },
  {
    id: "sdr-tr-2",
    conversationId: "conv-colort-2",
    contactName: "Colort",
    company: "Colort Indústria Gráfica",
    phone: "(19) 99123-5566",
    currentStep: "Identificação Inicial",
    startedAt: new Date(Date.now() - 1000 * 60 * 110).toISOString(), // 1h 50 min
    status: "active",
    outcome: "in_progress",
    responsibleName: "IA (Em Triagem)",
    collectedData: {
      "NOME COMPLETO": { value: "Colort", status: "filled" },
      "EMPRESA": { value: "Colort Indústria Gráfica", status: "filled" },
      "CNPJ": { value: "Aguardando...", status: "pending" },
      "EMAIL": { value: "Aguardando...", status: "pending" },
    },
    messages: [
      { sender: "client", text: "Boa tarde, vocês trabalham com seladoras automáticas contínuas?", time: "14:10" },
      { sender: "bot", text: "Olá! Boa tarde. Sim, trabalhamos com uma linha completa de seladoras industriais com datador e esteira. Sou o Fagner da Tecfag! Qual tipo de embalagem você costuma selar aí na Colort?", time: "14:11" },
    ],
    ...({
      funnelStage: "triagem",
      progressPct: 25,
      triageStatus: "analisando",
      botStatus: "ativo",
      timeAgo: "1h 50 min",
    } as any),
  },
  {
    id: "sdr-tr-3",
    conversationId: "conv-cidro-3",
    contactName: "Cidró",
    company: "Cidró Embalagens Especiais",
    phone: "(31) 98844-2211",
    currentStep: "Identificação Inicial",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(),
    status: "active",
    outcome: "in_progress",
    responsibleName: "IA (Em Triagem)",
    collectedData: {
      "NOME COMPLETO": { value: "Cidró", status: "filled" },
      "EMPRESA": { value: "Cidró Embalagens Especiais", status: "filled" },
    },
    messages: [
      { sender: "client", text: "Oi Fagner, preciso cotar uma embaladora a vácuo de duas câmaras.", time: "Ontem" },
      { sender: "bot", text: "Excelente! Nossa embaladora de câmara dupla é perfeita para alta produtividade. Qual a dimensão aproximada dos seus pacotes?", time: "Ontem" },
    ],
    ...({
      funnelStage: "triagem",
      progressPct: 25,
      triageStatus: "analisando",
      botStatus: "ativo",
      timeAgo: "1d 45 min",
    } as any),
  },
  {
    id: "sdr-tr-4",
    conversationId: "conv-mariacleide-4",
    contactName: "Maria Cleide Compras",
    company: "Agroindústria Alvorada",
    phone: "(62) 99876-1234",
    currentStep: "Volume de Produção",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 128).toISOString(),
    status: "active",
    outcome: "in_progress",
    responsibleName: "IA (Em Triagem)",
    collectedData: {
      "NOME COMPLETO": { value: "Maria Cleide", status: "filled" },
      "EMPRESA": { value: "Agroindústria Alvorada", status: "filled" },
      "CNPJ": { value: "02.456.789/0001-20", status: "filled" },
      "QUAL O TIPO DE PRODUTO?": { value: "Envasadora de grãos e sachês", status: "filled" },
    },
    messages: [
      { sender: "client", text: "Bom dia, sou a Maria Cleide do setor de compras da Alvorada.", time: "Segunda" },
      { sender: "bot", text: "Olá Maria Cleide! Prazer em falar com você. Estou aqui para entender sua necessidade e preparar a melhor proposta da Tecfag.", time: "Segunda" },
    ],
    ...({
      funnelStage: "triagem",
      progressPct: 50,
      triageStatus: "analisando",
      botStatus: "ativo",
      timeAgo: "5d 8h",
    } as any),
  },

  // ── COLUNA: OUTROS (Triagens Concluídas / Qualificadas) ──
  {
    id: "sdr-ou-1",
    conversationId: "conv-florencio-5",
    contactName: "Florencio Nascimento",
    company: "Nascimento Indústria de Plásticos",
    phone: "(81) 98455-1122",
    currentStep: "Triagem Concluída",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 15).toISOString(),
    status: "completed",
    outcome: "completed",
    responsibleName: "Alocado Comercial (Máquinas)",
    collectedData: {
      "NOME COMPLETO": { value: "Florencio Nascimento", status: "filled" },
      "EMPRESA": { value: "Nascimento Indústria de Plásticos", status: "filled" },
      "CNPJ": { value: "11.222.333/0001-44", status: "filled" },
      "EMAIL": { value: "florencio@nascimentoplasticos.com.br", status: "filled" },
      "QUAL O TIPO DE PRODUTO?": { value: "Envolvedora de Paletes automática", status: "filled" },
      "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO": { value: "NÃO", status: "filled" },
      "TIPO DE QUALIFICAÇÃO": { value: "Industrial – Lançamento", status: "filled" },
      "QUALIFICAÇÃO (TEMPERATURA)": { value: "Quente", status: "filled" },
    },
    messages: [
      { sender: "client", text: "Boa tarde, qual o prazo de entrega da envolvedora de paletes modelo TP1650?", time: "09:30" },
      { sender: "bot", text: "Olá Florencio! Temos esse modelo com pronta entrega ou prazo médio de 5 dias úteis com testes em fábrica. Já coletei todos os seus dados e transferi sua ficha para nosso especialista comercial dar andamento!", time: "09:34" },
      { sender: "client", text: "Excelente Fagner, muito obrigado pelo rápido atendimento.", time: "09:35" },
    ],
    ...({
      funnelStage: "outros",
      progressPct: 100,
      triageStatus: "concluida",
      botStatus: "parado",
      timeAgo: "15h 17 min",
    } as any),
  },
  {
    id: "sdr-ou-2",
    conversationId: "conv-lara-6",
    contactName: "Lara",
    company: "Lara Cosméticos Naturais",
    phone: "(21) 97722-3344",
    currentStep: "Triagem Concluída",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 15.5).toISOString(),
    status: "completed",
    outcome: "completed",
    responsibleName: "Alocado Comercial (Personnalité)",
    collectedData: {
      "NOME COMPLETO": { value: "Lara Mendes", status: "filled" },
      "EMPRESA": { value: "Lara Cosméticos", status: "filled" },
      "CNPJ": { value: "22.333.444/0001-55", status: "filled" },
      "EMAIL": { value: "contato@laracosmeticos.com.br", status: "filled" },
      "QUAL O TIPO DE PRODUTO?": { value: "Válvulas spray e frascos pet 100ml", status: "filled" },
    },
    messages: [
      { sender: "client", text: "Olá, preciso de 10.000 frascos com válvula spray preta.", time: "10:15" },
      { sender: "bot", text: "Perfeito Lara! Triagem finalizada com sucesso. Seu consultor entrará em contato em minutos com a tabela de atacado.", time: "10:18" },
    ],
    ...({
      funnelStage: "outros",
      progressPct: 100,
      triageStatus: "concluida",
      botStatus: "parado",
      timeAgo: "15h 32 min",
    } as any),
  },
  {
    id: "sdr-ou-3",
    conversationId: "conv-raphael-7",
    contactName: "Raphael Drogaria Os...",
    company: "Drogaria São Paulo Distribuição",
    phone: "(11) 96544-7788",
    currentStep: "Triagem Concluída",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 15.5).toISOString(),
    status: "completed",
    outcome: "completed",
    responsibleName: "Alocado Comercial",
    collectedData: {
      "NOME COMPLETO": { value: "Raphael Oliveira", status: "filled" },
      "EMPRESA": { value: "Drogaria Osasco Ltda", status: "filled" },
      "CNPJ": { value: "33.444.555/0001-66", status: "filled" },
    },
    messages: [
      { sender: "client", text: "Enviei o CNPJ para faturamento direto.", time: "10:20" },
      { sender: "bot", text: "CNPJ validado com sucesso Raphael! Transferindo para a expedição comercial.", time: "10:21" },
    ],
    ...({
      funnelStage: "outros",
      progressPct: 100,
      triageStatus: "concluida",
      botStatus: "parado",
      timeAgo: "15h 32 min",
    } as any),
  },
  {
    id: "sdr-ou-4",
    conversationId: "conv-paulo-8",
    contactName: "PAULO AL",
    company: "Paulo Alimentos Nordeste",
    phone: "(82) 99111-2233",
    currentStep: "Validação de CNPJ",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 15.5).toISOString(),
    status: "completed",
    outcome: "transferred",
    responsibleName: "Alocado Comercial",
    collectedData: {
      "NOME COMPLETO": { value: "Paulo Alexandre", status: "filled" },
      "EMPRESA": { value: "Paulo Alimentos", status: "filled" },
    },
    messages: [
      { sender: "client", text: "Preciso de cotação para duas seladoras a vácuo de bico.", time: "10:30" },
      { sender: "bot", text: "Paulo, já registrei o modelo de bico externo para seu perfil alimentício.", time: "10:32" },
    ],
    ...({
      funnelStage: "outros",
      progressPct: 50,
      triageStatus: "analisando",
      botStatus: "parado",
      timeAgo: "15h 32 min",
    } as any),
  },
  {
    id: "sdr-ou-5",
    conversationId: "conv-todd-9",
    contactName: "TODD",
    company: "Todd Snacks e Grãos",
    phone: "(41) 98877-6655",
    currentStep: "Triagem Concluída",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString(),
    status: "completed",
    outcome: "completed",
    responsibleName: "Vendedor Alocado",
    collectedData: {
      "NOME COMPLETO": { value: "Todd", status: "filled" },
      "EMPRESA": { value: "Todd Snacks", status: "filled" },
    },
    messages: [
      { sender: "client", text: "Recebi a máquina e os manuais, tudo certo.", time: "15d atrás" },
      { sender: "bot", text: "Excelente! Permanecemos à disposição.", time: "15d atrás" },
    ],
    ...({
      funnelStage: "outros",
      progressPct: 100,
      triageStatus: "concluida",
      botStatus: "parado",
      timeAgo: "15d 1 dias",
    } as any),
  },
  {
    id: "sdr-ou-6",
    conversationId: "conv-jonatas-10",
    contactName: "Jônatas",
    company: "Jônatas Manutenção e Elétrica",
    phone: "(47) 99233-4455",
    currentStep: "Triagem Concluída",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString(),
    status: "completed",
    outcome: "completed",
    responsibleName: "Vendedor Alocado",
    collectedData: {
      "NOME COMPLETO": { value: "Jônatas Lima", status: "filled" },
    },
    messages: [
      { sender: "client", text: "Agradeço o retorno rápido.", time: "15d atrás" },
    ],
    ...({
      funnelStage: "outros",
      progressPct: 100,
      triageStatus: "concluida",
      botStatus: "parado",
      timeAgo: "15d 1 dias",
    } as any),
  },
  {
    id: "sdr-ou-7",
    conversationId: "conv-tatiribeiro-11",
    contactName: "Tati Ribeiro",
    company: "Ribeiro Gourmet",
    phone: "(31) 98766-5544",
    currentStep: "Triagem Concluída",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString(),
    status: "completed",
    outcome: "completed",
    responsibleName: "Vendedor Alocado",
    collectedData: {
      "NOME COMPLETO": { value: "Tatiane Ribeiro", status: "filled" },
    },
    messages: [{ sender: "client", text: "Perfeito, fechamos a compra.", time: "15d atrás" }],
    ...({
      funnelStage: "outros",
      progressPct: 100,
      triageStatus: "concluida",
      botStatus: "parado",
      timeAgo: "15d 1 dias",
    } as any),
  },
  {
    id: "sdr-ou-8",
    conversationId: "conv-lituana-12",
    contactName: "Lituana",
    company: "Lituana Representações Marítimas",
    phone: "(13) 99744-1100",
    currentStep: "Triagem Concluída",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString(),
    status: "completed",
    outcome: "completed",
    responsibleName: "Vendedor Alocado",
    collectedData: {
      "NOME COMPLETO": { value: "Lituana Santos", status: "filled" },
    },
    messages: [{ sender: "client", text: "Proposta aceita.", time: "15d atrás" }],
    ...({
      funnelStage: "outros",
      progressPct: 100,
      triageStatus: "concluida",
      botStatus: "parado",
      timeAgo: "15d 1 dias",
    } as any),
  },

  // ── COLUNA: PROBLEMAS ──
  {
    id: "sdr-pr-1",
    conversationId: "conv-stark-13",
    contactName: "STARK",
    company: "Stark Automação Industrial",
    phone: "(11) 97788-9900",
    currentStep: "Erro de Comunicação / Divergência",
    startedAt: new Date(Date.now() - 1000 * 60 * 105).toISOString(),
    status: "active",
    outcome: "problem",
    responsibleName: "Supervisor (Alerta)",
    collectedData: {
      "NOME COMPLETO": { value: "Stark Indústria", status: "filled" },
    },
    messages: [
      { sender: "client", text: "O equipamento enviado veio com voltagem 110V em vez de 220V que pedi na ordem!", time: "14:20" },
      { sender: "bot", text: "Peço imensas desculpas pelo transtorno. Estou registrando imediatamente uma ocorrência prioritária para nosso suporte técnico verificar seu pedido.", time: "14:21" },
    ],
    ...({
      funnelStage: "problemas",
      progressPct: 25,
      triageStatus: "analisando",
      botStatus: "ativo",
      timeAgo: "1h 45 min",
    } as any),
  },
  {
    id: "sdr-pr-2",
    conversationId: "conv-cargapesos-14",
    contactName: "Carga Pesos",
    company: "Carga Pesos Transporte e Logística",
    phone: "(41) 99188-7766",
    currentStep: "Atraso de Entrega Transportadora",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 138).toISOString(),
    status: "active",
    outcome: "problem",
    responsibleName: "Logística / SAC",
    collectedData: {
      "NOME COMPLETO": { value: "Carga Pesos", status: "filled" },
    },
    messages: [
      { sender: "client", text: "A transportadora ainda não coletou a mercadoria no galpão!", time: "5d atrás" },
      { sender: "bot", text: "Acionei nossa equipe de expedição para cobrança urgente da transportadora.", time: "5d atrás" },
    ],
    ...({
      funnelStage: "problemas",
      progressPct: 50,
      triageStatus: "analisando",
      botStatus: "ativo",
      timeAgo: "5d 18 dias",
    } as any),
  },
  {
    id: "sdr-pr-3",
    conversationId: "conv-dendearaguaia-15",
    contactName: "DENDE ARAGUAIA PRODUTOS...",
    company: "Dendê Araguaia Indústria de Alimentos",
    phone: "(91) 98844-3322",
    currentStep: "Divergência Fiscal de Nota",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 138).toISOString(),
    status: "completed",
    outcome: "escalated",
    responsibleName: "Financeiro / Fiscal",
    collectedData: {
      "NOME COMPLETO": { value: "Dendê Araguaia", status: "filled" },
    },
    messages: [
      { sender: "client", text: "A chave da Danfe não consta no Sefaz.", time: "5d atrás" },
      { sender: "bot", text: "Verificando com o setor fiscal a reemissão da NF-e.", time: "5d atrás" },
    ],
    ...({
      funnelStage: "problemas",
      progressPct: 100,
      triageStatus: "analisando",
      botStatus: "parado",
      timeAgo: "5d 18 dias",
    } as any),
  },

  // ── COLUNA: SEM RESPOSTA ──
  {
    id: "sdr-sr-1",
    conversationId: "conv-rodrigo-16",
    contactName: "Rodrigo",
    company: "Rodrigo Distribuidora",
    phone: "(11) 98777-6655",
    currentStep: "Aguardando Resposta do Cliente",
    startedAt: new Date(Date.now() - 1000 * 60 * 105).toISOString(),
    status: "abandoned",
    outcome: "sem_resposta",
    responsibleName: "IA (Follow-up)",
    collectedData: {
      "NOME COMPLETO": { value: "Rodrigo", status: "filled" },
    },
    messages: [
      { sender: "bot", text: "Olá Rodrigo! Conseguiu verificar a cotação das envasadoras que te mandei?", time: "14:15" },
    ],
    ...({
      funnelStage: "sem_resposta",
      progressPct: 50,
      triageStatus: "analisando",
      botStatus: "ativo",
      timeAgo: "1h 45 min",
    } as any),
  },
  {
    id: "sdr-sr-2",
    conversationId: "conv-rivaldo-17",
    contactName: "RIVALDO ROCHA NETTO",
    company: "Rocha Netto Comércio de Embalagens",
    phone: "(85) 99655-4433",
    currentStep: "Cliente não respondeu saudação",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 34).toISOString(),
    status: "abandoned",
    outcome: "sem_resposta",
    responsibleName: "IA (Follow-up)",
    collectedData: {},
    messages: [
      { sender: "client", text: "Olá", time: "1d atrás" },
      { sender: "bot", text: "Olá Rivaldo! Como posso te ajudar na Tecfag hoje?", time: "1d atrás" },
    ],
    ...({
      funnelStage: "sem_resposta",
      progressPct: 0,
      triageStatus: "analisando",
      botStatus: "parado",
      timeAgo: "1d 10h",
    } as any),
  },
  {
    id: "sdr-sr-3",
    conversationId: "conv-fabio-18",
    contactName: "Fabio - Indução",
    company: "Indução Embalagens Técnicas",
    phone: "(19) 98122-3344",
    currentStep: "Sem Resposta",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 58).toISOString(),
    status: "abandoned",
    outcome: "sem_resposta",
    responsibleName: "IA (Follow-up)",
    collectedData: {},
    messages: [
      { sender: "bot", text: "Fabio, fico à disposição caso queira agendar uma demonstração da seladora por indução!", time: "2d atrás" },
    ],
    ...({
      funnelStage: "sem_resposta",
      progressPct: 0,
      triageStatus: "analisando",
      botStatus: "parado",
      timeAgo: "2d 10h",
    } as any),
  },
  {
    id: "sdr-sr-4",
    conversationId: "conv-heitor-19",
    contactName: "HEITOR COSMETICOS",
    company: "Heitor Cosméticos e Aromas",
    phone: "(31) 99455-8899",
    currentStep: "Sem Resposta",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 58).toISOString(),
    status: "abandoned",
    outcome: "sem_resposta",
    responsibleName: "IA (Follow-up)",
    collectedData: {
      "NOME COMPLETO": { value: "Heitor Cosméticos", status: "filled" },
    },
    messages: [
      { sender: "bot", text: "Heitor, precisa de auxílio com a quantidade mínima de potes e tampas?", time: "2d atrás" },
    ],
    ...({
      funnelStage: "sem_resposta",
      progressPct: 25,
      triageStatus: "sem_resposta",
      botStatus: "ativo",
      timeAgo: "2d 10h",
    } as any),
  },
  {
    id: "sdr-sr-5",
    conversationId: "conv-amos-20",
    contactName: "Amos/Fritas",
    company: "Fritas e Salgados Amos",
    phone: "(11) 98222-1144",
    currentStep: "Sem Resposta",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 58).toISOString(),
    status: "abandoned",
    outcome: "sem_resposta",
    responsibleName: "IA (Follow-up)",
    collectedData: {
      "NOME COMPLETO": { value: "Amos Fritas", status: "filled" },
    },
    messages: [
      { sender: "bot", text: "Amos, ainda está buscando a seladora contínua para salgados?", time: "2d atrás" },
    ],
    ...({
      funnelStage: "sem_resposta",
      progressPct: 50,
      triageStatus: "analisando",
      botStatus: "parado",
      timeAgo: "2d 10h",
    } as any),
  },
  {
    id: "sdr-sr-6",
    conversationId: "conv-brevetto-21",
    contactName: "Brevetto",
    company: "Brevetto Equipamentos",
    phone: "(47) 98833-2211",
    currentStep: "Sem Resposta",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 138).toISOString(),
    status: "abandoned",
    outcome: "sem_resposta",
    responsibleName: "IA (Follow-up)",
    collectedData: {},
    messages: [{ sender: "bot", text: "Olá Brevetto, tudo bem?", time: "5d atrás" }],
    ...({
      funnelStage: "sem_resposta",
      progressPct: 0,
      triageStatus: "analisando",
      botStatus: "parado",
      timeAgo: "5d 18h",
    } as any),
  },
  {
    id: "sdr-sr-7",
    conversationId: "conv-vander-22",
    contactName: "Vander",
    company: "Vander Café e Grãos",
    phone: "(35) 99877-6655",
    currentStep: "Sem Resposta",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 138).toISOString(),
    status: "abandoned",
    outcome: "sem_resposta",
    responsibleName: "IA (Follow-up)",
    collectedData: {},
    messages: [{ sender: "bot", text: "Vander, tem interesse em fechar a embaladora a vácuo?", time: "5d atrás" }],
    ...({
      funnelStage: "sem_resposta",
      progressPct: 0,
      triageStatus: "analisando",
      botStatus: "parado",
      timeAgo: "5d 18h",
    } as any),
  },
  {
    id: "sdr-sr-8",
    conversationId: "conv-apanet-23",
    contactName: "APANET - INDUSTRIA DE ALIMENTOS LTDA",
    company: "Apanet Indústria de Alimentos",
    phone: "(81) 98711-2244",
    currentStep: "Sem Resposta",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 138).toISOString(),
    status: "abandoned",
    outcome: "sem_resposta",
    responsibleName: "IA (Follow-up)",
    collectedData: {
      "NOME COMPLETO": { value: "Apanet Alimentos", status: "filled" },
    },
    messages: [{ sender: "bot", text: "Apanet, enviamos a cotação no seu e-mail.", time: "5d atrás" }],
    ...({
      funnelStage: "sem_resposta",
      progressPct: 50,
      triageStatus: "analisando",
      botStatus: "parado",
      timeAgo: "5d 18h",
    } as any),
  },
  {
    id: "sdr-sr-9",
    conversationId: "conv-dennis-24",
    contactName: "Dennis Lopes",
    company: "Dennis Indústria Gráfica",
    phone: "(11) 98722-4411",
    currentStep: "Sem Resposta",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 138).toISOString(),
    status: "abandoned",
    outcome: "sem_resposta",
    responsibleName: "IA (Follow-up)",
    collectedData: {
      "NOME COMPLETO": { value: "Dennis Lopes", status: "filled" },
    },
    messages: [{ sender: "bot", text: "Dennis, aguardo seu retorno sobre a seladora em L.", time: "5d atrás" }],
    ...({
      funnelStage: "sem_resposta",
      progressPct: 50,
      triageStatus: "analisando",
      botStatus: "parado",
      timeAgo: "5d 18h",
    } as any),
  },
  {
    id: "sdr-sr-10",
    conversationId: "conv-amilton-25",
    contactName: "Amilton",
    company: "Amilton Comércio",
    phone: "(19) 99144-8899",
    currentStep: "Sem Resposta",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 138).toISOString(),
    status: "abandoned",
    outcome: "sem_resposta",
    responsibleName: "IA (Follow-up)",
    collectedData: {
      "NOME COMPLETO": { value: "Amilton", status: "filled" },
    },
    messages: [{ sender: "bot", text: "Olá Amilton!", time: "5d atrás" }],
    ...({
      funnelStage: "sem_resposta",
      progressPct: 10,
      triageStatus: "analisando",
      botStatus: "parado",
      timeAgo: "5d 18h",
    } as any),
  },
  {
    id: "sdr-sr-11",
    conversationId: "conv-manu-26",
    contactName: "Manu Silva",
    company: "Manu Silva Doceria",
    phone: "(21) 98655-3322",
    currentStep: "Sem Resposta",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 138).toISOString(),
    status: "abandoned",
    outcome: "sem_resposta",
    responsibleName: "IA (Follow-up)",
    collectedData: {},
    messages: [{ sender: "bot", text: "Manu, conseguiu ver as seladoras de bancada?", time: "5d atrás" }],
    ...({
      funnelStage: "sem_resposta",
      progressPct: 0,
      triageStatus: "analisando",
      botStatus: "parado",
      timeAgo: "5d 18h",
    } as any),
  },
];
