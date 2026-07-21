// ══════════════════════════════════════════════════════════════════════════════
// 📚 KNOWLEDGE BASE TAB — Gerenciamento de arquivos e pastas da Valentina
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useRef } from "react";
import { 
  Folder, FolderPlus, Edit3, Trash2, ChevronDown, ChevronRight,
  Brain, Paperclip, UploadCloud, FileText, Image as ImageIcon, Check, X
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { 
  Folder as FolderType, 
  KnowledgeFile as FileType, 
  INITIAL_FOLDERS, 
  INITIAL_KNOWLEDGE_FILES 
} from "./valentina-mock-data";

export function KnowledgeTab() {
  const { setSelectedChatId, setActiveView } = useChat();

  // ── States ──────────────────────────────────────────────────────────────────
  const [folders, setFolders] = useState<FolderType[]>(INITIAL_FOLDERS);
  const [files, setFiles] = useState<FileType[]>(INITIAL_KNOWLEDGE_FILES);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>("f-1");
  
  // Modals / Criação / Edição
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  
  // Drag & Drop
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  
  // Upload
  const [uploadMode, setUploadMode] = useState<"embeddings" | "real">("embeddings");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOverZone, setDragOverZone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Carregar Dados Reais da API no Inicio ─────────────────────────────────
  React.useEffect(() => {
    fetch("/api/valentina/knowledge?tenantId=valem")
      .then((res) => res.json())
      .then((data) => {
        if (data.folders) setFolders(data.folders);
        if (data.files) setFiles(data.files);
        if (data.folders && data.folders.length > 0 && !selectedFolderId) {
          setSelectedFolderId(data.folders[0].id);
        }
      })
      .catch((err) => console.warn("[KnowledgeTab] Erro ao carregar do servidor:", err));
  }, []);

  // ── Operações de Pasta ──────────────────────────────────────────────────────
  
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const newId = `f-${Date.now()}`;
    const newFolder: FolderType = {
      id: newId,
      name: newFolderName,
      parentId: selectedFolderId,
    };

    setFolders((prev) => [...prev, newFolder]);
    setNewFolderName("");
    setIsCreatingFolder(false);
    setSelectedFolderId(newId);

    try {
      await fetch("/api/valentina/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: "valem",
          action: "create_folder",
          id: newId,
          name: newFolderName,
          parentId: selectedFolderId,
        }),
      });
    } catch (err) {
      console.error("[KnowledgeTab] Erro ao criar pasta na API:", err);
    }
  };

  const handleRenameFolder = async (id: string) => {
    if (!editingFolderName.trim()) return;
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, name: editingFolderName } : f))
    );
    const targetFolder = folders.find((f) => f.id === id);
    setEditingFolderId(null);
    setEditingFolderName("");

    try {
      await fetch("/api/valentina/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: "valem",
          action: "update_folder",
          id,
          name: editingFolderName,
          parentId: targetFolder?.parentId || null,
        }),
      });
    } catch (err) {
      console.error("[KnowledgeTab] Erro ao renomear pasta na API:", err);
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta pasta e todos os seus arquivos?")) return;
    
    const getDescendants = (folderId: string): string[] => {
      const children = folders.filter((f) => f.parentId === folderId);
      return [folderId, ...children.flatMap((c) => getDescendants(c.id))];
    };

    const foldersToDelete = getDescendants(id);

    setFolders((prev) => prev.filter((f) => !foldersToDelete.includes(f.id)));
    setFiles((prev) => prev.filter((file) => !foldersToDelete.includes(file.folderId)));
    
    if (selectedFolderId && foldersToDelete.includes(selectedFolderId)) {
      setSelectedFolderId(null);
    }

    try {
      await fetch(`/api/valentina/knowledge?type=folder&id=${id}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.error("[KnowledgeTab] Erro ao deletar pasta na API:", err);
    }
  };

  // ── Drag and Drop Nativo (Pastas & Arquivos) ───────────────────────────────

  const isAncestor = (targetId: string, folderId: string): boolean => {
    let current = folders.find((f) => f.id === targetId);
    while (current) {
      if (current.parentId === folderId) return true;
      current = current.parentId ? folders.find((f) => f.id === current!.parentId) : undefined;
    }
    return false;
  };

  const handleFolderDragStart = (e: React.DragEvent, id: string) => {
    setDraggedFolderId(id);
    setDraggedFileId(null);
    e.dataTransfer.setData("text/plain", id);
  };

  const handleFileDragStart = (e: React.DragEvent, id: string) => {
    setDraggedFileId(id);
    setDraggedFolderId(null);
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleFolderDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    
    if (draggedFolderId) {
      if (draggedFolderId === targetId || isAncestor(targetId, draggedFolderId)) return;
      setFolders((prev) =>
        prev.map((f) => (f.id === draggedFolderId ? { ...f, parentId: targetId } : f))
      );
      setDraggedFolderId(null);
    } else if (draggedFileId) {
      setFiles((prev) =>
        prev.map((file) => (file.id === draggedFileId ? { ...file, folderId: targetId } : file))
      );
      setDraggedFileId(null);
    }
  };

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedFolderId) {
      setFolders((prev) =>
        prev.map((f) => (f.id === draggedFolderId ? { ...f, parentId: null } : f))
      );
      setDraggedFolderId(null);
    }
  };

  // ── Operações de Arquivo & Upload Real com Extração de Texto ──────────────

  const handleDeleteFile = async (id: string) => {
    setFiles((prev) => prev.filter((file) => file.id !== id));
    try {
      await fetch(`/api/valentina/knowledge?type=file&id=${id}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.error("[KnowledgeTab] Erro ao deletar arquivo na API:", err);
    }
  };

  const handleRealFileUpload = async (fileObj: File) => {
    if (!selectedFolderId) {
      alert("Por favor, selecione ou crie uma pasta primeiro.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(20);

    const fileName = fileObj.name;
    const fileSize = fileObj.size;
    const extension = fileName.split(".").pop()?.toLowerCase();

    let type: FileType["type"] = "txt";
    if (extension === "pdf") type = "pdf";
    else if (["doc", "docx"].includes(extension || "")) type = "word";
    else if (["png", "jpg", "jpeg", "webp"].includes(extension || "")) type = "image";

    const formattedSize = fileSize > 1024 * 1024
      ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
      : `${(fileSize / 1024).toFixed(0)} KB`;

    // Leitura do conteúdo de texto do arquivo
    let fileContent = "";
    try {
      fileContent = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string) || "");
        reader.onerror = () => resolve("");
        reader.readAsText(fileObj);
      });
    } catch (err) {
      console.warn("[KnowledgeTab] Erro ao ler arquivo como texto:", err);
    }

    setUploadProgress(60);

    try {
      const res = await fetch("/api/valentina/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: "valem",
          action: "upload_file",
          name: fileName,
          size: formattedSize,
          type,
          format: uploadMode,
          folderId: selectedFolderId,
          content: fileContent,
        }),
      });

      const data = await res.json();
      setUploadProgress(100);

      if (data.file) {
        setFiles((prev) => [...prev, data.file]);
      } else {
        const fallbackFile: FileType = {
          id: `kf-${Date.now()}`,
          name: fileName,
          size: formattedSize,
          type,
          format: uploadMode,
          uploadedAt: new Date().toLocaleDateString("pt-BR"),
          folderId: selectedFolderId,
        };
        setFiles((prev) => [...prev, fallbackFile]);
      }
    } catch (err) {
      console.error("[KnowledgeTab] Erro no upload para a API:", err);
    } finally {
      setTimeout(() => setIsUploading(false), 300);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleRealFileUpload(e.target.files[0]);
    }
  };

  const handleDropUpload = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverZone(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleRealFileUpload(e.dataTransfer.files[0]);
    }
  };


  // ── Render Helpers ──────────────────────────────────────────────────────────

  // Função recursiva para renderizar pastas em árvore hierárquica
  const renderFolders = (parentId: string | null, depth = 0) => {
    const currentFolders = folders.filter((f) => f.parentId === parentId);
    
    return currentFolders.map((folder) => {
      const isSelected = selectedFolderId === folder.id;
      const isEditing = editingFolderId === folder.id;
      const hasChildren = folders.some((f) => f.parentId === folder.id);

      return (
        <div key={folder.id} className="flex flex-col">
          <div
            draggable
            onDragStart={(e) => handleFolderDragStart(e, folder.id)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleFolderDrop(e, folder.id)}
            style={{ paddingLeft: `${depth * 14 + 12}px` }}
            className={`group flex items-center justify-between py-2 pr-3 rounded-xl transition duration-150 cursor-pointer select-none ${
              isSelected 
                ? "bg-primary-soft text-primary font-bold border-l-2 border-l-primary" 
                : "hover:bg-muted text-foreground/80 hover:text-foreground"
            }`}
            onClick={() => setSelectedFolderId(folder.id)}
          >
            <div className="flex items-center gap-2 min-w-0">
              {hasChildren ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/30" />
              )}
              <Folder className={`h-4.5 w-4.5 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
              
              {isEditing ? (
                <input
                  autoFocus
                  type="text"
                  value={editingFolderName}
                  onChange={(e) => setEditingFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameFolder(folder.id);
                    if (e.key === "Escape") setEditingFolderId(null);
                  }}
                  className="bg-card border border-primary text-xs rounded px-1.5 py-0.5 outline-none font-normal text-foreground"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="text-xs truncate font-medium">{folder.name}</span>
              )}
            </div>

            {/* Ações de Pasta */}
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0 transition-opacity duration-150">
              {isEditing ? (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRenameFolder(folder.id);
                    }}
                    className="p-1 rounded hover:bg-card text-green-600 cursor-pointer"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingFolderId(null);
                    }}
                    className="p-1 rounded hover:bg-card text-red-500 cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingFolderId(folder.id);
                      setEditingFolderName(folder.name);
                    }}
                    className="p-1 rounded hover:bg-card hover:text-foreground text-muted-foreground cursor-pointer"
                    title="Renomear"
                  >
                    <Edit3 className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFolder(folder.id);
                    }}
                    className="p-1 rounded hover:bg-card hover:text-red-500 text-muted-foreground cursor-pointer"
                    title="Excluir"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Subpastas recursivas */}
          {renderFolders(folder.id, depth + 1)}
        </div>
      );
    });
  };

  const getFileIcon = (type: FileType["type"]) => {
    switch (type) {
      case "pdf":
        return <FileText className="h-5 w-5 text-red-500 shrink-0" />;
      case "word":
        return <FileText className="h-5 w-5 text-blue-500 shrink-0" />;
      case "image":
        return <ImageIcon className="h-5 w-5 text-amber-500 shrink-0" />;
      default:
        return <FileText className="h-5 w-5 text-gray-500 shrink-0" />;
    }
  };

  const currentFolder = folders.find((f) => f.id === selectedFolderId);
  const currentFolderFiles = files.filter((file) => file.folderId === selectedFolderId);

  return (
    <div className="flex flex-1 overflow-hidden gap-4 min-h-0">
      
      {/* ── PAINEL ESQUERDO: Árvore de Diretórios (Pastas) ───────────────── */}
      <div className="w-[32%] bg-muted/20 border border-border/80 rounded-2xl flex flex-col p-4 min-h-0 select-none">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-border/60">
          <span className="text-xs font-black uppercase text-muted-foreground select-none">Diretórios</span>
          <button
            onClick={() => setIsCreatingFolder((v) => !v)}
            className="flex items-center gap-1 py-1 px-2.5 rounded-lg bg-primary hover:bg-primary/95 text-primary-foreground text-[10px] font-extrabold shadow-soft transition cursor-pointer"
          >
            <FolderPlus className="h-3 w-3" />
            <span>Nova Pasta</span>
          </button>
        </div>

        {/* Input de criação rápida de pasta */}
        {isCreatingFolder && (
          <div className="mb-3 p-3 bg-card border border-border rounded-xl flex items-center gap-2 shadow-soft animate-in slide-in-from-top-1 duration-150">
            <input
              autoFocus
              type="text"
              placeholder="Nome da pasta..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") setIsCreatingFolder(false);
              }}
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none border border-border rounded px-2 py-1"
            />
            <button
              onClick={handleCreateFolder}
              className="p-1 rounded bg-primary text-primary-foreground hover:opacity-90 cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setIsCreatingFolder(false)}
              className="p-1 rounded hover:bg-muted text-muted-foreground cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Lista de Pastas (Draggable Container) */}
        <div 
          onDragOver={handleDragOver}
          onDrop={handleRootDrop}
          className="flex-1 overflow-y-auto space-y-0.5 scrollbar-thin pr-1 min-h-0"
        >
          {folders.filter((f) => f.parentId === null).length === 0 && (
            <div className="text-center text-muted-foreground text-[11px] py-12">
              Nenhuma pasta criada.
            </div>
          )}
          {renderFolders(null)}
        </div>
        
        <div className="mt-3 p-2 bg-muted/40 rounded-xl text-[10px] text-muted-foreground text-center border border-border/50">
          💡 Dica: Arraste pastas ou arquivos para alterar sua hierarquia.
        </div>
      </div>

      {/* ── PAINEL DIREITO: Exploração de Arquivos & Upload ─────────────── */}
      <div className="flex-1 bg-card border border-border rounded-2xl flex flex-col p-5 min-h-0">
        
        {/* Cabeçalho da pasta ativa */}
        <div className="flex items-center justify-between mb-4 shrink-0 pb-2 border-b border-border/60">
          <div>
            <h2 className="text-sm font-black text-foreground flex items-center gap-1.5">
              <Folder className="h-4.5 w-4.5 text-primary shrink-0" />
              {currentFolder ? currentFolder.name : "Nenhuma pasta selecionada"}
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {currentFolderFiles.length} {currentFolderFiles.length === 1 ? "arquivo" : "arquivos"} nesta pasta
            </p>
          </div>

          {/* Formato de Upload selector */}
          <div className="flex items-center gap-1 bg-muted px-1.5 py-1 rounded-xl border border-border select-none shrink-0">
            <button
              onClick={() => setUploadMode("embeddings")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                uploadMode === "embeddings"
                  ? "bg-emerald-500 text-white shadow-soft"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Salva o arquivo como vetor de IA no cérebro da Valentina"
            >
              <Brain className="h-3 w-3" />
              <span>Embeddings</span>
            </button>
            <button
              onClick={() => setUploadMode("real")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                uploadMode === "real"
                  ? "bg-blue-600 text-white shadow-soft"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Salva o arquivo no formato real para Valentina enviar diretamente aos clientes"
            >
              <Paperclip className="h-3 w-3" />
              <span>Formato Real</span>
            </button>
          </div>
        </div>

        {/* Zona de Drop para upload */}
        {selectedFolderId ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverZone(true);
            }}
            onDragLeave={() => setDragOverZone(false)}
            onDrop={handleDropUpload}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center flex flex-col items-center justify-center transition cursor-pointer shrink-0 gap-2 ${
              dragOverZone 
                ? "border-primary bg-primary-soft/30" 
                : "border-border hover:border-primary/45 bg-muted/10 hover:bg-muted/20"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt,.md,.json,.csv"
              className="hidden"
            />
            {isUploading ? (
              <div className="w-full max-w-xs flex flex-col items-center gap-1.5 animate-in fade-in duration-200">
                <span className="text-[10px] font-extrabold text-primary uppercase animate-pulse">Enviando arquivo ({uploadProgress}%)</span>
                <div className="w-full bg-border rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-primary h-full rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <>
                <UploadCloud className="h-8 w-8 text-muted-foreground/60 animate-bounce duration-1000" />
                <div>
                  <p className="text-xs font-bold text-foreground">Arraste e solte arquivos aqui</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Suporta PDF, Word, TXT, Markdown (MD) e Imagens</p>
                </div>

                <div className="mt-1 px-3 py-1 rounded bg-card border border-border text-[9px] font-black uppercase text-primary">
                  {uploadMode === "embeddings" ? "Modo Ativo: Embedding de IA" : "Modo Ativo: Formato Real de Envio"}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="border border-border/80 bg-muted/20 rounded-2xl p-8 text-center text-xs text-muted-foreground select-none shrink-0 mb-4">
            Selecione uma pasta na árvore de diretórios ao lado para habilitar uploads.
          </div>
        )}

        {/* Lista de Arquivos */}
        <div className="flex-1 overflow-y-auto mt-4 scrollbar-thin min-h-0 pr-1 select-none">
          {selectedFolderId ? (
            currentFolderFiles.length === 0 ? (
              <div className="text-center text-muted-foreground/60 text-xs py-16">
                Pasta vazia. Suba arquivos acima ou arraste itens para cá!
              </div>
            ) : (
              <div className="space-y-2">
                {currentFolderFiles.map((file) => (
                  <div
                    draggable
                    onDragStart={(e) => handleFileDragStart(e, file.id)}
                    key={file.id}
                    className="group flex items-center justify-between p-3 rounded-xl border border-border bg-card hover:bg-muted/30 transition shadow-soft"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {getFileIcon(file.type)}
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold text-foreground truncate max-w-sm">{file.name}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {file.size} · Enviado em {file.uploadedAt}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {/* Badge do Formato */}
                      {file.format === "embeddings" ? (
                        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 border border-emerald-500/25 select-none" title="Armazenado no cérebro da IA para aprendizado">
                          <Brain className="h-2.5 w-2.5" />
                          <span>Embedding</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-600 border border-blue-500/25 select-none" title="Arquivo real disponível para envio direto aos clientes">
                          <Paperclip className="h-2.5 w-2.5" />
                          <span>Real</span>
                        </span>
                      )}

                      <button
                        onClick={() => handleDeleteFile(file.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-muted hover:text-red-500 text-muted-foreground transition cursor-pointer"
                        title="Remover arquivo"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="text-center text-muted-foreground/60 text-xs py-16">
              Selecione um diretório para navegar nos arquivos.
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
