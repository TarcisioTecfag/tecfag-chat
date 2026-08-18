// src/components/voice/ObjetivosTab.tsx
// Gestão visual e profissional de Objetivos da Valentina — 100% ícones lucide-react, zero emojis, Full View Editor

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Target, Plus, Edit2, Trash2, Copy, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, ArrowLeft, Save, Sparkles, Zap,
  Info, Star, RotateCcw, UserPlus, CalendarDays, Wallet,
  Award, Flame, HeartHandshake, ShieldCheck, MessageSquare,
  CheckCircle2, AlertCircle, FileText, Layers,
} from "lucide-react";

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
  { key: "shield-check", label: "Auditoria / Validação", Icon: ShieldCheck },
  { key: "message-square", label: "Pesquisa Rápida", Icon: MessageSquare },
  { key: "sparkles", label: "Especial", Icon: Sparkles },
];

function RenderObjectiveIcon({ iconKey, className = "w-4 h-4" }: { iconKey?: string; className?: string }) {
  const IconComp = (iconKey && ICON_REGISTRY[iconKey]) ? ICON_REGISTRY[iconKey] : Target;
  return <IconComp className={className} />;
}

// ─── Ações Automáticas Suportadas ─────────────────────────────────────────────

const ACTION_DEFINITIONS: Record<string, { label: string; description: string; icon: React.ComponentType<{ className?: string }> }> = {
  collect_nps: {
    label: "Coleta NPS & Feedback",
    description: "Extrai nota de 0 a 10 e salva a avaliação estruturada no banco de dados.",
    icon: Star,
  },
  create_rd_deal: {
    label: "Criar Oportunidade no CRM",
    description: "Gera deal no funil comercial do RD Station quando o lead qualificar interesse.",
    icon: Sparkles,
  },
  send_whatsapp_catalog: {
    label: "Disparar Catálogo no WhatsApp",
    description: "Envia link do catálogo ou proposta via Baileys automaticamente ao término da ligação.",
    icon: MessageSquare,
  },
  schedule_callback: {
    label: "Agendamento Inteligente",
    description: "Detecta pedidos de retorno durante a chamada e cria o card na Agenda de Voz.",
    icon: CalendarDays,
  },
  enrich_cnpj: {
    label: "Enriquecimento por CNPJ",
    description: "Cruza os dados da empresa antes da discagem para personalizar a abordagem da IA.",
    icon: ShieldCheck,
  },
};

