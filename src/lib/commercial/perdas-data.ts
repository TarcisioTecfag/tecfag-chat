export type PerdasPeriodKey = "mes_atual" | "mes_passado" | "geral_historico";

export interface PerdasSubReason {
  label: string;
  count: number;
}

export interface PerdasCategory {
  key: string;
  name: string;
  iconName: "users" | "zap" | "layers" | "dollar" | "clock";
  colorHex: string; // Ex: #3b82f6 (azul), #f59e0b (âmbar), etc.
  colorClass: string; // Ex: bg-blue-500, text-blue-400
  badgeBg: string; // Ex: border-blue-500/40 bg-blue-950/40 text-blue-300
  count: number;
  percent: number;
  subReasons: PerdasSubReason[];
}

export interface PerdasPeriodData {
  key: PerdasPeriodKey;
  title: string;
  totalCount: number;
  subtitlePeriod: string;
  subtitleMetric: string;
  headerFilterLabel: string;
  categories: PerdasCategory[];
}

// ─── DADOS DO MÊS ATUAL (FOTO 1 - 55 PERDAS) ───
export const BASELINE_PERDAS_MES_ATUAL: PerdasPeriodData = {
  key: "mes_atual",
  title: "MÊS ATUAL",
  totalCount: 55,
  subtitlePeriod: "outubro de 2026",
  subtitleMetric: "-99% vs mês anterior",
  headerFilterLabel: "outubro de 2026",
  categories: [
    {
      key: "comportamento",
      name: "Comportamento / Cliente",
      iconName: "users",
      colorHex: "#3b82f6",
      colorClass: "bg-blue-500",
      badgeBg: "border-blue-500/40 bg-blue-950/40 text-blue-300",
      count: 40,
      percent: 72.7,
      subReasons: [
        { label: "Cliente não atende/responde ao contados", count: 26 },
        { label: "Cliente desistiu do investimento", count: 9 },
        { label: "Condições de pagamento incompatíveis ao esperado pelo client", count: 2 },
        { label: "Mudança estratégica da empresa do cliente", count: 2 },
        { label: "Problemas com assistência técnica", count: 1 },
      ],
    },
    {
      key: "concorrencia",
      name: "Concorrência / Solução",
      iconName: "zap",
      colorHex: "#f59e0b",
      colorClass: "bg-amber-500",
      badgeBg: "border-amber-500/40 bg-amber-950/40 text-amber-300",
      count: 6,
      percent: 10.9,
      subReasons: [
        { label: "Solução não atende totalmente a necessidade do cliente", count: 5 },
        { label: "Concorrente com melhor custo benefício", count: 1 },
      ],
    },
    {
      key: "outros",
      name: "Outros Motivos",
      iconName: "layers",
      colorHex: "#06b6d4",
      colorClass: "bg-cyan-500",
      badgeBg: "border-cyan-500/40 bg-cyan-950/40 text-cyan-300",
      count: 4,
      percent: 7.3,
      subReasons: [
        { label: "Oportunidade em duplicidade/outra oportunidade em andamento", count: 3 },
        { label: "Negociação parada há muito tempo", count: 1 },
      ],
    },
    {
      key: "preco",
      name: "Preço / Financeiro",
      iconName: "dollar",
      colorHex: "#ef4444",
      colorClass: "bg-red-500",
      badgeBg: "border-red-500/40 bg-red-950/40 text-red-300",
      count: 3,
      percent: 5.5,
      subReasons: [
        { label: "Valor do investimento acima do esperado pelo cliente", count: 3 },
      ],
    },
    {
      key: "processo",
      name: "Processo / Prazos",
      iconName: "clock",
      colorHex: "#a855f7",
      colorClass: "bg-purple-500",
      badgeBg: "border-purple-500/40 bg-purple-950/40 text-purple-300",
      count: 2,
      percent: 3.6,
      subReasons: [
        { label: "Prazo de entrega incompatível", count: 2 },
      ],
    },
  ],
};

