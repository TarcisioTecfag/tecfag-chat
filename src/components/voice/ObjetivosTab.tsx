// src/components/voice/ObjetivosTab.tsx
// Gestão de Objetivos da Valentina — 100% Low-Code, Radix Select, Tooltips Oficiais, Zero Emojis

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Target, Plus, Edit2, Trash2, Copy, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, ArrowLeft, Save, Sparkles, Zap,
  Info, Star, RotateCcw, UserPlus, CalendarDays, Wallet,
  Award, Flame, HeartHandshake, ShieldCheck, MessageSquare,
  CheckCircle2, AlertCircle, FileText, Layers, Hash, Type,
  ToggleRight as ToggleIcon, Code, HelpCircle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

const TENANT_ID = "valem";

// ─── Mapa de Ícones Lucide disponíveis ────────────────────────────────────────

const ICON_REGISTRY: Record<string, React.ComponentType<{ className?: string }>> = {
  "target": Target,
  "star": Star,
  "rotate-ccw": RotateCcw,
  "user-plus": UserPlus,
  "calendar-days": CalendarDays,
  "wallet": Wallet,
  "award": Award,
  "flame": Flame,
  "heart-handshake": HeartHandshake,
  "shield-check": ShieldCheck,
  "message-square": MessageSquare,
  "sparkles": Sparkles,
};

const AVAILABLE_ICONS = [
  { key: "target", label: "Alvo Geral", Icon: Target },
  { key: "star", label: "Avaliação / NPS", Icon: Star },
  { key: "rotate-ccw", label: "Requalificação", Icon: RotateCcw },
  { key: "user-plus", label: "Prospecção", Icon: UserPlus },
  { key: "calendar-days", label: "Agendamento", Icon: CalendarDays },
  { key: "wallet", label: "Cobrança / Financeiro", Icon: Wallet },
  { key: "award", label: "Fidelização", Icon: Award },
  { key: "flame", label: "Alta Prioridade", Icon: Flame },
  { key: "heart-handshake", label: "Parcerias", Icon: HeartHandshake },
  { key: "shield-check", label: "Validação Técnica", Icon: ShieldCheck },
  { key: "message-square", label: "Pesquisa Rápida", Icon: MessageSquare },
  { key: "sparkles", label: "Campanha Especial", Icon: Sparkles },
];

function RenderObjectiveIcon({ iconKey, className = "w-4 h-4" }: { iconKey?: string; className?: string }) {
  const IconComp = (iconKey && ICON_REGISTRY[iconKey]) ? ICON_REGISTRY[iconKey] : Target;
  return <IconComp className={className} />;
}

// ─── Ações Automáticas ────────────────────────────────────────────────────────

const ACTION_DEFINITIONS: Record<string, { label: string; description: string; tooltip: string; icon: React.ComponentType<{ className?: string }> }> = {
  collect_nps: {
    label: "Coleta NPS & Feedback",
    description: "Extrai nota de 0 a 10 e salva a avaliação estruturada no banco de dados.",
    tooltip: "Analisa a resposta do cliente na ligação e salva a nota e opinião do cliente no banco.",
    icon: Star,
  },
  create_rd_deal: {
    label: "Criar Oportunidade no RD Station",
    description: "Gera deal no funil comercial do CRM quando o cliente demonstrar interesse.",
    tooltip: "Cria automaticamente uma negociação no CRM RD Station com os dados e produtos de interesse.",
    icon: Sparkles,
  },
  send_whatsapp_catalog: {
    label: "Disparar Catálogo no WhatsApp",
    description: "Envia mensagem com o catálogo em PDF via WhatsApp (Baileys) após a ligação.",
    tooltip: "Após o término da chamada, a Valentina envia uma mensagem no WhatsApp com o link do catálogo.",
    icon: MessageSquare,
  },
  schedule_callback: {
    label: "Agendamento Automático de Retorno",
    description: "Detecta quando o cliente pede para ligar mais tarde e agenda na Agenda de Voz.",
    tooltip: "Se o cliente disser 'me ligue amanhã às 15h', a IA entende a data/hora e salva o agendamento.",
    icon: CalendarDays,
  },
  enrich_cnpj: {
    label: "Enriquecimento de Dados por CNPJ",
    description: "Cruza os dados da empresa antes da discagem para personalizar a abordagem.",
    tooltip: "Busca razão social, capital e segmento da empresa para a Valentina citar durante a ligação.",
    icon: ShieldCheck,
  },
};