const FIELD_TYPES = [
  { value: "text", label: "Texto / Resumo" },
  { value: "number", label: "Número / Nota" },
  { value: "boolean", label: "Sim / Não (Booleano)" },
] as const;

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
  emoji?: string; // Usado como chave de ícone
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
    initialData ? { ...EMPTY_OBJECTIVE, ...initialData, emoji: initialData.emoji || "target" } : { ...EMPTY_OBJECTIVE }
  );
  const [saving, setSaving] = useState(false);

  const updateForm = (key: string, value: any) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const addField = () =>
    updateForm("collectFields", [
      ...form.collectFields,
      { key: "", label: "", type: "text", required: false },
    ]);

  const updateField = (idx: number, key: string, value: any) =>
    updateForm(
      "collectFields",
      form.collectFields.map((f, i) => (i === idx ? { ...f, [key]: value } : f))
    );

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
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col h-full overflow-y-auto space-y-6 pr-1"
    >
      {/* ── Top Bar de Navegação & Ações ────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border bg-card/60 p-4 rounded-2xl border">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="flex items-center justify-center w-9 h-9 rounded-xl border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Voltar para a listagem"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                <RenderObjectiveIcon iconKey={form.emoji} className="w-4 h-4" />
              </span>
              <h2 className="text-base font-extrabold text-foreground">
                {isEditing ? `Editar: ${form.name || "Objetivo"}` : "Novo Objetivo da Valentina"}
              </h2>
              {form.isTemplate && (
                <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[11px] font-bold border border-border">
                  Template Oficial
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Personalize o roteiro, a inteligência e os dados que a IA coletará na chamada.
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

      {/* ── Grid Principal de 2 Colunas ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* ── Coluna Esquerda: Identidade, Prompt e Ações (7 Cols) ───────────── */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Card 1: Identidade do Objetivo */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-soft space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary border-b border-border pb-3">
              <Layers className="w-4 h-4" /> Identidade do Objetivo
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Ícone Representativo
              </label>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {AVAILABLE_ICONS.map(({ key, label, Icon }) => {
                  const isSelected = form.emoji === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => updateForm("emoji", key)}
                      className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs transition cursor-pointer ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary shadow-sm ring-1 ring-primary/40 font-bold"
                          : "border-border bg-background hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                      }`}
                      title={label}
                    >
                      <Icon className="w-4 h-4 mb-1" />
                      <span className="text-[10px] truncate max-w-full text-center">{label.split(" ")[0]}</span>
                    </button>
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
                  placeholder="Ex: Valentina NPS Pós-Compra"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-xs font-semibold text-foreground placeholder:text-muted-foreground transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Descrição Interna (Para o Operador)
                </label>
                <input
                  type="text"
                  value={form.description ?? ""}
                  onChange={(e) => updateForm("description", e.target.value)}
                  placeholder="Ex: Utilizado para avaliar o nível de satisfação após faturamento do pedido..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-xs text-foreground placeholder:text-muted-foreground transition"
                />
              </div>
            </div>
          </div>

          {/* Card 2: Prompt da Valentina */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-soft space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                <FileText className="w-4 h-4" /> Prompt da Valentina (Roteiro da Chamada)
              </div>
              <span className="text-[11px] text-muted-foreground font-mono">
                {form.prompt.length} caracteres
              </span>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Este prompt substitui a conduta padrão da IA quando este objetivo for ativado. Defina o roteiro passo a passo e o tom de voz da conversa telefônica.
            </p>

            <div className="relative">
              <textarea
                value={form.prompt}
                onChange={(e) => updateForm("prompt", e.target.value)}
                placeholder="Você é a Valentina, especialista da Valem Válvulas...&#10;&#10;ROTEIRO:&#10;1. Apresentação inicial...&#10;2. Pergunta de qualificação...&#10;3. Fechamento e próximo passo..."
                rows={12}
                className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-xs font-mono text-foreground leading-relaxed resize-y placeholder:text-muted-foreground/60 transition"
              />
            </div>

            <div className="p-3 bg-muted/40 rounded-xl border border-border text-[11px] text-muted-foreground space-y-1">
              <div className="font-bold text-foreground flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-primary" /> Dicas para voz humana:
              </div>
              <div>• A IA responde turnos curtos (1 a 2 frases). Evite parágrafos densos.</div>
              <div>• Não utilize markdown, asteriscos ou formatações complexas no prompt.</div>
            </div>
          </div>

          {/* Card 3: Ações e Gatilhos Automáticos */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-soft space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary border-b border-border pb-3">
              <Zap className="w-4 h-4" /> Ações Automáticas e Gatilhos
            </div>

            <p className="text-xs text-muted-foreground">
              Selecione quais integrações devem ser disparadas automaticamente durante ou após a chamada telefônica.
            </p>

            <div className="grid grid-cols-1 gap-2.5">
              {Object.entries(ACTION_DEFINITIONS).map(([key, meta]) => {
                const isSelected = form.actions.includes(key);
                const ActionIcon = meta.icon;
                return (
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
                );
              })}
            </div>
          </div>

        </div>

        {/* ── Coluna Direita: Campos Estruturados & Resumo (5 Cols) ───────────── */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Card 4: Campos a Coletar */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-soft space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                <Target className="w-4 h-4" /> Campos a Coletar
              </div>
              <button
                type="button"
                onClick={addField}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold transition-colors cursor-pointer border border-primary/20"
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              A IA estruturará estas informações da transcrição para salvar diretamente nos registros da ligação.
            </p>

            {form.collectFields.length === 0 ? (
              <div className="border border-dashed border-border rounded-2xl p-6 text-center text-muted-foreground">
                <Target className="w-8 h-8 mx-auto opacity-20 mb-2" />
                <p className="text-xs font-semibold text-foreground">Nenhum campo estruturado</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  A IA registrará apenas o resumo geral e sentimento da chamada.
                </p>
                <button
                  type="button"
                  onClick={addField}
                  className="mt-3 text-xs font-bold text-primary hover:underline cursor-pointer"
                >
                  + Adicionar primeiro campo
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {form.collectFields.map((field, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-background border border-border rounded-xl space-y-2.5 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Campo #{idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeField(idx)}
                        className="text-muted-foreground hover:text-rose-500 transition-colors p-1 rounded-lg hover:bg-rose-500/10 cursor-pointer"
                        title="Remover campo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                          Chave no Sistema (JSON)
                        </label>
                        <input
                          type="text"
                          value={field.key}
                          onChange={(e) =>
                            updateField(idx, "key", e.target.value.replace(/[^a-z0-9_]/gi, "_").toLowerCase())
                          }
                          placeholder="ex: nota_nps, volume_mensal"
                          className="w-full px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                          Rótulo Amigável (Label)
                        </label>
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateField(idx, "label", e.target.value)}
                          placeholder="ex: Nota NPS (0-10), Volume Estimado"
                          className="w-full px-3 py-1.5 rounded-lg border border-border bg-card text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/50">
                      <div className="flex-1">
                        <select
                          value={field.type}
                          onChange={(e) => updateField(idx, "type", e.target.value as any)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-card text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
                        >
                          {FIELD_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => updateField(idx, "required", e.target.checked)}
                          className="rounded border-border text-primary focus:ring-primary/30 cursor-pointer"
                        />
                        <span className="text-[11px] font-semibold">Obrigatório</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Card 5: Resumo e Pré-visualização da Missão */}
          <div className="bg-muted/30 border border-border rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="w-4 h-4 text-primary" /> Resumo do Comportamento da IA
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between py-1 border-b border-border/50">
                <span>Identidade:</span>
                <span className="font-bold text-foreground flex items-center gap-1">
                  <RenderObjectiveIcon iconKey={form.emoji} className="w-3.5 h-3.5 text-primary" />
                  {form.name || "Sem Nome"}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-border/50">
                <span>Ações Ativas:</span>
                <span className="font-bold text-foreground">{form.actions.length} automação(ões)</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-border/50">
                <span>Campos Estruturados:</span>
                <span className="font-bold text-foreground">{form.collectFields.length} campo(s)</span>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground/80 italic pt-1">
              Ao vincular este objetivo a uma campanha, a Valentina executará exatamente esta diretriz para cada contato.
            </p>
          </div>

        </div>

      </div>

      {/* ── Footer Fixo de Ações ────────────────────────────────────────────── */}
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
          className="flex items-center gap-2 px-6 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50 transition shadow-soft cursor-pointer"
        >
          <Save className="w-4 h-4" />
          {saving ? "Salvando Alterações..." : "Salvar e Ativar Objetivo"}
        </button>
      </div>
    </motion.div>
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
        obj.isActive ? "border-border shadow-soft" : "border-border/50 opacity-60 bg-muted/10"
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

              {/* Badges de Ações com Ícones */}
              {obj.actions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {obj.actions.map((actionKey) => {
                    const meta = ACTION_DEFINITIONS[actionKey];
                    const ActionIcon = meta?.icon || Zap;
                    return (
                      <span
                        key={actionKey}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-muted/60 text-foreground border border-border"
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

          {/* Botões de Ação do Card */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title={expanded ? "Ocultar Roteiro" : "Visualizar Roteiro"}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <button
              onClick={onEdit}
              className="p-2 rounded-xl hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
              title="Editar Objetivo Completo"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button
              onClick={onDuplicate}
              className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Duplicar como Novo"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={onToggle}
              className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-primary transition-colors cursor-pointer"
              title={obj.isActive ? "Desativar Objetivo" : "Ativar Objetivo"}
            >
              {obj.isActive ? (
                <ToggleRight className="w-5 h-5 text-primary" />
              ) : (
                <ToggleLeft className="w-5 h-5" />
              )}
            </button>
            {!obj.isTemplate && (
              <button
                onClick={onDelete}
                className="p-2 rounded-xl hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition-colors cursor-pointer"
                title="Excluir Objetivo"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Tags de Campos Coletados */}
        {obj.collectFields && obj.collectFields.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">
              Coleta:
            </span>
            {obj.collectFields.map((f) => (
              <span
                key={f.key}
                className="px-2 py-0.5 rounded-md bg-background border border-border text-foreground text-[11px] font-mono"
              >
                {f.label}{f.required ? " *" : ""}
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
                <FileText className="w-3.5 h-3.5" /> Roteiro e Diretrizes de Voz
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
            Configure missões personalizadas com roteiros de voz, campos a coletar e gatilhos de automação.
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
  );
}