// ─── DADOS DO MÊS PASSADO (FOTO 2 - 6183 PERDAS) ───
export const BASELINE_PERDAS_MES_PASSADO: PerdasPeriodData = {
  key: "mes_passado",
  title: "MÊS PASSADO",
  totalCount: 6183,
  subtitlePeriod: "setembro de 2026",
  subtitleMetric: "6183 perdas fechadas",
  headerFilterLabel: "setembro de 2026",
  categories: [
    {
      key: "outros",
      name: "Outros Motivos",
      iconName: "layers",
      colorHex: "#06b6d4",
      colorClass: "bg-cyan-500",
      badgeBg: "border-cyan-500/40 bg-cyan-950/40 text-cyan-300",
      count: 5540,
      percent: 89.6,
      subReasons: [
        { label: "Negociação parada sem interação", count: 5287 },
        { label: "Outros Motivos", count: 192 },
        { label: "Oportunidade em duplicidade/outra oportunidade em andamento", count: 47 },
        { label: "Não gostou do atendimento", count: 6 },
        { label: "Negociação parada há muito tempo", count: 5 },
        { label: "Contato Inexistente", count: 1 },
        { label: "Crédito não aprovado por bancos externos", count: 1 },
        { label: "Fornecedor", count: 1 },
      ],
    },
    {
      key: "comportamento",
      name: "Comportamento / Cliente",
      iconName: "users",
      colorHex: "#3b82f6",
      colorClass: "bg-blue-500",
      badgeBg: "border-blue-500/40 bg-blue-950/40 text-blue-300",
      count: 481,
      percent: 7.8,
      subReasons: [
        { label: "Cliente não atende/responde ao contados", count: 304 },
        { label: "Cliente desistiu do investimento", count: 106 },
        { label: "Lead desqualificado - Cliente fora do perfil", count: 41 },
        { label: "Cliente migrou para compra direta no site tecfag", count: 11 },
        { label: "Condições de pagamento incompatíveis ao esperado pelo client", count: 9 },
        { label: "Mudança estratégica da empresa do cliente", count: 4 },
        { label: "Layout estrutura do cliente incompatível com o apresentado", count: 3 },
        { label: "Cliente não cumpriu com acordo de pagamento firmado", count: 2 },
        { label: "Problemas com assistência técnica", count: 1 },
      ],
    },
    {
      key: "concorrencia",
      name: "Concorrência / Solução",
      iconName: "zap",
      colorHex: "#f59e0b",
      colorClass: "bg-amber-500",
      badgeBg: "border-amber-500/40 bg-amber-950/40 text-amber-300",
      count: 102,
      percent: 1.6,
      subReasons: [
        { label: "Concorrente com melhor custo benefício", count: 50 },
        { label: "Solução não atende totalmente a necessidade do cliente", count: 44 },
        { label: "Não gostou do produto/solução apresentada", count: 8 },
      ],
    },
    {
      key: "preco",
      name: "Preço / Financeiro",
      iconName: "dollar",
      colorHex: "#ef4444",
      colorClass: "bg-red-500",
      badgeBg: "border-red-500/40 bg-red-950/40 text-red-300",
      count: 54,
      percent: 0.9,
      subReasons: [
        { label: "Valor do investimento acima do esperado pelo cliente", count: 50 },
        { label: "Crédito não aprovado - financeiro tecfag", count: 4 },
      ],
    },
    {
      key: "processo",
      name: "Processo / Prazos",
      iconName: "clock",
      colorHex: "#a855f7",
      colorClass: "bg-purple-500",
      badgeBg: "border-purple-500/40 bg-purple-950/40 text-purple-300",
      count: 6,
      percent: 0.1,
      subReasons: [
        { label: "Prazo de entrega incompatível", count: 5 },
        { label: "Demora na elaboração da proposta", count: 1 },
      ],
    },
  ],
};

