// ══════════════════════════════════════════════════════════════════════════════
// 📑 VALENTINA THREAD RAIL — Barra lateral retrátil de histórico de conversas (Lado Direito)
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare, Plus, Search, FolderPlus, FolderClosed, FolderOpen,
  FolderInput, FolderOutput, ChevronRight, MoreHorizontal, Pencil, Trash2,
  PanelRightClose, PanelRightOpen, History, X, Check, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ValentinaThread, ValentinaFolder } from "./valentina-chat-types";

export interface CreateFolderOptions {
  moveThreadId?: string | null;
  startNewThread?: boolean;
}

interface ValentinaThreadRailProps {
  threads: ValentinaThread[];
  folders: ValentinaFolder[];
  activeThreadId: string | null;
  isOpen: boolean;
  onToggleOpen: () => void;
  onSelectThread: (threadId: string) => void;
  onNewThread: (folderId?: string | null) => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread: (threadId: string, newTitle: string) => void;
  onMoveThread: (threadId: string, folderId: string | null) => void;
  onCreateFolder: (name: string, options?: CreateFolderOptions) => void;
  onRenameFolder: (folderId: string, newName: string) => void;
  onDeleteFolder: (folderId: string) => void;
}

const FOLDER_SUGGESTIONS = [
  "Comercial & Metas",
  "Análise de Equipe",
  "Catálogo & Máquinas",
  "Triagem SDR",
  "Relatórios BI",
];