// ─── Tipos de Dados Amigáveis para Leigos ─────────────────────────────────────

const FIELD_TYPE_OPTIONS = [
  {
    value: "text",
    label: "Texto Aberto / Opinião",
    description: "Para respostas faladas livres, opiniões, motivos ou descrições.",
    Icon: Type,
  },
  {
    value: "number",
    label: "Nota / Número",
    description: "Para pontuações (0 a 10), quantidades, volumes ou valores.",
    Icon: Hash,
  },
  {
    value: "boolean",
    label: "Sim ou Não",
    description: "Para perguntas diretas de confirmação (positivo ou negativo).",
    Icon: ToggleIcon,
  },
] as const;

// Sugestões rápidas de 1 clique para pessoas leigas
const QUICK_FIELD_TEMPLATES = [
  { label: "Nota de Satisfação (0 a 10)", key: "nota_satisfacao", type: "number" as const, required: true },
  { label: "O que o cliente achou (Feedback)", key: "feedback_cliente", type: "text" as const, required: false },
  { label: "Produto de Interesse", key: "produto_interesse", type: "text" as const, required: false },
  { label: "Volume Mensal Estimado", key: "volume_mensal", type: "text" as const, required: false },
  { label: "Decisor de Compras?", key: "e_o_decisor", type: "boolean" as const, required: false },
  { label: "Data Pretendida para Retorno", key: "data_retorno", type: "text" as const, required: false },
];

function slugifyKey(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
}

interface CollectField {
  key: string;
  label: string;
  type: "text" | "number" | "boolean";
  required: boolean;
}