// ─── DADOS GERAIS HISTÓRICOS (FOTO 3 - 8599 PERDAS) ───
export const BASELINE_PERDAS_GERAL_HISTORICO: PerdasPeriodData = {
  key: "geral_historico",
  title: "GERAL HISTÓRICO",
  totalCount: 8599,
  subtitlePeriod: "Média: 573.3/mês",
  subtitleMetric: "Desde ago/2024 (15 meses)",
  headerFilterLabel: "Média: 573.3/mês",
  categories: [
    {
      key: "outros",
      name: "Outros Motivos",
      iconName: "layers",
      colorHex: "#06b6d4",
      colorClass: "bg-cyan-500",
      badgeBg: "border-cyan-500/40 bg-cyan-950/40 text-cyan-300",
      count: 6520,
      percent: 75.8,
      subReasons: [
        { label: "Negociação parada sem interação", count: 5287 },
        { label: "Outros Motivos", count: 1065 },
        { label: "Oportunidade em duplicidade/outra oportunidade em andamento", count: 137 },
        { label: "Não gostou do atendimento", count: 9 },
        { label: "Crédito não aprovado por bancos externos", count: 7 },
        { label: "Negociação parada há muito tempo", count: 6 },
        { label: "Fornecedor", count: 4 },
        { label: "Problemas com frete", count: 3 },
        { label: "Contato Inexistente", count: 2 },
      ],
    },
    {
      key: "comportamento",
      name: "Comportamento / Cliente",
      iconName: "users",
      colorHex: "#3b82f6",
      colorClass: "bg-blue-500",
      badgeBg: "border-blue-500/40 bg-blue-950/40 text-blue-300",
      count: 1546,
      percent: 18.0,
      subReasons: [
        { label: "Cliente não atende/responde ao contados", count: 942 },
        { label: "Cliente desistiu do investimento", count: 353 },
        { label: "Lead desqualificado - Cliente fora do perfil", count: 137 },
        { label: "Cliente migrou para compra direta no site tecfag", count: 61 },
        { label: "Condições de pagamento incompatíveis ao esperado pelo client", count: 21 },
        { label: "Mudança estratégica da empresa do cliente", count: 16 },
        { label: "Layout estrutura do cliente incompatível com o apresentado", count: 10 },
        { label: "Problemas com assistência técnica", count: 4 },
        { label: "Cliente não cumpriu com acordo de pagamento firmado", count: 2 },
      ],
    },
    {
      key: "concorrencia",
      name: "Concorrência / Solução",
      iconName: "zap",
      colorHex: "#f59e0b",
      colorClass: "bg-amber-500",
      badgeBg: "border-amber-500/40 bg-amber-950/40 text-amber-300",
      count: 343,
      percent: 4.0,
      subReasons: [
        { label: "Solução não atende totalmente a necessidade do cliente", count: 174 },
        { label: "Concorrente com melhor custo benefício", count: 156 },
        { label: "Não gostou do produto/solução apresentada", count: 13 },
      ],
    },
    {
      key: "preco",
      name: "Preço / Financeiro",
      iconName: "dollar",
      colorHex: "#ef4444",
      colorClass: "bg-red-500",
      badgeBg: "border-red-500/40 bg-red-950/40 text-red-300",
      count: 150,
      percent: 1.7,
      subReasons: [
        { label: "Valor do investimento acima do esperado pelo cliente", count: 134 },
        { label: "Crédito não aprovado - financeiro tecfag", count: 16 },
      ],
    },
    {
      key: "processo",
      name: "Processo / Prazos",
      iconName: "clock",
      colorHex: "#a855f7",
      colorClass: "bg-purple-500",
      badgeBg: "border-purple-500/40 bg-purple-950/40 text-purple-300",
      count: 40,
      percent: 0.5,
      subReasons: [
        { label: "Prazo de entrega incompatível", count: 36 },
        { label: "Demora na elaboração da proposta", count: 4 },
      ],
    },
  ],
};

export const ALL_PERDAS_PERIODS: Record<PerdasPeriodKey, PerdasPeriodData> = {
  mes_atual: BASELINE_PERDAS_MES_ATUAL,
  mes_passado: BASELINE_PERDAS_MES_PASSADO,
  geral_historico: BASELINE_PERDAS_GERAL_HISTORICO,
};
