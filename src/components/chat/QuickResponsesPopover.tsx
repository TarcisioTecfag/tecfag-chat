import React, { useState, useRef, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Zap,
  Search,
  X,
  Plus,
  Edit2,
  Trash2,
  Globe,
  User,
  ArrowLeft,
  Check,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import type { QuickResponse, OperatorTemplate } from "@/lib/mockData";
import { useTrainingSurface } from "@/hooks/useTrainingSurface";
import { formatQuickShortcut, matchesQuickResponseSearch } from "@/lib/utils";
import { SystemTooltip } from "@/components/ui/tooltip";

interface QuickResponsesPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  quickResponses: QuickResponse[];
  templates: OperatorTemplate[];
  slashFilterText?: string;
  canManageGlobalTemplates: boolean;
  operatorName?: string;
  customerName?: string;
  onSelectResponse: (text: string) => void;
  onCreateGlobal: (qr: { shortcut: string; text: string; description?: string }) => Promise<boolean | void>;
  onUpdateGlobal: (id: string, fields: Partial<QuickResponse>) => Promise<boolean | void>;
  onDeleteGlobal: (id: string) => Promise<boolean | void>;
  onCreateIndividual: (title: string, text: string) => Promise<boolean | void>;
  onUpdateIndividual: (id: string, title: string, text: string) => Promise<boolean | void>;
  onDeleteIndividual: (id: string) => Promise<boolean | void>;
  onOpenFullManager?: () => void;
}

