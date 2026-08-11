// ══════════════════════════════════════════════════════════════════════════════
// 📑 VALENTINA THREAD RAIL — Barra lateral retrátil de histórico de conversas (Lado Direito)
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from "react";
import {
  MessageSquare, Plus, Search, FolderPlus, FolderClosed, FolderOpen,
  ChevronRight, MoreHorizontal, Pencil, Trash2, PanelRightClose, PanelRightOpen, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ValentinaThread, ValentinaFolder } from "./valentina-chat-types";

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
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, newName: string) => void;
  onDeleteFolder: (folderId: string) => void;
}

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

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? threads.filter((t) => t.title.toLowerCase().includes(q)) : threads;
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [threads, query]);

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

  // Se minimizado: renderiza botão colapsado na margem direita
  if (!isOpen) {
    return (
      <button
        onClick={onToggleOpen}
        title="Abrir histórico de conversas"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-card border border-border/80 text-muted-foreground text-xs font-bold hover:text-foreground hover:bg-muted/80 shadow-sm transition-all cursor-pointer"
      >
        <History className="h-3.5 w-3.5 text-primary" />
        <span>Histórico</span>
        <PanelRightOpen className="h-3.5 w-3.5 ml-0.5" />
      </button>
    );
  }

  const looseThreads = filteredThreads.filter(
    (t) => !t.folderId || !folders.some((f) => f.id === t.folderId)
  );

  return (
    <aside className="w-72 shrink-0 flex flex-col h-full rounded-2xl border border-border bg-card shadow-card overflow-hidden transition-all duration-200">
      {/* Header da Barra Lateral */}
      <div className="flex items-center justify-between border-b border-border/80 px-3.5 py-3 bg-muted/20">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-bold text-foreground">Histórico</h3>
        </div>
        <button
          onClick={onToggleOpen}
          title="Recolher histórico"
          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* Ações de Nova Conversa + Busca */}
      <div className="space-y-2.5 p-3 border-b border-border/60 bg-card">
        <button
          type="button"
          onClick={() => onNewThread(null)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground shadow-sm transition-all hover:opacity-90 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Nova Conversa
        </button>

        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-2.5 py-1.5 focus-within:border-primary/60 transition">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar conversas..."
            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
      </div>

      {/* Título de Pastas e Conversas */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-1">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
          Minhas Conversas
        </span>
        <button
          type="button"
          title="Criar nova pasta"
          onClick={() => {
            const folderName = prompt("Nome da nova pasta:", "Nova Pasta");
            if (folderName?.trim()) onCreateFolder(folderName.trim());
          }}
          className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Lista de Pastas e Threads */}
      <nav className="flex-1 overflow-y-auto px-2 pb-3 pt-1 space-y-1">
        {threads.length === 0 && folders.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">Nenhuma conversa salva.</p>
        ) : null}

        {/* Pastas */}
        {folders.map((folder) => {
          const items = filteredThreads.filter((t) => t.folderId === folder.id);
          const isFolderOpen = !collapsedFolders[folder.id];
          const isEditingFolder = editingId === folder.id;

          return (
            <div key={folder.id} className="group/folder">
              <div className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-xs transition-colors hover:bg-muted/60">
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
                    className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-foreground cursor-pointer"
                  >
                    {folder.name}
                  </button>
                )}

                <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground">
                  {items.length}
                </span>

                <DropdownMenu>
                  <DropdownMenuTrigger className="opacity-0 group-hover/folder:opacity-100 rounded-lg p-1 text-muted-foreground hover:bg-background hover:text-foreground transition cursor-pointer">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40 z-50">
                    <DropdownMenuItem onClick={() => startEditing(folder.id, folder.name)}>
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Renomear
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeleteFolder(folder.id)}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Itens dentro da Pasta */}
              {isFolderOpen && (
                <div className="ml-4 border-l border-border/60 pl-1 my-0.5 space-y-0.5">
                  {items.length === 0 ? (
                    <p className="px-2 py-1 text-[11px] text-muted-foreground/70">Pasta vazia</p>
                  ) : (
                    items.map((thread) => renderThreadItem(thread))
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Loose Threads (Sem pasta) */}
        {looseThreads.length > 0 && (
          <div className="space-y-0.5">
            {folders.length > 0 && (
              <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                Sem Pasta
              </p>
            )}
            {looseThreads.map((thread) => renderThreadItem(thread))}
          </div>
        )}
      </nav>
    </aside>
  );

  function renderThreadItem(thread: ValentinaThread) {
    const isActive = activeThreadId === thread.id;
    const isEditingThread = editingId === thread.id;

    return (
      <div
        key={thread.id}
        className={cn(
          "group/item flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs transition-colors relative",
          isActive ? "bg-primary-soft text-primary font-bold shadow-xs" : "hover:bg-muted/60 text-foreground",
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

        <DropdownMenu>
          <DropdownMenuTrigger className="opacity-0 group-hover/item:opacity-100 rounded-lg p-1 text-muted-foreground hover:bg-background hover:text-foreground transition cursor-pointer">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 z-50">
            <DropdownMenuItem onClick={() => startEditing(thread.id, thread.title)}>
              <Pencil className="h-3.5 w-3.5 mr-2" /> Renomear
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase font-bold text-muted-foreground">Mover para</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onMoveThread(thread.id, null)}>Sem pasta</DropdownMenuItem>
            {folders.map((f) => (
              <DropdownMenuItem key={f.id} onClick={() => onMoveThread(thread.id, f.id)}>
                {f.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeleteThread(thread.id)}>
              <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }
}