interface VoiceObjective {
  id: string;
  name: string;
  description?: string;
  emoji?: string; // chave de ícone
  prompt: string;
  collectFields: CollectField[];
  actions: string[];
  isActive: boolean;
  isTemplate: boolean;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_OBJECTIVE: Omit<VoiceObjective, "id" | "createdAt" | "updatedAt"> = {
  name: "",
  description: "",
  emoji: "target",
  prompt: "",
  collectFields: [],
  actions: [],
  isActive: true,
  isTemplate: false,
};

// ─── Editor em Tela Cheia (Full View Page) ────────────────────────────────────

function ObjectiveFullEditor({
  initialData,
  onSave,
  onCancel,
}: {
  initialData: Partial<VoiceObjective> | null;
  onSave: (data: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<typeof EMPTY_OBJECTIVE>(
    initialData
      ? { ...EMPTY_OBJECTIVE, ...initialData, emoji: initialData.emoji || "target" }
      : { ...EMPTY_OBJECTIVE }
  );
  const [saving, setSaving] = useState(false);
  const [showAdvancedKeys, setShowAdvancedKeys] = useState(false);

  const updateForm = (key: string, value: any) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const addCustomField = () =>
    updateForm("collectFields", [
      ...form.collectFields,
      { key: `campo_${form.collectFields.length + 1}`, label: "", type: "text", required: false },
    ]);

  const addTemplateField = (tpl: typeof QUICK_FIELD_TEMPLATES[number]) => {
    // Evita duplicatas
    const alreadyExists = form.collectFields.some((f) => f.key === tpl.key || f.label === tpl.label);
    if (alreadyExists) return;

    updateForm("collectFields", [
      ...form.collectFields,
      { key: tpl.key, label: tpl.label, type: tpl.type, required: tpl.required },
    ]);
  };

  const updateField = (idx: number, key: string, value: any) => {
    updateForm(
      "collectFields",
      form.collectFields.map((f, i) => {
        if (i !== idx) return f;
        const updated = { ...f, [key]: value };
        // Se alterou o label e não está em modo manual de chave, gera a chave automaticamente
        if (key === "label" && !showAdvancedKeys) {
          const autoKey = slugifyKey(value);
          if (autoKey) updated.key = autoKey;
        }
        return updated;
      })
    );
  };

  const removeField = (idx: number) =>
    updateForm("collectFields", form.collectFields.filter((_, i) => i !== idx));

  const toggleAction = (actionKey: string) =>
    updateForm(
      "actions",
      form.actions.includes(actionKey)
        ? form.actions.filter((a) => a !== actionKey)
        : [...form.actions, actionKey]
    );

  const handleSave = async () => {
    if (!form.name.trim()) {
      alert("Por favor, informe o nome do objetivo.");
      return;
    }
    if (!form.prompt.trim()) {
      alert("O prompt com o roteiro da chamada é obrigatório.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  const isEditing = Boolean(initialData?.id);

  return (
    <TooltipProvider delayDuration={200}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col h-full overflow-y-auto space-y-6 pr-1"
      >
        {/* ── Top Bar de Navegação & Ações ──────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border bg-card/70 p-4 sm:p-5 rounded-2xl border shadow-soft">
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onCancel}
                  className="flex items-center justify-center w-9 h-9 rounded-xl border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Voltar para a lista de objetivos</TooltipContent>
            </Tooltip>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                  <RenderObjectiveIcon iconKey={form.emoji} className="w-4 h-4" />
                </span>
                <h2 className="text-base font-extrabold text-foreground tracking-tight">
                  {isEditing ? `Editar: ${form.name || "Objetivo"}` : "Criar Novo Objetivo da Valentina"}
                </h2>
                {form.isTemplate && (
                  <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[11px] font-bold border border-border">
                    Template Oficial
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure o roteiro de conversa, dados que a IA irá coletar e automações pós-ligação.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50 transition shadow-soft cursor-pointer"
            >
              {saving ? (
                <>Salvando...</>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  Salvar Objetivo
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Grid Principal de 2 Colunas ───────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* ── Coluna Esquerda: Identidade, Roteiro e Automações (7 Cols) ──── */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Card 1: Identidade */}
            <div className="bg-card border border-border rounded-2xl p-5 shadow-soft space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary border-b border-border pb-3">
                <Layers className="w-4 h-4" /> 1. Identidade e Apresentação
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Ícone da Missão
                  </label>
                  <span className="text-[11px] text-muted-foreground">Escolha um ícone temático</span>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {AVAILABLE_ICONS.map(({ key, label, Icon }) => {
                    const isSelected = form.emoji === key;
                    return (
                      <Tooltip key={key}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => updateForm("emoji", key)}
                            className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs transition cursor-pointer ${
                              isSelected
                                ? "border-primary bg-primary/10 text-primary shadow-sm ring-1 ring-primary/40 font-bold"
                                : "border-border bg-background hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <Icon className="w-4 h-4 mb-1" />
                            <span className="text-[10px] truncate max-w-full text-center">{label.split(" ")[0]}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{label}</TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Nome do Objetivo *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => updateForm("name", e.target.value)}
                    placeholder="Ex: Valentina NPS Pós-Venda"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-xs font-semibold text-foreground placeholder:text-muted-foreground transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Descrição (Para que serve este objetivo?)
                  </label>
                  <input
                    type="text"
                    value={form.description ?? ""}
                    onChange={(e) => updateForm("description", e.target.value)}
                    placeholder="Ex: Ligação para medir satisfação e identificar clientes promotores..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-xs text-foreground placeholder:text-muted-foreground transition"
                  />
                </div>
              </div>
            </div>

            {/* Card 2: Prompt / Roteiro da Chamada */}
            <div className="bg-card border border-border rounded-2xl p-5 shadow-soft space-y-3">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                  <FileText className="w-4 h-4" /> 2. Roteiro e Comportamento da Valentina
                </div>
                <span className="text-[11px] text-muted-foreground font-mono">
                  {form.prompt.length} caracteres
                </span>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Escreva exatamente o que a Valentina deve falar e como conduzir a ligação. A inteligência seguirá estas instruções à risca.
              </p>

              <textarea
                value={form.prompt}
                onChange={(e) => updateForm("prompt", e.target.value)}
                placeholder="Você é a Valentina, consultora da Valem Válvulas...&#10;&#10;ROTEIRO:&#10;1. Apresente-se cordialmente...&#10;2. Pergunte sobre a experiência de compra...&#10;3. Solicite uma nota de 0 a 10...&#10;4. Agradeça e encerre a ligação."
                rows={11}
                className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-xs font-mono text-foreground leading-relaxed resize-y placeholder:text-muted-foreground/60 transition"
              />

              <div className="p-3.5 bg-muted/40 rounded-xl border border-border text-[11px] text-muted-foreground space-y-1">
                <div className="font-bold text-foreground flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-primary" /> Boas práticas de conversação por voz:
                </div>
                <div>• Mantenha as falas diretas e em português natural (frases de 1 a 2 linhas).</div>
                <div>• Não use markdown, listas com traços ou asteriscos no texto do prompt.</div>
              </div>
            </div>

            {/* Card 3: Ações e Gatilhos Automáticos */}
            <div className="bg-card border border-border rounded-2xl p-5 shadow-soft space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary border-b border-border pb-3">
                <Zap className="w-4 h-4" /> 3. Ações e Automações Pós-Ligação
              </div>

              <p className="text-xs text-muted-foreground">
                Selecione o que o sistema deve fazer automaticamente quando a ligação for concluída.
              </p>

              <div className="grid grid-cols-1 gap-2.5">
                {Object.entries(ACTION_DEFINITIONS).map(([key, meta]) => {
                  const isSelected = form.actions.includes(key);
                  const ActionIcon = meta.icon;
                  return (
                    <Tooltip key={key}>
                      <TooltipTrigger asChild>
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleAction(key)}
                          className={`flex items-start gap-3.5 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                            isSelected
                              ? "border-primary/40 bg-primary/5 shadow-sm"
                              : "border-border bg-background hover:bg-muted/40"
                          }`}
                        >
                          <div className={`p-2 rounded-xl border shrink-0 transition-colors ${
                            isSelected
                              ? "bg-primary text-primary-foreground border-primary shadow-sm"
                              : "bg-muted text-muted-foreground border-border"
                          }`}>
                            <ActionIcon className="w-4 h-4" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-xs font-bold ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
                                {meta.label}
                              </span>
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition ${
                                isSelected
                                  ? "bg-primary/15 text-primary border-primary/30"
                                  : "bg-muted text-muted-foreground border-border"
                              }`}>
                                {isSelected ? "ATIVADO" : "DESATIVADO"}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5 leading-normal">
                              {meta.description}
                            </p>
                          </div>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{meta.tooltip}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>

          </div>

          {/* ── Coluna Direita: Campos a Coletar Low-Code & Resumo (5 Cols) ─── */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Card 4: Campos a Coletar */}
            <div className="bg-card border border-border rounded-2xl p-5 shadow-soft space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                    <Target className="w-4 h-4" /> 4. Informações que a Valentina Coletará
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Defina quais dados a IA deve extrair do cliente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addCustomField}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold transition-colors cursor-pointer border border-primary/20 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar
                </button>
              </div>

              {/* Sugestões de 1 Clique */}
              <div className="space-y-1.5 bg-muted/20 p-3 rounded-xl border border-border/70">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-primary" /> Sugestões Rápidas (Clique para adicionar):
                </span>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {QUICK_FIELD_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.key}
                      type="button"
                      onClick={() => addTemplateField(tpl)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-background border border-border hover:border-primary/50 hover:bg-primary/5 text-foreground transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                    >
                      <Plus className="w-3 h-3 text-primary" /> {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              {form.collectFields.length === 0 ? (
                <div className="border border-dashed border-border rounded-2xl p-6 text-center text-muted-foreground">
                  <Target className="w-8 h-8 mx-auto opacity-20 mb-2" />
                  <p className="text-xs font-bold text-foreground">Nenhuma informação estruturada ainda</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Escolha uma sugestão rápida acima ou clique em "+ Adicionar" para criar uma pergunta personalizada.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {form.collectFields.map((field, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 bg-background border border-border rounded-xl space-y-3 shadow-sm transition hover:border-primary/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-primary flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Informação #{idx + 1}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => removeField(idx)}
                              className="text-muted-foreground hover:text-rose-500 transition-colors p-1 rounded-lg hover:bg-rose-500/10 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Remover esta informação</TooltipContent>
                        </Tooltip>
                      </div>

                      {/* Nome amigável do campo */}
                      <div>
                        <label className="block text-[11px] font-semibold text-foreground mb-1">
                          Pergunta / Dado a Coletar:
                        </label>
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateField(idx, "label", e.target.value)}
                          placeholder="Ex: Nota de 0 a 10, Opinião do cliente, etc."
                          className="w-full px-3 py-2 rounded-lg border border-border bg-card text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>

                      {/* Tipo de resposta com Radix UI Select */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
                        <div>
                          <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                            Tipo de Resposta:
                          </label>
                          <Select
                            value={field.type}
                            onValueChange={(val) => updateField(idx, "type", val)}
                          >
                            <SelectTrigger className="h-9 text-xs">
                              <SelectValue placeholder="Selecione o tipo..." />
                            </SelectTrigger>
                            <SelectContent>
                              {FIELD_TYPE_OPTIONS.map((opt) => {
                                const TypeIcon = opt.Icon;
                                return (
                                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                    <div className="flex items-center gap-2">
                                      <TypeIcon className="w-3.5 h-3.5 text-primary" />
                                      <span>{opt.label}</span>
                                    </div>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex items-center justify-end pt-4 sm:pt-4">
                          <label className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none">
                            <Checkbox
                              checked={field.required}
                              onCheckedChange={(checked) => updateField(idx, "required", !!checked)}
                            />
                            <span className="text-xs font-semibold">Resposta Obrigatória</span>
                          </label>
                        </div>
                      </div>

                      {/* Modo Avançado para Desenvolvedores (Chave JSON) */}
                      {showAdvancedKeys && (
                        <div className="pt-2 border-t border-border/40">
                          <label className="block text-[10px] font-mono text-muted-foreground uppercase tracking-wide mb-1">
                            Chave Técnica no Banco (JSON key):
                          </label>
                          <input
                            type="text"
                            value={field.key}
                            onChange={(e) => updateField(idx, "key", e.target.value)}
                            className="w-full px-2.5 py-1 rounded-md border border-border bg-muted/30 text-[11px] font-mono text-muted-foreground"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {form.collectFields.length > 0 && (
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedKeys((v) => !v)}
                    className="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Code className="w-3 h-3" />
                    {showAdvancedKeys ? "Ocultar chaves técnicas JSON" : "Ver chaves técnicas JSON (Avançado)"}
                  </button>
                </div>
              )}
            </div>

            {/* Card 5: Resumo ao Vivo */}
            <div className="bg-muted/30 border border-border rounded-2xl p-5 space-y-3 shadow-soft">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="w-4 h-4 text-primary" /> Resumo da Missão da Valentina
              </div>

              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                  <span>Objetivo Selecionado:</span>
                  <span className="font-bold text-foreground flex items-center gap-1.5">
                    <RenderObjectiveIcon iconKey={form.emoji} className="w-3.5 h-3.5 text-primary" />
                    {form.name || "Sem Nome Definido"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                  <span>Automações Ativadas:</span>
                  <span className="font-bold text-foreground">{form.actions.length} ação(ões)</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                  <span>Informações Coletadas:</span>
                  <span className="font-bold text-foreground">{form.collectFields.length} campo(s)</span>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground/80 leading-relaxed pt-1">
                Ao selecionar este objetivo em uma campanha ou ligação avulsa, a Valentina seguirá este roteiro e salvará as respostas automaticamente.
              </p>
            </div>

          </div>

        </div>

        {/* ── Footer Fixo de Ações ──────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50 transition shadow-soft cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {saving ? "Salvando Alterações..." : "Salvar e Ativar Objetivo"}
          </button>
        </div>
      </motion.div>
    </TooltipProvider>
  );
}

// ─── Card Individual do Objetivo na Listagem ──────────────────────────────────

function ObjectiveCard({
  obj,
  onEdit,
  onDuplicate,
  onToggle,
  onDelete,
}: {
  obj: VoiceObjective;
  onEdit: () => void;
  onDuplicate: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border bg-card transition-all ${
        obj.isActive ? "border-border shadow-soft hover:border-primary/30" : "border-border/50 opacity-60 bg-muted/10"
      }`}
    >
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5 flex-1 min-w-0">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <RenderObjectiveIcon iconKey={obj.emoji} className="w-5 h-5" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-foreground text-sm tracking-tight">{obj.name}</h3>
                {obj.isTemplate && (
                  <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] font-bold border border-border">
                    Template Oficial
                  </span>
                )}
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                    obj.isActive
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  {obj.isActive ? "Ativo" : "Inativo"}
                </span>
              </div>

              {obj.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                  {obj.description}
                </p>
              )}

              {/* Badges de Automações com Ícones */}
              {obj.actions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {obj.actions.map((actionKey) => {
                    const meta = ACTION_DEFINITIONS[actionKey];
                    const ActionIcon = meta?.icon || Zap;
                    return (
                      <span
                        key={actionKey}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-muted/50 text-foreground border border-border"
                      >
                        <ActionIcon className="w-3 h-3 text-primary" />
                        {meta?.label || actionKey}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Botões de Ação do Card com Tooltips */}
          <div className="flex items-center gap-1 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{expanded ? "Ocultar Roteiro" : "Visualizar Roteiro da IA"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onEdit}
                  className="p-2 rounded-xl hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Editar Objetivo em Tela Cheia</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onDuplicate}
                  className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Duplicar como Novo Objetivo</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggle}
                  className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                >
                  {obj.isActive ? (
                    <ToggleRight className="w-5 h-5 text-primary" />
                  ) : (
                    <ToggleLeft className="w-5 h-5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{obj.isActive ? "Desativar Objetivo" : "Ativar Objetivo"}</TooltipContent>
            </Tooltip>

            {!obj.isTemplate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onDelete}
                    className="p-2 rounded-xl hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Excluir Objetivo</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Tags de Informações Coletadas */}
        {obj.collectFields && obj.collectFields.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">
              Coleta Estruturada:
            </span>
            {obj.collectFields.map((f) => (
              <span
                key={f.key}
                className="px-2.5 py-0.5 rounded-md bg-background border border-border text-foreground text-[11px] font-medium"
              >
                {f.label || f.key}{f.required ? " *" : ""}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Visualizador do Roteiro (Prompt) */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-border bg-muted/20 px-5 py-4 rounded-b-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Roteiro e Diretrizes de Conversa
              </span>
              <span className="text-[11px] text-muted-foreground font-mono">
                {obj.prompt.length} caracteres
              </span>
            </div>
            <pre className="text-xs text-foreground bg-background border border-border rounded-xl p-3.5 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
              {obj.prompt}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Componente Principal da Aba de Objetivos ─────────────────────────────────

export function ObjetivosTab() {
  const [objectives, setObjectives] = useState<VoiceObjective[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingObjective, setEditingObjective] = useState<Partial<VoiceObjective> | null | undefined>(undefined);
  // undefined = List View | null = Criar Novo | VoiceObjective = Editando

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/voice-objectives?tenantId=${TENANT_ID}`);
      const data = await res.json();
      setObjectives(data.objectives ?? []);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async (formData: typeof EMPTY_OBJECTIVE) => {
    if ((editingObjective as VoiceObjective)?.id) {
      await fetch("/api/voice-objectives", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: TENANT_ID,
          id: (editingObjective as VoiceObjective).id,
          ...formData,
        }),
      });
    } else {
      await fetch("/api/voice-objectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: TENANT_ID, ...formData }),
      });
    }
    setEditingObjective(undefined);
    load();
  };

  const handleToggle = async (obj: VoiceObjective) => {
    await fetch("/api/voice-objectives", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: TENANT_ID, id: obj.id, isActive: !obj.isActive }),
    });
    load();
  };

  const handleDelete = async (obj: VoiceObjective) => {
    if (!confirm(`Deseja realmente remover o objetivo "${obj.name}"?`)) return;
    await fetch(`/api/voice-objectives?tenantId=${TENANT_ID}&id=${obj.id}`, { method: "DELETE" });
    load();
  };

  const handleDuplicate = async (obj: VoiceObjective) => {
    await fetch("/api/voice-objectives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: TENANT_ID,
        name: `${obj.name} (Cópia)`,
        description: obj.description,
        emoji: obj.emoji || "target",
        prompt: obj.prompt,
        collectFields: obj.collectFields,
        actions: obj.actions,
        isActive: true,
        isTemplate: false,
      }),
    });
    load();
  };

  const templates = objectives.filter((o) => o.isTemplate);
  const custom = objectives.filter((o) => !o.isTemplate);

  // Se estiver em modo de edição/criação, renderiza a Página Inteira de Edição
  if (editingObjective !== undefined) {
    return (
      <ObjectiveFullEditor
        initialData={editingObjective}
        onSave={handleSave}
        onCancel={() => setEditingObjective(undefined)}
      />
    );
  }

  // Visualização Padrão: Listagem
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-6 h-full overflow-y-auto pr-1">
        {/* Header com Resumo e Ação de Novo Objetivo */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card border border-border rounded-2xl p-5 shadow-soft">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Target className="w-4 h-4" />
              </span>
              <h2 className="text-base font-extrabold text-foreground">
                Objetivos da Valentina
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Configure missões com roteiros falados, campos que a IA deve coletar e integrações pós-ligação.
            </p>
          </div>

          <button
            onClick={() => setEditingObjective(null)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-all shadow-soft cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" /> Criar Novo Objetivo
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center flex-1 text-muted-foreground text-xs py-12">
            Carregando objetivos da Valentina...
          </div>
        ) : (
          <div className="space-y-6 pb-6">
            {/* Templates Oficiais */}
            {templates.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-primary" /> Templates Pré-configurados ({templates.length})
                  </h3>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {templates.map((obj) => (
                    <ObjectiveCard
                      key={obj.id}
                      obj={obj}
                      onEdit={() => setEditingObjective(obj)}
                      onDuplicate={() => handleDuplicate(obj)}
                      onToggle={() => handleToggle(obj)}
                      onDelete={() => handleDelete(obj)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Objetivos Customizados da Empresa */}
            {custom.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-primary" /> Objetivos Personalizados ({custom.length})
                  </h3>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {custom.map((obj) => (
                    <ObjectiveCard
                      key={obj.id}
                      obj={obj}
                      onEdit={() => setEditingObjective(obj)}
                      onDuplicate={() => handleDuplicate(obj)}
                      onToggle={() => handleToggle(obj)}
                      onDelete={() => handleDelete(obj)}
                    />
                  ))}
                </div>
              </section>
            )}

            {objectives.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl bg-muted/10">
                <Target className="w-12 h-12 opacity-20 mb-3" />
                <p className="text-sm font-semibold text-foreground">Nenhum objetivo cadastrado</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Clique no botão acima para criar seu primeiro objetivo ou template.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