const relativeTime = (ts: number) => {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}m`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

export function ValentinaThreadRail({
  threads,
  folders,
  activeThreadId,
  isOpen,
  onToggleOpen,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  onRenameThread,
  onMoveThread,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: ValentinaThreadRailProps) {
  const [query, setQuery] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  // Estado do Modal Animado de Criação de Pasta
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderModalAction, setFolderModalAction] = useState<"none" | "move_active" | "new_thread">("none");
  const [pendingMoveThreadId, setPendingMoveThreadId] = useState<string | null>(null);

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? threads.filter((t) => t.title.toLowerCase().includes(q)) : threads;
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [threads, query]);

  const activeThread = useMemo(
    () => (activeThreadId ? threads.find((t) => t.id === activeThreadId) || null : null),
    [threads, activeThreadId]
  );

  const startEditing = (id: string, currentText: string) => {
    setEditingId(id);
    setEditingDraft(currentText);
  };

  const commitEditing = (type: "thread" | "folder", id: string) => {
    if (editingDraft.trim()) {
      if (type === "thread") onRenameThread(id, editingDraft.trim());
      else onRenameFolder(id, editingDraft.trim());
    }
    setEditingId(null);
  };

  const openCreateFolderModal = (preselectedThreadId?: string | null) => {
    setNewFolderName("");
    if (preselectedThreadId) {
      setPendingMoveThreadId(preselectedThreadId);
      setFolderModalAction("move_active");
    } else {
      setPendingMoveThreadId(activeThreadId);
      setFolderModalAction("none");
    }
    setIsFolderModalOpen(true);
  };

  const handleConfirmCreateFolder = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    onCreateFolder(trimmed, {
      moveThreadId:
        folderModalAction === "move_active" ? pendingMoveThreadId || activeThreadId : null,
      startNewThread: folderModalAction === "new_thread",
    });
    setIsFolderModalOpen(false);
    setNewFolderName("");
    setPendingMoveThreadId(null);
  };

  const folderModalPortal =
    typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            {isFolderModalOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setIsFolderModalOpen(false)}
                className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94, y: 12 }}
                  transition={{ type: "spring", stiffness: 380, damping: 28 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/12 border border-primary/25 text-primary shrink-0">
                        <FolderPlus className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-extrabold text-foreground">
                          Nova Pasta de Conversas
                        </h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Organize seus diálogos por tema, área ou acompanhamento
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsFolderModalOpen(false)}
                      className="grid h-7 w-7 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <form onSubmit={handleConfirmCreateFolder} className="mt-5 space-y-4">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Nome da pasta
                      </label>
                      <input
                        autoFocus
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="Ex: Comercial & Metas, Equipe, Catálogo..."
                        maxLength={48}
                        className="w-full rounded-xl border border-border bg-muted/30 px-3.5 py-2.5 text-xs font-semibold text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:bg-background outline-none transition-all"
                      />
                    </div>

                    {/* Sugestões rápidas */}
                    <div>
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                        <Sparkles className="h-3 w-3 text-primary" /> Sugestões rápidas
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {FOLDER_SUGGESTIONS.map((sug) => {
                          const isSelected = newFolderName.trim().toLowerCase() === sug.toLowerCase();
                          return (
                            <button
                              key={sug}
                              type="button"
                              onClick={() => setNewFolderName(sug)}
                              className={cn(
                                "rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer",
                                isSelected
                                  ? "border-primary bg-primary/15 text-primary"
                                  : "border-border/70 bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              )}
                            >
                              {sug}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Ação pós-criação */}
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3 space-y-2">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Ao criar a pasta
                      </span>
                      <div className="grid grid-cols-1 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setFolderModalAction("new_thread")}
                          className={cn(
                            "flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-all cursor-pointer",
                            folderModalAction === "new_thread"
                              ? "border-primary/50 bg-primary/10 text-primary"
                              : "border-border/60 bg-card text-foreground/85 hover:bg-muted/50"
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <Plus className="h-3.5 w-3.5 text-primary" />
                            Iniciar uma nova conversa dentro da pasta
                          </span>
                          {folderModalAction === "new_thread" && <Check className="h-3.5 w-3.5 text-primary" />}
                        </button>

                        {(pendingMoveThreadId || activeThread) && (
                          <button
                            type="button"
                            onClick={() => setFolderModalAction("move_active")}
                            className={cn(
                              "flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-all cursor-pointer",
                              folderModalAction === "move_active"
                                ? "border-primary/50 bg-primary/10 text-primary"
                                : "border-border/60 bg-card text-foreground/85 hover:bg-muted/50"
                            )}
                          >
                            <span className="flex items-center gap-2 truncate pr-2">
                              <FolderInput className="h-3.5 w-3.5 text-primary shrink-0" />
                              <span className="truncate">
                                Mover conversa{" "}
                                <strong className="font-bold">
                                  &ldquo;
                                  {(
                                    threads.find((t) => t.id === (pendingMoveThreadId || activeThreadId))
                                      ?.title || "atual"
                                  ).slice(0, 24)}
                                  &rdquo;
                                </strong>{" "}
                                para cá
                              </span>
                            </span>
                            {folderModalAction === "move_active" && (
                              <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                            )}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setFolderModalAction("none")}
                          className={cn(
                            "flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-all cursor-pointer",
                            folderModalAction === "none"
                              ? "border-primary/50 bg-primary/10 text-primary"
                              : "border-border/60 bg-card text-foreground/85 hover:bg-muted/50"
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <FolderClosed className="h-3.5 w-3.5 text-muted-foreground" />
                            Apenas criar a pasta vazia
                          </span>
                          {folderModalAction === "none" && <Check className="h-3.5 w-3.5 text-primary" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsFolderModalOpen(false)}
                        className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={!newFolderName.trim()}
                        className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                      >
                        <FolderPlus className="h-3.5 w-3.5" />
                        Criar Pasta
                      </button>
                    </div>
                  </form>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )
      : null;

  // Se minimizado: renderiza botão colapsado na margem direita
  if (!isOpen) {
    return (
      <>
        {folderModalPortal}
        <SystemTooltip content="Abrir histórico e pastas de conversas">
          <button
            onClick={onToggleOpen}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-card border border-border/80 text-muted-foreground text-xs font-bold hover:text-foreground hover:bg-muted/80 shadow-sm transition-all cursor-pointer"
          >
            <History className="h-3.5 w-3.5 text-primary" />
            <span>Histórico</span>
            <PanelRightOpen className="h-3.5 w-3.5 ml-0.5" />
          </button>
        </SystemTooltip>
      </>
    );
  }

  const looseThreads = filteredThreads.filter(
    (t) => !t.folderId || !folders.some((f) => f.id === t.folderId)
  );

  return (
    <>
      {folderModalPortal}
      <aside className="w-76 shrink-0 flex flex-col h-full rounded-2xl border border-border bg-card shadow-card overflow-hidden transition-all duration-200">
        {/* Header da Barra Lateral */}
        <div className="flex items-center justify-between border-b border-border/80 px-3.5 py-3 bg-muted/20">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-bold text-foreground">Histórico & Pastas</h3>
          </div>
          <SystemTooltip content="Recolher histórico">
            <button
              onClick={onToggleOpen}
              className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          </SystemTooltip>
        </div>

        {/* Ações de Nova Conversa + Nova Pasta + Busca */}
        <div className="space-y-2 p-3 border-b border-border/60 bg-card">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNewThread(null)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground shadow-sm transition-all hover:opacity-90 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Nova Conversa
            </button>
            <SystemTooltip content="Criar nova pasta de conversas">
              <button
                type="button"
                onClick={() => openCreateFolderModal(null)}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-2.5 py-2 text-xs font-bold text-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary transition-all cursor-pointer"
              >
                <FolderPlus className="h-4 w-4 text-primary" />
                <span>Pasta</span>
              </button>
            </SystemTooltip>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-2.5 py-1.5 focus-within:border-primary/60 transition">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar conversas..."
              className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Título de Pastas e Conversas */}
        <div className="flex items-center justify-between px-3.5 pt-3 pb-1">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
            Pastas e Conversas
          </span>
          <SystemTooltip content="Criar nova pasta">
            <button
              type="button"
              onClick={() => openCreateFolderModal(null)}
              className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-bold text-primary hover:bg-primary/10 transition cursor-pointer"
            >
              <FolderPlus className="h-3 w-3" />
              Nova pasta
            </button>
          </SystemTooltip>
        </div>

        {/* Lista de Pastas e Threads */}
        <nav className="flex-1 overflow-y-auto px-2 pb-3 pt-1 space-y-1.5">
          {threads.length === 0 && folders.length === 0 ? (
            <div className="px-3 py-8 text-center space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Nenhuma conversa salva.</p>
              <button
                type="button"
                onClick={() => openCreateFolderModal(null)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-muted/30 px-3 py-1.5 text-[11px] font-bold text-foreground hover:border-primary/40 hover:text-primary transition cursor-pointer"
              >
                <FolderPlus className="h-3.5 w-3.5 text-primary" />
                Criar primeira pasta
              </button>
            </div>
          ) : null}

          {/* Pastas */}
          {folders.map((folder) => {
            const items = filteredThreads.filter((t) => t.folderId === folder.id);
            const isFolderOpen = !collapsedFolders[folder.id];
            const isEditingFolder = editingId === folder.id;

            return (
              <div key={folder.id} className="group/folder rounded-xl border border-border/50 bg-muted/15 overflow-hidden">
                <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs transition-colors hover:bg-muted/60">
                  <button
                    onClick={() => setCollapsedFolders((c) => ({ ...c, [folder.id]: isFolderOpen }))}
                    className="text-muted-foreground shrink-0 cursor-pointer"
                  >
                    <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-150", isFolderOpen && "rotate-90")} />
                  </button>
                  {isFolderOpen ? (
                    <FolderOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <FolderClosed className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}

                  {isEditingFolder ? (
                    <input
                      autoFocus
                      value={editingDraft}
                      onChange={(e) => setEditingDraft(e.target.value)}
                      onBlur={() => commitEditing("folder", folder.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEditing("folder", folder.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="min-w-0 flex-1 rounded border border-primary bg-background px-1.5 py-0.5 text-xs outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => setCollapsedFolders((c) => ({ ...c, [folder.id]: isFolderOpen }))}
                      className="min-w-0 flex-1 truncate text-left text-xs font-bold text-foreground cursor-pointer"
                    >
                      {folder.name}
                    </button>
                  )}

                  <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground">
                    {items.length}
                  </span>

                  {/* Botão Direto: Iniciar nova conversa nesta pasta */}
                  <SystemTooltip content={`Nova conversa em "${folder.name}"`}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCollapsedFolders((c) => ({ ...c, [folder.id]: false }));
                        onNewThread(folder.id);
                      }}
                      className="rounded-lg p-1 text-muted-foreground hover:bg-primary/15 hover:text-primary transition cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </SystemTooltip>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="rounded-lg p-1 text-muted-foreground hover:bg-background hover:text-foreground transition cursor-pointer"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52 z-50">
                      <DropdownMenuItem
                        onClick={() => {
                          setCollapsedFolders((c) => ({ ...c, [folder.id]: false }));
                          onNewThread(folder.id);
                        }}
                      >
                        <Plus className="h-3.5 w-3.5 mr-2 text-primary" /> Nova conversa nesta pasta
                      </DropdownMenuItem>
                      {activeThread && activeThread.folderId !== folder.id && (
                        <DropdownMenuItem
                          onClick={() => {
                            setCollapsedFolders((c) => ({ ...c, [folder.id]: false }));
                            onMoveThread(activeThread.id, folder.id);
                          }}
                        >
                          <FolderInput className="h-3.5 w-3.5 mr-2 text-primary" /> Trazer conversa atual para cá
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => startEditing(folder.id, folder.name)}>
                        <Pencil className="h-3.5 w-3.5 mr-2" /> Renomear pasta
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDeleteFolder(folder.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir pasta
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Itens dentro da Pasta */}
                {isFolderOpen && (
                  <div className="ml-3 border-l border-border/60 pl-1.5 pr-1 py-1 space-y-1 bg-card/40">
                    {items.length === 0 ? (
                      <div className="px-2 py-2 space-y-1.5">
                        <p className="text-[11px] text-muted-foreground/80">Nenhuma conversa nesta pasta</p>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => onNewThread(folder.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary/20 transition cursor-pointer"
                          >
                            <Plus className="h-3 w-3" /> Iniciar conversa aqui
                          </button>
                          {activeThread && activeThread.folderId !== folder.id && (
                            <button
                              type="button"
                              onClick={() => onMoveThread(activeThread.id, folder.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/50 px-2 py-1 text-[10px] font-bold text-foreground hover:border-primary/40 hover:text-primary transition cursor-pointer"
                            >
                              <FolderInput className="h-3 w-3" /> Mover atual para cá
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      items.map((thread) => renderThreadItem(thread, true))
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Loose Threads (Sem pasta) */}
          {looseThreads.length > 0 && (
            <div className="space-y-0.5 pt-1">
              {folders.length > 0 && (
                <p className="px-2.5 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                  Conversas sem pasta
                </p>
              )}
              {looseThreads.map((thread) => renderThreadItem(thread, false))}
            </div>
          )}
        </nav>
      </aside>
    </>
  );

  function renderThreadItem(thread: ValentinaThread, isInsideFolder: boolean) {
    const isActive = activeThreadId === thread.id;
    const isEditingThread = editingId === thread.id;

    return (
      <div
        key={thread.id}
        className={cn(
          "group/item flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs transition-colors relative",
          isActive ? "bg-primary-soft text-primary font-bold shadow-xs" : "hover:bg-muted/60 text-foreground"
        )}
      >
        <MessageSquare className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />

        {isEditingThread ? (
          <input
            autoFocus
            value={editingDraft}
            onChange={(e) => setEditingDraft(e.target.value)}
            onBlur={() => commitEditing("thread", thread.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEditing("thread", thread.id);
              if (e.key === "Escape") setEditingId(null);
            }}
            className="min-w-0 flex-1 rounded border border-primary bg-background px-1.5 py-0.5 text-xs outline-none"
          />
        ) : (
          <button
            onClick={() => onSelectThread(thread.id)}
            className="min-w-0 flex-1 truncate text-left text-xs cursor-pointer"
          >
            {thread.title}
          </button>
        )}

        <span className="shrink-0 text-[10px] text-muted-foreground group-hover/item:hidden">
          {relativeTime(thread.updatedAt)}
        </span>

        {/* Ação Rápida de Pasta Direta no Item */}
        <div className="hidden group-hover/item:flex items-center gap-0.5 shrink-0">
          {isInsideFolder && (
            <SystemTooltip content="Remover da pasta">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveThread(thread.id, null);
                }}
                className="rounded-lg p-1 text-muted-foreground hover:bg-background hover:text-amber-500 transition cursor-pointer"
              >
                <FolderOutput className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded-lg p-1 text-muted-foreground hover:bg-background hover:text-foreground transition cursor-pointer"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 z-50">
              <DropdownMenuItem onClick={() => startEditing(thread.id, thread.title)}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> Renomear conversa
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase font-bold text-muted-foreground">
                Organizar em Pasta
              </DropdownMenuLabel>
              {thread.folderId && (
                <DropdownMenuItem
                  onClick={() => onMoveThread(thread.id, null)}
                  className="text-amber-600 dark:text-amber-400 font-semibold"
                >
                  <FolderOutput className="h-3.5 w-3.5 mr-2" /> Remover da pasta atual
                </DropdownMenuItem>
              )}
              {folders.map((f) => {
                const isCurrentFolder = thread.folderId === f.id;
                return (
                  <DropdownMenuItem
                    key={f.id}
                    onClick={() => onMoveThread(thread.id, isCurrentFolder ? null : f.id)}
                    className={cn(isCurrentFolder && "font-bold text-primary")}
                  >
                    <FolderClosed className="h-3.5 w-3.5 mr-2 text-primary" />
                    <span className="flex-1 truncate">{f.name}</span>
                    {isCurrentFolder && <Check className="h-3.5 w-3.5 ml-1 text-primary" />}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuItem
                onClick={() => openCreateFolderModal(thread.id)}
                className="text-primary font-semibold"
              >
                <FolderPlus className="h-3.5 w-3.5 mr-2" /> + Nova pasta e mover...
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDeleteThread(thread.id)}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir conversa
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }
}