export function QuickResponsesPopover({
  isOpen,
  onClose,
  quickResponses,
  templates,
  slashFilterText = "",
  canManageGlobalTemplates,
  operatorName = "Atendente",
  customerName = "Cliente",
  onSelectResponse,
  onCreateGlobal,
  onUpdateGlobal,
  onDeleteGlobal,
  onCreateIndividual,
  onUpdateIndividual,
  onDeleteIndividual,
  onOpenFullManager,
}: QuickResponsesPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const formTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "global" | "personal">("all");

  // Estado de criação / edição inline
  const [formMode, setFormMode] = useState<"idle" | "create" | "edit">("idle");
  const [formScope, setFormScope] = useState<"personal" | "global">("personal");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitleOrShortcut, setFormTitleOrShortcut] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formText, setFormText] = useState("");
  const [saving, setSaving] = useState(false);
  useTrainingSurface("quick", (step) => {
    setFormMode(step.id === "chat.quick-personal" ? "create" : "idle");
    setFormScope("personal");
    setActiveTab(step.id === "chat.quick-global" ? "global" : "all");
    return isOpen;
  });

  // Fechar ao clicar fora (ignorando o próprio botão gatilho de Respostas Rápidas)
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-quick-responses-trigger]")) return;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (formMode !== "idle") {
          setFormMode("idle");
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, formMode]);

  // Resetar modo de formulário ao fechar
  useEffect(() => {
    if (!isOpen) {
      setFormMode("idle");
      setSearchQuery("");
    }
  }, [isOpen]);

  const effectiveFilter = (slashFilterText || searchQuery).trim();

  const filteredQrs = useMemo(() => {
    if (activeTab === "personal") return [];
    return (quickResponses || []).filter((qr) =>
      matchesQuickResponseSearch(
        `${qr.shortcut} ${qr.description || ""}`,
        qr.text,
        effectiveFilter
      )
    );
  }, [quickResponses, effectiveFilter, activeTab]);

  const filteredTpls = useMemo(() => {
    if (activeTab === "global") return [];
    return (templates || []).filter((tpl) =>
      matchesQuickResponseSearch(tpl.title, tpl.text, effectiveFilter)
    );
  }, [templates, effectiveFilter, activeTab]);

  const totalCount = (quickResponses?.length || 0) + (templates?.length || 0);

  const handleStartCreate = (defaultScope?: "personal" | "global") => {
    setFormMode("create");
    setEditingId(null);
    setFormScope(defaultScope || (canManageGlobalTemplates ? "global" : "personal"));
    setFormTitleOrShortcut(slashFilterText ? `/${slashFilterText}` : "");
    setFormDescription("");
    setFormText("");
  };

  const handleStartEditGlobal = (e: React.MouseEvent, qr: QuickResponse) => {
    e.stopPropagation();
    setFormMode("edit");
    setFormScope("global");
    setEditingId(qr.id || null);
    setFormTitleOrShortcut(qr.shortcut);
    setFormDescription(qr.description || "");
    setFormText(qr.text);
  };

  const handleStartEditPersonal = (e: React.MouseEvent, tpl: OperatorTemplate) => {
    e.stopPropagation();
    setFormMode("edit");
    setFormScope("personal");
    setEditingId(tpl.id);
    setFormTitleOrShortcut(tpl.title);
    setFormDescription("");
    setFormText(tpl.text);
  };

  const handleDeleteItem = async (
    e: React.MouseEvent,
    scope: "global" | "personal",
    id?: string,
  ) => {
    e.stopPropagation();
    if (!id) return;
    if (scope === "global") {
      await onDeleteGlobal(id);
    } else {
      await onDeleteIndividual(id);
    }
  };

  const handleInsertVariable = (tag: string) => {
    const el = formTextareaRef.current;
    if (!el) {
      setFormText((prev) => `${prev}${tag}`);
      return;
    }
    const start = el.selectionStart ?? formText.length;
    const end = el.selectionEnd ?? formText.length;
    const next = formText.slice(0, start) + tag + formText.slice(end);
    setFormText(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + tag.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawTitle = formTitleOrShortcut.trim();
    const rawText = formText.trim();
    if (!rawTitle || !rawText || saving) return;

    setSaving(true);
    try {
      if (formScope === "global" && canManageGlobalTemplates) {
        const formattedShortcut = rawTitle.startsWith("/") ? rawTitle : `/${rawTitle}`;
        if (formMode === "edit" && editingId) {
          await onUpdateGlobal(editingId, {
            shortcut: formattedShortcut,
            text: rawText,
            description: formDescription.trim() || undefined,
          });
        } else {
          await onCreateGlobal({
            shortcut: formattedShortcut,
            text: rawText,
            description: formDescription.trim() || undefined,
          });
        }
      } else {
        if (formMode === "edit" && editingId) {
          await onUpdateIndividual(editingId, rawTitle, rawText);
        } else {
          await onCreateIndividual(rawTitle, rawText);
        }
      }
      setFormMode("idle");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <motion.div
      ref={popoverRef}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ type: "spring", damping: 24, stiffness: 320 }}
      className="absolute bottom-full left-0 right-0 mb-2.5 z-[60] rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col max-h-[380px]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {formMode !== "idle" ? (
            <SystemTooltip content="Voltar para a lista">
              <button
                type="button"
                onClick={() => setFormMode("idle")}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
          ) : (
            <div className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Zap className="h-3.5 w-3.5" />
            </div>
          )}
          <span className="text-xs font-extrabold text-foreground truncate">
            {formMode === "create"
              ? "Novo Template / Resposta Rápida"
              : formMode === "edit"
                ? "Editar Template / Resposta Rápida"
                : "Respostas Rápidas & Meus Templates"}
          </span>
          {formMode === "idle" && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
              {totalCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {formMode === "idle" && (
            <button
              type="button"
              onClick={() => handleStartCreate()}
              className="inline-flex items-center gap-1 rounded-xl bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-2xs"
            >
              <Plus className="h-3 w-3" />
              <span>Novo Template</span>
            </button>
          )}
          <SystemTooltip content="Fechar (Esc)">
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </SystemTooltip>
        </div>
      </div>

      {formMode !== "idle" ? (
        /* ── FORMULÁRIO INLINE DE CRIAÇÃO / EDIÇÃO ── */
        <form data-tour="quick.personal-editor" onSubmit={handleSaveForm} className="p-4 space-y-3 overflow-y-auto scrollbar-thin">
          {canManageGlobalTemplates && formMode === "create" && (
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-muted/60 border border-border">
              <button
                type="button"
                onClick={() => setFormScope("personal")}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  formScope === "personal"
                    ? "bg-card text-primary shadow-2xs border border-border/60"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <User className="h-3 w-3" />
                <span>Meu Template (Individual)</span>
              </button>
              <button
                type="button"
                onClick={() => setFormScope("global")}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  formScope === "global"
                    ? "bg-card text-primary shadow-2xs border border-border/60"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Globe className="h-3 w-3" />
                <span>Global (Toda a Equipe)</span>
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {formScope === "global" ? "Atalho (ex: /saudacao)" : "Título do Template (Atalho)"}
                </label>
                {formTitleOrShortcut.trim() && (
                  <span className="text-[10px] font-mono font-bold text-primary">
                    Atalho: {formatQuickShortcut(formTitleOrShortcut)}
                  </span>
                )}
              </div>
              <input
                type="text"
                required
                autoFocus
                value={formTitleOrShortcut}
                onChange={(e) => setFormTitleOrShortcut(e.target.value)}
                placeholder={formScope === "global" ? "/saudacao" : "Ex: Saudação Inicial"}
                className="w-full h-8 rounded-xl border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary"
              />
            </div>

            {formScope === "global" && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Descrição Curta (Opcional)
                </label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Ex: Boas-vindas ao cliente"
                  className="w-full h-8 rounded-xl border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary"
                />
              </div>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Conteúdo da Mensagem
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                <SystemTooltip content={`Insere o nome do cliente (${customerName})`}>
                  <button
                    type="button"
                    onClick={() => handleInsertVariable("{{nome}}")}
                    className="rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary transition cursor-pointer"
                  >
                    + {"{{nome}}"} Cliente
                  </button>
                </SystemTooltip>
                <SystemTooltip content={`Insere seu nome (${operatorName})`}>
                  <button
                    type="button"
                    onClick={() => handleInsertVariable("{{operador}}")}
                    className="rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary transition cursor-pointer"
                  >
                    + {"{{operador}}"} Meu Nome
                  </button>
                </SystemTooltip>
                <SystemTooltip content="Insere o nome da nossa empresa automaticamente">
                  <button
                    type="button"
                    onClick={() => handleInsertVariable("{{empresa}}")}
                    className="rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary transition cursor-pointer"
                  >
                    + {"{{empresa}}"} Empresa
                  </button>
                </SystemTooltip>
              </div>
            </div>
            <textarea
              ref={formTextareaRef}
              required
              rows={3}
              value={formText}
              onChange={(e) => setFormText(e.target.value)}
              placeholder="Olá! {{nome}}, meu nome é {{operador}} faço parte do time da {{empresa}}, como posso te ajudar hoje?"
              className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary resize-none leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setFormMode("idle")}
              className="h-8 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !formTitleOrShortcut.trim() || !formText.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition cursor-pointer shadow-soft"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{saving ? "Salvando..." : "Salvar Template"}</span>
            </button>
          </div>
        </form>
      ) : (
        /* ── LISTAGEM E BUSCA DE RESPOSTAS RÁPIDAS ── */
        <>
          {/* Barra de pesquisa + Abas */}
          <div className="px-3.5 py-2 border-b border-border/60 bg-background/50 flex flex-col sm:flex-row sm:items-center gap-2 shrink-0">
            <div className="relative flex-1 flex items-center">
              <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={slashFilterText ? `/${slashFilterText}` : searchQuery}
                onChange={(e) => setSearchQuery(e.target.value.replace(/^\//, ""))}
                placeholder="Buscar por atalho (/...), título ou texto..."
                className="w-full h-7.5 rounded-lg border border-border bg-card pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/60"
              />
              {(searchQuery || slashFilterText) && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab("all")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  activeTab === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/70 text-muted-foreground hover:text-foreground"
                }`}
              >
                Todas ({totalCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("global")}
                data-tour="quick.global"
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  activeTab === "global"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/70 text-muted-foreground hover:text-foreground"
                }`}
              >
                Globais ({quickResponses?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("personal")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  activeTab === "personal"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/70 text-muted-foreground hover:text-foreground"
                }`}
              >
                Meus ({templates?.length || 0})
              </button>
            </div>
          </div>

          {/* Corpo da Lista */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin">
            {filteredQrs.length === 0 && filteredTpls.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 px-4 text-center rounded-xl border border-dashed border-border bg-muted/20">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary mb-2">
                  <Sparkles className="h-5 w-5" />
                </div>
                <p className="text-xs font-bold text-foreground">
                  {effectiveFilter
                    ? `Nenhum template ou resposta encontrada para "${effectiveFilter}"`
                    : "Nenhum template ou resposta rápida cadastrada"}
                </p>
                <p className="text-[11px] text-muted-foreground max-w-sm mt-1 leading-relaxed">
                  {effectiveFilter
                    ? "Tente outro termo ou crie um novo template com este nome agora mesmo."
                    : "Cadastre mensagens prontas para inserir no atendimento com 1 clique ou digitando '/' no campo de mensagem."}
                </p>
                <button
                  type="button"
                  onClick={() => handleStartCreate()}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-soft"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Criar Template Agora</span>
                </button>
              </div>
            ) : (
              <>
                {filteredQrs.length > 0 && (
                  <div className="space-y-1">
                    <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Globe className="h-3 w-3 text-primary" />
                      <span>Respostas Rápidas Globais ({filteredQrs.length})</span>
                    </div>
                    {filteredQrs.map((qr) => (
                      <div
                        key={qr.id || qr.shortcut}
                        data-tour="quick.insert" onClick={() => onSelectResponse(qr.text)}
                        className="group flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-muted/80 border border-transparent hover:border-border/70 transition cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <span className="shrink-0 rounded-lg bg-primary/10 border border-primary/20 px-2 py-0.5 text-xs font-bold text-primary font-mono">
                            {qr.shortcut.startsWith("/") ? qr.shortcut : `/${qr.shortcut}`}
                          </span>
                          <div className="min-w-0 flex-1">
                            {qr.description && (
                              <div className="text-[10px] font-bold text-foreground truncate">
                                {qr.description}
                              </div>
                            )}
                            <div className="truncate text-xs text-muted-foreground font-medium">
                              {qr.text}
                            </div>
                          </div>
                        </div>

                        {canManageGlobalTemplates && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                            <SystemTooltip content="Editar resposta global">
                              <button
                                type="button"
                                onClick={(e) => handleStartEditGlobal(e, qr)}
                                className="p-1 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition cursor-pointer"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            </SystemTooltip>
                            <SystemTooltip content="Excluir resposta global">
                              <button
                                type="button"
                                onClick={(e) => void handleDeleteItem(e, "global", qr.id)}
                                className="p-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </SystemTooltip>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {filteredTpls.length > 0 && (
                  <div className="space-y-1">
                    <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <User className="h-3 w-3 text-primary" />
                      <span>Meus Templates Individuais ({filteredTpls.length})</span>
                    </div>
                    {filteredTpls.map((tpl) => {
                      const shortcutBadge = formatQuickShortcut(tpl.title);
                      const showSeparateTitle =
                        tpl.title.trim().toLowerCase() !== shortcutBadge.toLowerCase();
                      return (
                        <div
                          key={tpl.id}
                          data-tour="quick.insert" onClick={() => onSelectResponse(tpl.text)}
                          className="group flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-muted/80 border border-transparent hover:border-border/70 transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <span className="shrink-0 rounded-lg bg-primary/10 border border-primary/20 px-2 py-0.5 text-xs font-bold text-primary font-mono">
                              {shortcutBadge}
                            </span>
                            <div className="min-w-0 flex-1">
                              {showSeparateTitle && (
                                <div className="text-[10px] font-bold text-foreground truncate">
                                  {tpl.title}
                                </div>
                              )}
                              <div className="truncate text-xs text-muted-foreground font-medium">
                                {tpl.text}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                            <SystemTooltip content="Editar meu template">
                              <button
                                type="button"
                                onClick={(e) => handleStartEditPersonal(e, tpl)}
                                className="p-1 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition cursor-pointer"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            </SystemTooltip>
                            <SystemTooltip content="Excluir meu template">
                              <button
                                type="button"
                                onClick={(e) => void handleDeleteItem(e, "personal", tpl.id)}
                                className="p-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </SystemTooltip>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Rodapé com Dica + Link para painel completo */}
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-border/60 bg-muted/20 text-[10px] text-muted-foreground shrink-0">
            <span>
              Dica: digite <strong className="font-mono text-foreground">/</strong> no campo de mensagem para abrir rapidamente
            </span>
            {onOpenFullManager && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFullManager();
                }}
                className="inline-flex items-center gap-1 font-bold text-primary hover:underline cursor-pointer shrink-0"
              >
                <span>Gerenciar todos</span>
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
