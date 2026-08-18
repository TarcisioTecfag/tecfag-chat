// src/components/voice/ObjetivosTab.tsx
// Aba de Objetivos da Valentina — configuracao de prompts, campos e acoes por objetivo

import React, { useState, useEffect } from "react";
import {
  Target, Plus, Edit2, Trash2, Copy, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, X, Save, Sparkles, Zap, Info,
} from "lucide-react";

const TENANT_ID = "valem";

const ACTION_LABELS: Record<string, { label: string; description: string; color: string }> = {
  collect_nps:           { label: "Coleta NPS",          description: "Salva nota e feedback no banco",                       color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  create_rd_deal:        { label: "Cria Deal RD Station", description: "Gera oportunidade no CRM automaticamente",             color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  send_whatsapp_catalog: { label: "Envia Catalogo WhatsApp", description: "Dispara catalogo pelo Baileys pos-ligacao",          color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  schedule_callback:     { label: "Agenda Retorno",       description: "Cria entrada na Agenda se cliente pedir retorno",      color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  enrich_cnpj:           { label: "Enriquece CNPJ",       description: "Busca dados da empresa pelo CNPJ antes de ligar",      color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
};

const FIELD_TYPES = ["text", "number", "boolean"] as const;

interface CollectField {
  key: string;
  label: string;
  type: typeof FIELD_TYPES[number];
  required: boolean;
}

interface VoiceObjective {
  id: string;
  name: string;
  description?: string;
  emoji: string;
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
  emoji: "🎯",
  prompt: "",
  collectFields: [],
  actions: [],
  isActive: true,
  isTemplate: false,
};

// ── Modal de criacao/edicao ──────────────────────────────────────────────────

function ObjectiveModal({
  objective,
  onSave,
  onClose,
}: {
  objective: Partial<VoiceObjective> | null;
  onSave: (data: any) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<typeof EMPTY_OBJECTIVE>(
    objective ? { ...EMPTY_OBJECTIVE, ...objective } : { ...EMPTY_OBJECTIVE }
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

  const toggleAction = (action: string) =>
    updateForm(
      "actions",
      form.actions.includes(action)
        ? form.actions.filter((a) => a !== action)
        : [...form.actions, action]
    );

  const handleSave = async () => {
    if (!form.name.trim() || !form.prompt.trim()) {
      alert("Nome e Prompt sao obrigatorios.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{form.emoji}</span>
            <h2 className="text-lg font-bold text-foreground">
              {objective?.id ? "Editar Objetivo" : "Novo Objetivo"}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-muted transition-colors cursor-pointer">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Identidade */}
          <section>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Identidade
            </h3>
            <div className="grid grid-cols-[auto_1fr] gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Emoji</label>
                <input
                  type="text"
                  value={form.emoji}
                  onChange={(e) => updateForm("emoji", e.target.value.slice(0, 2))}
                  className="w-14 text-center text-2xl px-2 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Nome do Objetivo *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateForm("name", e.target.value)}
                  placeholder="Ex: Valentina NPS"
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs text-muted-foreground mb-1">Descricao interna (para o operador)</label>
              <input
                type="text"
                value={form.description ?? ""}
                onChange={(e) => updateForm("description", e.target.value)}
                placeholder="O que este objetivo faz..."
                className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
              />
            </div>
          </section>

          {/* Prompt */}
          <section>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> Prompt da Valentina *
            </h3>
            <p className="text-xs text-muted-foreground mb-2">
              Este prompt substitui o prompt padrao da Valentina quando este objetivo for usado em uma campanha.
            </p>
            <textarea
              value={form.prompt}
              onChange={(e) => updateForm("prompt", e.target.value)}
              placeholder="Voce e a Valentina, consultora comercial da Valem Valvulas...&#10;&#10;ROTEIRO:&#10;1. Apresente-se..."
              rows={10}
              className="w-full px-3 py-2 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm font-mono resize-none"
            />
          </section>

          {/* Acoes automaticas */}
          <section>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> Acoes Automaticas
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              O que a Valentina executa automaticamente durante ou apos a ligacao.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(ACTION_LABELS).map(([key, meta]) => {
                const active = form.actions.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleAction(key)}
                    className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/50"
                    }`}
                  >
                    <div className={`px-2 py-0.5 rounded-lg text-xs font-semibold shrink-0 mt-0.5 ${meta.color}`}>
                      {active ? "ON" : "OFF"}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-foreground">{meta.label}</div>
                      <div className="text-xs text-muted-foreground">{meta.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Campos a coletar */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" /> Campos a Coletar
              </h3>
              <button
                onClick={addField}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar Campo
              </button>
            </div>
            {form.collectFields.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded-xl">
                Nenhum campo definido — a Valentina so fara a ligacao sem estruturar dados especificos.
              </p>
            ) : (
              <div className="space-y-2">
                {form.collectFields.map((field, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-center">
                    <input
                      type="text"
                      value={field.key}
                      onChange={(e) => updateField(idx, "key", e.target.value.replace(/\s/g, "_").toLowerCase())}
                      placeholder="chave_do_campo"
                      className="px-2 py-1.5 rounded-lg border border-border bg-background text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <input
                      type="text"
                      value={field.label}
                      onChange={(e) => updateField(idx, "label", e.target.value)}
                      placeholder="Rotulo visivel"
                      className="px-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <select
                      value={field.type}
                      onChange={(e) => updateField(idx, "type", e.target.value)}
                      className="px-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none cursor-pointer"
                    >
                      {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(idx, "required", e.target.checked)}
                        className="rounded cursor-pointer"
                      />
                      <span className="text-xs text-muted-foreground">Req</span>
                    </label>
                    <button onClick={() => removeField(idx)} className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border sticky bottom-0 bg-card">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted transition-colors cursor-pointer">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Save className="h-4 w-4" />
            {saving ? "Salvando..." : "Salvar Objetivo"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card de objetivo ─────────────────────────────────────────────────────────

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
    <div className={`rounded-2xl border bg-card transition-all ${obj.isActive ? "border-border" : "border-border/50 opacity-60"}`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className="text-2xl shrink-0">{obj.emoji}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-foreground text-sm">{obj.name}</h3>
                {obj.isTemplate && (
                  <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-semibold">Template</span>
                )}
                <span className={`px-1.5 py-0.5 rounded-md text-xs font-semibold ${obj.isActive ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                  {obj.isActive ? "Ativo" : "Inativo"}
                </span>
              </div>
              {obj.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{obj.description}</p>
              )}
              {/* Acoes ativas */}
              {obj.actions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {obj.actions.map((a) => (
                    <span key={a} className={`px-1.5 py-0.5 rounded-md text-xs font-medium ${ACTION_LABELS[a]?.color ?? "bg-muted text-muted-foreground"}`}>
                      {ACTION_LABELS[a]?.label ?? a}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Acoes do card */}
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setExpanded((v) => !v)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors cursor-pointer" title="Ver prompt">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors cursor-pointer" title="Editar">
              <Edit2 className="h-4 w-4" />
            </button>
            <button onClick={onDuplicate} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors cursor-pointer" title="Duplicar">
              <Copy className="h-4 w-4" />
            </button>
            <button onClick={onToggle} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors cursor-pointer" title={obj.isActive ? "Desativar" : "Ativar"}>
              {obj.isActive ? <ToggleRight className="h-4 w-4 text-primary" /> : <ToggleLeft className="h-4 w-4" />}
            </button>
            {!obj.isTemplate && (
              <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer" title="Excluir">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Campos coletados */}
        {obj.collectFields.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {obj.collectFields.map((f) => (
              <span key={f.key} className="px-2 py-0.5 rounded-lg bg-muted text-muted-foreground text-xs font-mono">
                {f.label}{f.required ? " *" : ""}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Preview do prompt */}
      {expanded && (
        <div className="border-t border-border mx-4 mb-4 pt-3">
          <p className="text-xs font-semibold text-muted-foreground mb-1">System Prompt</p>
          <pre className="text-xs text-foreground bg-muted/50 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
            {obj.prompt}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Tab principal ─────────────────────────────────────────────────────────────

export function ObjetivosTab() {
  const [objectives, setObjectives] = useState<VoiceObjective[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalObj, setModalObj] = useState<Partial<VoiceObjective> | null | undefined>(undefined);
  // undefined = fechado, null = novo, VoiceObjective = editando

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

  useEffect(() => { load(); }, []);

  const handleSave = async (form: typeof EMPTY_OBJECTIVE) => {
    if ((modalObj as VoiceObjective)?.id) {
      await fetch("/api/voice-objectives", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: TENANT_ID, id: (modalObj as VoiceObjective).id, ...form }),
      });
    } else {
      await fetch("/api/voice-objectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: TENANT_ID, ...form }),
      });
    }
    setModalObj(undefined);
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
    if (!confirm(`Excluir "${obj.name}"?`)) return;
    await fetch(`/api/voice-objectives?tenantId=${TENANT_ID}&id=${obj.id}`, { method: "DELETE" });
    load();
  };

  const handleDuplicate = async (obj: VoiceObjective) => {
    await fetch("/api/voice-objectives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: TENANT_ID,
        name: `${obj.name} (copia)`,
        description: obj.description,
        emoji: obj.emoji,
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

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" /> Objetivos da Valentina
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure o proposito, prompt e campos de cada missao da Valentina. Vincule um objetivo a uma campanha para definir o roteiro.
          </p>
        </div>
        <button
          onClick={() => setModalObj(null)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors cursor-pointer shadow-soft"
        >
          <Plus className="h-4 w-4" /> Novo Objetivo
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">Carregando objetivos...</div>
      ) : (
        <>
          {/* Templates */}
          {templates.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5" /> Templates Pre-definidos
              </h3>
              <div className="grid grid-cols-1 gap-3">
                {templates.map((obj) => (
                  <ObjectiveCard
                    key={obj.id}
                    obj={obj}
                    onEdit={() => setModalObj(obj)}
                    onDuplicate={() => handleDuplicate(obj)}
                    onToggle={() => handleToggle(obj)}
                    onDelete={() => handleDelete(obj)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Custom */}
          {custom.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Objetivos Customizados
              </h3>
              <div className="grid grid-cols-1 gap-3">
                {custom.map((obj) => (
                  <ObjectiveCard
                    key={obj.id}
                    obj={obj}
                    onEdit={() => setModalObj(obj)}
                    onDuplicate={() => handleDuplicate(obj)}
                    onToggle={() => handleToggle(obj)}
                    onDelete={() => handleDelete(obj)}
                  />
                ))}
              </div>
            </section>
          )}

          {objectives.length === 0 && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground">
              <Target className="h-12 w-12 opacity-20" />
              <p className="text-sm">Nenhum objetivo configurado ainda.</p>
            </div>
          )}
        </>
      )}

      {/* Modal */}
      {modalObj !== undefined && (
        <ObjectiveModal
          objective={modalObj}
          onSave={handleSave}
          onClose={() => setModalObj(undefined)}
        />
      )}
    </div>
  );
}
