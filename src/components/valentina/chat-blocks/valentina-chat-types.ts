// ══════════════════════════════════════════════════════════════════════════════
// 💬 VALENTINA CHAT TYPES — Tipos estritos para blocos ricos, conversas e threads
// ══════════════════════════════════════════════════════════════════════════════

export type ChartPoint = { label: string; value: number; value2?: number };

export type ChartBlock = {
  type: "chart";
  chart: "bar" | "line" | "pie";
  title: string;
  subtitle?: string;
  unit?: string;
  data: ChartPoint[];
};

export type InsightBlock = {
  type: "insight";
  title: string;
  items: {
    label: string;
    value: string;
    delta?: string;
    trend?: "up" | "down" | "flat";
    hint?: string;
  }[];
  recommendation?: string;
};

export type ReportBlock = {
  type: "report";
  title: string;
  columns: string[];
  rows: string[][];
  footnote?: string;
};

export type ExcerptBlock = {
  type: "excerpt";
  title: string;
  conversations: {
    lead: string;
    channel: string;
    when: string;
    sentiment: "positivo" | "neutro" | "negativo";
    lines: { from: "lead" | "agente"; text: string }[];
  }[];
};

export type TextBlock = { type: "text"; text: string };

export type LeadCardBlock = {
  type: "lead_card";
  data: {
    name?: string;
    company?: string;
    score?: number | string;
    phone?: string;
    dealId?: string;
  };
};

export type SlaAlertBlock = {
  type: "sla_alert";
  data: {
    clientName?: string;
    waitMinutes?: number | string;
    description?: string;
    lastMessage?: string;
  };
};

export type ValentinaMessageBlock =
  | TextBlock
  | ChartBlock
  | InsightBlock
  | ReportBlock
  | ExcerptBlock
  | LeadCardBlock
  | SlaAlertBlock;

export interface AttachedFileInfo {
  name: string;
  mimeType: string;
}

export interface AttachedImageInfo {
  dataUrl: string;
  name: string;
}

export interface ValentinaChatMessage {
  id: string;
  sender: "operator" | "valentina";
  content: string;
  timestamp: string;
  blocks?: ValentinaMessageBlock[];
  attachedFileInfo?: AttachedFileInfo;
  attachedImageInfo?: AttachedImageInfo;
}

export interface ValentinaThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ValentinaChatMessage[];
  folderId?: string | null;
}

export interface ValentinaFolder {
  id: string;
  name: string;
}
