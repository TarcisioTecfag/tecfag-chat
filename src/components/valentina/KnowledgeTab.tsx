// ══════════════════════════════════════════════════════════════════════════════
// 📚 KNOWLEDGE BASE TAB — Gerenciamento de arquivos e pastas da Valentina
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useCallback } from "react";
import { 
  Folder, FolderPlus, FolderUp, Edit3, Trash2, ChevronDown, ChevronRight,
  Brain, Paperclip, UploadCloud, FileText, Image as ImageIcon, Check, X,
  Eye, Sparkles, BookOpen, Loader2, ListChecks, Lightbulb
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { 
  Folder as FolderType, 
  KnowledgeFile as FileType,
} from "./valentina-mock-data";

interface UploadQueueItem {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
}

export function KnowledgeTab() {
  const { setSelectedChatId, setActiveView } = useChat();

  // ── States ──────────────────────────────────────────────────────────────────
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [files, setFiles] = useState<FileType[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [isLoadingFolders, setIsLoadingFolders] = useState(true);
  const [previewFile, setPreviewFile] = useState<FileType | null>(null);
  
  // Modals / Criação / Edição
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  
  // Drag & Drop
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  
  // Upload — Fila de Múltiplos Arquivos
  const [uploadMode, setUploadMode] = useState<"embeddings" | "real">("embeddings");
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [isQueueRunning, setIsQueueRunning] = useState(false);
  const [dragOverZone, setDragOverZone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const queueRunningRef = useRef(false);

  // Preview de imagem real (Formato Real)
  const [previewImageFile, setPreviewImageFile] = useState<FileType | null>(null);
  // Content carregado sob demanda (Ver RAG / Ver Foto) — não vem mais na listagem
  const [loadingContentId, setLoadingContentId] = useState<string | null>(null);
  const [loadedContent, setLoadedContent] = useState<Record<string, string>>({});

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  /** Busca o `content` de um arquivo específico sob demanda (Ver RAG ou Ver Foto). */
  async function fetchFileContent(fileId: string): Promise<string> {
    if (loadedContent[fileId] !== undefined) return loadedContent[fileId];
    setLoadingContentId(fileId);
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/valentina/knowledge?tenantId=valem&action=getContent&fileId=${fileId}`
      );
      const data = await res.json();
      const c = data.content || "";
      setLoadedContent((prev) => ({ ...prev, [fileId]: c }));
      return c;
    } catch {
      return "";
    } finally {
      setLoadingContentId(null);
    }
  }


  // ── Carregar Dados Reais da API no Inicio ─────────────────────────────────
  React.useEffect(() => {
    setIsLoadingFolders(true);
    fetch(`${BACKEND_URL}/api/valentina/knowledge?tenantId=valem`)
      .then((res) => res.json())
      .then((data) => {
        if (data.folders) {
          setFolders(data.folders);
          // Expande todas as pastas que possuem filhos ou são raiz por padrão
          const expanded = new Set<string>();
          data.folders.forEach((f: FolderType) => {
            if (f.parentId === null) expanded.add(f.id);
            if (f.parentId) expanded.add(f.parentId);
          });
          setExpandedFolderIds(expanded);
        }
        if (data.files) setFiles(data.files);
        if (data.folders && data.folders.length > 0) {
          setSelectedFolderId(data.folders[0].id);
        }
      })
      .catch((err) => console.warn("[KnowledgeTab] Erro ao carregar do servidor:", err))
      .finally(() => setIsLoadingFolders(false));
  }, []);

  const toggleFolderExpanded = (folderId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

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
    if (selectedFolderId) {
      setExpandedFolderIds((prev) => new Set(prev).add(selectedFolderId));
    }
    setNewFolderName("");
    setIsCreatingFolder(false);
    setSelectedFolderId(newId);

    try {
      await fetch(`${BACKEND_URL}/api/valentina/knowledge`, {
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
      await fetch(`${BACKEND_URL}/api/valentina/knowledge`, {
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
      await fetch(`${BACKEND_URL}/api/valentina/knowledge?type=folder&id=${id}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.error("[KnowledgeTab] Erro ao deletar pasta na API:", err);
    }
  };

  // ── Drag and Drop Nativo com Persistência no Banco ──────────────────────────

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

  const handleFolderDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    
    if (draggedFolderId) {
      if (draggedFolderId === targetId || isAncestor(targetId, draggedFolderId)) return;
      const folderId = draggedFolderId;
      const folderToMove = folders.find((f) => f.id === folderId);

      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, parentId: targetId } : f))
      );
      setExpandedFolderIds((prev) => new Set(prev).add(targetId));
      setDraggedFolderId(null);

      // Persistir mudança de hierarquia de pasta na API
      try {
        await fetch(`${BACKEND_URL}/api/valentina/knowledge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: "valem",
            action: "update_folder",
            id: folderId,
            name: folderToMove?.name || "Pasta",
            parentId: targetId,
          }),
        });
      } catch (err) {
        console.error("[KnowledgeTab] Erro ao salvar movimentação de pasta na API:", err);
      }
    } else if (draggedFileId) {
      const fileId = draggedFileId;
      setFiles((prev) =>
        prev.map((file) => (file.id === fileId ? { ...file, folderId: targetId } : file))
      );
      setDraggedFileId(null);

      // Persistir mudança de pasta do arquivo na API
      try {
        await fetch(`${BACKEND_URL}/api/valentina/knowledge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: "valem",
            action: "move_file",
            id: fileId,
            folderId: targetId,
          }),
        });
      } catch (err) {
        console.error("[KnowledgeTab] Erro ao salvar movimentação de arquivo na API:", err);
      }
    }
  };

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedFolderId) {
      const folderId = draggedFolderId;
      const folderToMove = folders.find((f) => f.id === folderId);

      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, parentId: null } : f))
      );
      setDraggedFolderId(null);

      // Persistir mudança para a raiz na API
      try {
        await fetch(`${BACKEND_URL}/api/valentina/knowledge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: "valem",
            action: "update_folder",
            id: folderId,
            name: folderToMove?.name || "Pasta",
            parentId: null,
          }),
        });
      } catch (err) {
        console.error("[KnowledgeTab] Erro ao mover pasta para raiz na API:", err);
      }
    }
  };

  // ── Upload de Pasta Completa (com hierarquia) ────────────────────────────────

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    if (!selectedFolderId) {
      alert("Por favor, selecione ou crie uma pasta destino primeiro.");
      return;
    }

    const allFiles = Array.from(e.target.files);
    e.target.value = ""; // reset input

    // Mapeia cada caminho relativo de pasta → ID no backend
    const folderPathToId = new Map<string, string>();
    folderPathToId.set("", selectedFolderId); // raiz = pasta selecionada

    // Coleta todos os caminhos de pasta únicos (ordenados por profundidade)
    const folderPaths = new Set<string>();
    for (const file of allFiles) {
      const parts = file.webkitRelativePath.split("/");
      // parts[0] = nome da pasta raiz que o usuário selecionou, partes[N-1] = arquivo
      for (let depth = 1; depth < parts.length - 1; depth++) {
        folderPaths.add(parts.slice(0, depth + 1).join("/"));
      }
    }

    // Cria as pastas em ordem de profundidade (mais rasas primeiro)
    const sortedPaths = Array.from(folderPaths).sort(
      (a, b) => a.split("/").length - b.split("/").length
    );

    for (const folderPath of sortedPaths) {
      const parts = folderPath.split("/");
      const folderName = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join("/");
      const parentId = folderPathToId.get(parentPath) || selectedFolderId;

      const newId = `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      folderPathToId.set(folderPath, newId);

      const newFolder: FolderType = { id: newId, name: folderName, parentId };
      setFolders(prev => [...prev, newFolder]);
      setExpandedFolderIds(prev => new Set(prev).add(parentId));

      try {
        await fetch(`${BACKEND_URL}/api/valentina/knowledge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: "valem",
            action: "create_folder",
            id: newId,
            name: folderName,
            parentId,
          }),
        });
      } catch (err) {
        console.error("[KnowledgeTab] Erro ao criar subpasta:", err);
      }
    }

    // Agora enfileira os arquivos para upload, cada um para sua pasta correta
    const newItems: UploadQueueItem[] = [];
    const originalSelectedFolderId = selectedFolderId;

    for (const file of allFiles) {
      const parts = file.webkitRelativePath.split("/");
      // A pasta destino é o penúltimo segmento do caminho
      const fileFolderPath = parts.slice(0, -1).join("/");
      const targetFolderId = folderPathToId.get(fileFolderPath) || originalSelectedFolderId;

      newItems.push({ file, status: "pending", progress: 0, _targetFolderId: targetFolderId } as any);
    }

    setUploadQueue(prev => {
      const combined = [...prev, ...newItems];
      setTimeout(() => runUploadQueueWithFolderIds(combined), 0);
      return combined;
    });
  };

  // Versão do runUploadQueue que respeita _targetFolderId por item
  const runUploadQueueWithFolderIds = useCallback(async (queue: (UploadQueueItem & { _targetFolderId?: string })[]) => {
    if (queueRunningRef.current) return;
    queueRunningRef.current = true;
    setIsQueueRunning(true);

    for (let i = 0; i < queue.length; i++) {
      if (queue[i].status !== "pending") continue;

      setUploadQueue(prev => prev.map((item, idx) =>
        idx === i ? { ...item, status: "uploading", progress: 30 } : item
      ));

      const targetFolderId = (queue[i] as any)._targetFolderId || selectedFolderId;

      try {
        const savedFile = await uploadSingleFileToFolder(queue[i].file, targetFolderId);
        if (savedFile) setFiles(prev => [...prev, savedFile]);
        setUploadQueue(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: "done", progress: 100 } : item
        ));
      } catch (err: any) {
        setUploadQueue(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: "error", progress: 0, error: err.message } : item
        ));
      }

      await new Promise(r => setTimeout(r, 150));
    }

    queueRunningRef.current = false;
    setIsQueueRunning(false);
  }, [selectedFolderId, uploadMode, BACKEND_URL]);

  // Versão de uploadSingleFile que aceita folderId explícito
  const uploadSingleFileToFolder = async (fileObj: File, folderId: string | null): Promise<FileType | null> => {
    const fileName = fileObj.name;
    const fileSize = fileObj.size;
    const extension = fileName.split(".").pop()?.toLowerCase() || "";

    let type: FileType["type"] = "txt";
    if (extension === "pdf") type = "pdf";
    else if (["doc", "docx"].includes(extension)) type = "word";
    else if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) type = "image";

    const formattedSize = fileSize > 1024 * 1024
      ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
      : `${(fileSize / 1024).toFixed(0)} KB`;

    let fileContent = "";
    let base64Data: string | null = null;

    if (type === "txt" || ["md", "json", "csv", "tsv"].includes(extension)) {
      fileContent = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string) || "");
        reader.onerror = () => resolve("");
        reader.readAsText(fileObj);
      });
    } else {
      base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const res = (e.target?.result as string) || "";
          const commaIdx = res.indexOf(",");
          resolve(commaIdx !== -1 ? res.slice(commaIdx + 1) : res);
        };
        reader.onerror = () => resolve("");
        reader.readAsDataURL(fileObj);
      });
    }

    const res = await fetch(`${BACKEND_URL}/api/valentina/knowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "valem",
        action: "upload_file",
        name: fileName,
        size: formattedSize,
        type,
        format: uploadMode,
        folderId,
        content: fileContent || null,
        base64: base64Data,
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.file || null;
  };

  // ── Operações de Arquivo ─────────────────────────────────────────────────────

  const handleDeleteFile = async (id: string) => {
    setFiles((prev) => prev.filter((file) => file.id !== id));
    try {
      await fetch(`${BACKEND_URL}/api/valentina/knowledge?type=file&id=${id}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.error("[KnowledgeTab] Erro ao deletar arquivo na API:", err);
    }
  };

  // ── Upload em Fila de Múltiplos Arquivos ────────────────────────────────────

  const uploadSingleFile = async (fileObj: File, queueIdx: number): Promise<FileType | null> => {
    const fileName = fileObj.name;
    const fileSize = fileObj.size;
    const extension = fileName.split(".").pop()?.toLowerCase() || "";

    let type: FileType["type"] = "txt";
    if (extension === "pdf") type = "pdf";
    else if (["doc", "docx"].includes(extension)) type = "word";
    else if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) type = "image";

    const formattedSize = fileSize > 1024 * 1024
      ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
      : `${(fileSize / 1024).toFixed(0)} KB`;

    let fileContent = "";
    let base64Data: string | null = null;

    if (type === "txt" || ["md", "json", "csv", "tsv"].includes(extension)) {
      fileContent = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string) || "");
        reader.onerror = () => resolve("");
        reader.readAsText(fileObj);
      });
    } else {
      base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const res = (e.target?.result as string) || "";
          const commaIdx = res.indexOf(",");
          resolve(commaIdx !== -1 ? res.slice(commaIdx + 1) : res);
        };
        reader.onerror = () => resolve("");
        reader.readAsDataURL(fileObj);
      });
    }

    const res = await fetch(`${BACKEND_URL}/api/valentina/knowledge`, {
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
        content: fileContent || null,
        base64: base64Data,
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.file || null;
  };

  const runUploadQueue = useCallback(async (queue: UploadQueueItem[]) => {
    if (queueRunningRef.current) return;
    queueRunningRef.current = true;
    setIsQueueRunning(true);

    for (let i = 0; i < queue.length; i++) {
      if (queue[i].status !== "pending") continue;

      setUploadQueue(prev => prev.map((item, idx) =>
        idx === i ? { ...item, status: "uploading", progress: 30 } : item
      ));

      try {
        const savedFile = await uploadSingleFile(queue[i].file, i);
        if (savedFile) {
          setFiles(prev => [...prev, savedFile]);
        }
        setUploadQueue(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: "done", progress: 100 } : item
        ));
      } catch (err: any) {
        setUploadQueue(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: "error", progress: 0, error: err.message } : item
        ));
      }

      // Pequeno delay entre uploads para não sobrecarregar o servidor
      await new Promise(r => setTimeout(r, 150));
    }

    queueRunningRef.current = false;
    setIsQueueRunning(false);
  }, [selectedFolderId, uploadMode, BACKEND_URL]);

  const enqueueFiles = useCallback((fileList: FileList | File[]) => {
    if (!selectedFolderId) {
      alert("Por favor, selecione ou crie uma pasta primeiro.");
      return;
    }

    const newItems: UploadQueueItem[] = Array.from(fileList).map(file => ({
      file,
      status: "pending",
      progress: 0,
    }));

    setUploadQueue(prev => {
      const combined = [...prev, ...newItems];
      // Dispara a fila com o array combinado atual
      setTimeout(() => runUploadQueue(combined), 0);
      return combined;
    });
  }, [selectedFolderId, runUploadQueue]);

  const clearQueue = () => {
    if (!isQueueRunning) {
      setUploadQueue([]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      enqueueFiles(e.target.files);
      e.target.value = ""; // Reset input para permitir selecionar os mesmos arquivos novamente
    }
  };

  const handleDropUpload = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverZone(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      enqueueFiles(e.dataTransfer.files);
    }
  };


  // ── Render Helpers ──────────────────────────────────────────────────────────

  // Função recursiva para renderizar pastas em árvore hierárquica com expandir/recolher
  const renderFolders = (parentId: string | null, depth = 0) => {
    const currentFolders = folders.filter((f) => f.parentId === parentId);
    
    return currentFolders.map((folder) => {
      const isSelected = selectedFolderId === folder.id;
      const isEditing = editingFolderId === folder.id;
      const hasChildren = folders.some((f) => f.parentId === folder.id);
      const isExpanded = expandedFolderIds.has(folder.id);

      return (
        <div key={folder.id} className="flex flex-col">
          <div
            draggable
            onDragStart={(e) => handleFolderDragStart(e, folder.id)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleFolderDrop(e, folder.id)}
            style={{ paddingLeft: `${depth * 14 + 10}px` }}
            className={`group flex items-center justify-between py-2 pr-3 rounded-xl transition duration-150 cursor-pointer select-none ${
              isSelected 
                ? "bg-primary-soft text-primary font-bold border-l-2 border-l-primary" 
                : "hover:bg-muted text-foreground/80 hover:text-foreground"
            }`}
            onClick={() => setSelectedFolderId(folder.id)}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {hasChildren ? (
                <button
                  type="button"
                  onClick={(e) => toggleFolderExpanded(folder.id, e)}
                  className="p-1 -ml-1 rounded-md hover:bg-muted-foreground/15 text-muted-foreground/70 hover:text-foreground transition cursor-pointer"
                  title={isExpanded ? "Recolher subpastas" : "Expandir subpastas"}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  )}
                </button>
              ) : (
                <span className="w-5 shrink-0" />
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
                    className="p-1 rounded hover:bg-card text-emerald-600 cursor-pointer"
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

          {/* Subpastas recursivas — apenas renderiza quando a pasta pai estiver expandida */}
          {hasChildren && isExpanded && renderFolders(folder.id, depth + 1)}
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
          <div className="flex items-center gap-1">
            {/* Subir Pasta */}
            <button
              onClick={() => folderInputRef.current?.click()}
              className="flex items-center gap-1 py-1 px-2.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground/80 hover:text-foreground text-[10px] font-extrabold shadow-soft transition cursor-pointer border border-border"
              title="Importa uma pasta do seu computador mantendo a hierarquia de subpastas"
            >
              <FolderUp className="h-3 w-3" />
              <span>Subir Pasta</span>
            </button>
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              // @ts-ignore — atributo não-padrão mas suportado por todos os browsers modernos
              webkitdirectory=""
              multiple
              onChange={handleFolderUpload}
            />
            {/* Nova Pasta */}
            <button
              onClick={() => setIsCreatingFolder((v) => !v)}
              className="flex items-center gap-1 py-1 px-2.5 rounded-lg bg-primary hover:bg-primary/95 text-primary-foreground text-[10px] font-extrabold shadow-soft transition cursor-pointer"
            >
              <FolderPlus className="h-3 w-3" />
              <span>Nova Pasta</span>
            </button>
          </div>
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
          {isLoadingFolders ? (
            <div className="space-y-2 pt-2">
              {[1,2,3].map(i => (
                <div key={i} className="h-8 bg-muted/40 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : folders.filter((f) => f.parentId === null).length === 0 ? (
            <div className="text-center text-muted-foreground text-[11px] py-12">
              Nenhuma pasta criada.
            </div>
          ) : renderFolders(null)}
        </div>
        
        <div className="mt-3 p-2 bg-muted/40 rounded-xl text-[10px] text-muted-foreground flex items-center justify-center gap-1.5 border border-border/50">
          <Lightbulb className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>Dica: Arraste pastas ou arquivos para alterar sua hierarquia.</span>
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

          {/* Formato de Upload selector com harmonia verde visual */}
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border select-none shrink-0">
            <button
              onClick={() => setUploadMode("embeddings")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-extrabold transition cursor-pointer ${
                uploadMode === "embeddings"
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              title="Salva o arquivo como vetor de IA no cérebro da Valentina"
            >
              <Brain className="h-3.5 w-3.5" />
              <span>Embeddings</span>
            </button>
            <button
              onClick={() => setUploadMode("real")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-extrabold transition cursor-pointer ${
                uploadMode === "real"
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              title="Salva o arquivo no formato real para Valentina enviar diretamente aos clientes"
            >
              <Paperclip className="h-3.5 w-3.5" />
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
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.json,.csv,.xlsx,.xls"
              className="hidden"
              multiple
            />
            <UploadCloud className="h-8 w-8 text-muted-foreground/60 animate-bounce duration-1000" />
            <div>
              <p className="text-xs font-bold text-foreground">Arraste e solte arquivos aqui</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Suporta múltiplos arquivos · PDF, Word, TXT, Markdown (MD), Planilhas e Imagens</p>
            </div>

            <div className="mt-1 px-3 py-1 rounded bg-card border border-border text-[9px] font-black uppercase text-primary">
              {uploadMode === "embeddings" ? "Modo Ativo: Embedding de IA" : "Modo Ativo: Formato Real de Envio"}
            </div>
          </div>
        ) : (
          <div className="border border-border/80 bg-muted/20 rounded-2xl p-8 text-center text-xs text-muted-foreground select-none shrink-0 mb-4">
            Selecione uma pasta na árvore de diretórios ao lado para habilitar uploads.
          </div>
        )}

        {/* Painel de Fila de Upload */}
        {uploadQueue.length > 0 && (
          <div className="mt-3 rounded-xl border border-border bg-card overflow-hidden shrink-0">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
              <div className="flex items-center gap-1.5 text-[10px] font-black text-foreground uppercase">
                <ListChecks className="h-3.5 w-3.5 text-primary" />
                <span>Fila de Upload</span>
                <span className="text-muted-foreground font-normal">
                  ({uploadQueue.filter(i => i.status === "done").length}/{uploadQueue.length} concluídos)
                </span>
              </div>
              {!isQueueRunning && (
                <button
                  onClick={clearQueue}
                  className="text-[9px] text-muted-foreground hover:text-foreground transition px-2 py-0.5 rounded hover:bg-muted cursor-pointer"
                >
                  Limpar
                </button>
              )}
            </div>
            <div className="max-h-40 overflow-y-auto scrollbar-thin divide-y divide-border/50">
              {uploadQueue.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 px-3 py-1.5">
                  {item.status === "done" && <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                  {item.status === "error" && <X className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                  {item.status === "uploading" && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />}
                  {item.status === "pending" && <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-foreground truncate font-medium">{item.file.name}</p>
                    {item.status === "uploading" && (
                      <div className="w-full bg-border rounded-full h-0.5 mt-0.5 overflow-hidden">
                        <div className="bg-primary h-full rounded-full transition-all duration-300 animate-pulse" style={{ width: "60%" }} />
                      </div>
                    )}
                    {item.status === "error" && (
                      <p className="text-[9px] text-red-500 truncate">{item.error}</p>
                    )}
                  </div>
                  <span className={`text-[9px] shrink-0 font-bold ${
                    item.status === "done" ? "text-emerald-500" :
                    item.status === "error" ? "text-red-500" :
                    item.status === "uploading" ? "text-primary animate-pulse" :
                    "text-muted-foreground"
                  }`}>
                    {item.status === "done" ? "OK" :
                     item.status === "error" ? "ERRO" :
                     item.status === "uploading" ? "↑" : "..."}
                  </span>
                </div>
              ))}
            </div>
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

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Botão de Ver Conteúdo Extraído (RAG Inspector) */}
                      <button
                        type="button"
                        disabled={loadingContentId === file.id}
                        onClick={async () => {
                          const content = await fetchFileContent(file.id);
                          setPreviewFile({ ...file, content } as any);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-card border border-border hover:border-primary/40 hover:bg-primary-soft/40 text-[10px] font-bold text-foreground hover:text-primary transition cursor-pointer shadow-soft disabled:opacity-50"
                        title="Ver o texto que a IA aprendeu deste arquivo"
                      >
                        {loadingContentId === file.id
                          ? <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          : <Eye className="h-3 w-3 text-primary" />
                        }
                        <span>Ver RAG</span>
                      </button>

                      {/* Botão Ver Foto — apenas para Formato Real + imagem */}
                      {file.format === "real" && file.type === "image" && (
                        <button
                          type="button"
                          disabled={loadingContentId === file.id}
                          onClick={async () => {
                            const content = await fetchFileContent(file.id);
                            setPreviewImageFile({ ...file, content } as any);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-card border border-border hover:border-amber-400/60 hover:bg-amber-50/40 dark:hover:bg-amber-900/20 text-[10px] font-bold text-foreground hover:text-amber-600 transition cursor-pointer shadow-soft disabled:opacity-50"
                          title="Visualizar a imagem real que a Valentina envia"
                        >
                          {loadingContentId === file.id
                            ? <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                            : <ImageIcon className="h-3 w-3 text-amber-500" />
                          }
                          <span>Ver Foto</span>
                        </button>
                      )}

                      {/* Badge do Formato em Harmonia Verde */}
                      {file.format === "embeddings" ? (
                        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-primary-soft text-primary border border-primary/25 select-none" title="Armazenado no cérebro da IA para aprendizado">
                          <Brain className="h-2.5 w-2.5" />
                          <span>Embedding</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-primary-soft/60 text-primary/80 border border-primary/20 select-none" title="Arquivo real disponível para envio direto aos clientes">
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

      {/* ── MODAL: Visualizador de Conteúdo Extraído (RAG Inspector) ─────────── */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-primary-soft text-primary flex items-center justify-center flex-shrink-0 border border-primary/20">
                  <BookOpen className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-extrabold text-foreground truncate">{previewFile.name}</h3>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                      <Sparkles className="w-2.5 h-2.5" /> Ativo no Cérebro da IA
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {previewFile.size} · Extração de Texto para Gemini & Telefonia
                  </p>
                </div>
              </div>

              <button
                onClick={() => setPreviewFile(null)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Conteúdo de Texto Extraído */}
            <div className="p-4 flex-1 overflow-y-auto min-h-0 bg-background/50 font-mono text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap select-text scrollbar-thin">
              {previewFile.content && previewFile.content.trim().length > 0 ? (
                previewFile.content
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-xs gap-2">
                  <FileText className="w-8 h-8 opacity-30" />
                  <span>Nenhum texto bruto disponível para este arquivo.</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3.5 border-t border-border bg-muted/20 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                Total de caracteres: <strong className="text-foreground">{previewFile.content ? previewFile.content.length.toLocaleString("pt-BR") : 0}</strong>
              </span>
              <button
                onClick={() => setPreviewFile(null)}
                className="px-4 py-1.5 bg-primary text-primary-foreground font-bold rounded-xl text-xs hover:opacity-90 transition cursor-pointer shadow-soft"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Preview de Imagem Real (Ver Foto) ──────────────────────────── */}
      {previewImageFile && (() => {
        // Extrai base64 do content: "[FORMATO_REAL:url][BASE64:xxxxx]"
        const content = previewImageFile.content || "";
        const base64Match = content.match(/\[BASE64:([A-Za-z0-9+/=]+)\]/);
        const base64Data = base64Match ? base64Match[1] : null;
        // Detecta mime type pela extensão do nome
        const ext = previewImageFile.name.split(".").pop()?.toLowerCase() || "jpeg";
        const mimeMap: Record<string, string> = { jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp", gif: "gif" };
        const mime = `image/${mimeMap[ext] || "jpeg"}`;
        const imgSrc = base64Data ? `data:${mime};base64,${base64Data}` : null;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center flex-shrink-0 border border-amber-500/20">
                    <ImageIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-extrabold text-foreground truncate">{previewImageFile.name}</h3>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black uppercase bg-amber-500/10 text-amber-600 border border-amber-500/30">
                        <Paperclip className="w-2.5 h-2.5" /> Formato Real
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {previewImageFile.size} · Imagem enviada diretamente pela Valentina
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setPreviewImageFile(null)}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Imagem */}
              <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-background/60 min-h-0">
                {imgSrc ? (
                  <img
                    src={imgSrc}
                    alt={previewImageFile.name}
                    className="max-w-full max-h-[60vh] object-contain rounded-xl shadow-md"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                    <ImageIcon className="w-12 h-12 opacity-20" />
                    <span className="text-xs">Imagem não disponível — base64 não encontrado no banco.</span>
                    <span className="text-[10px] text-muted-foreground/60">
                      Tente re-subir o arquivo em Formato Real.
                    </span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-3.5 border-t border-border bg-muted/20 flex items-center justify-end">
                <button
                  onClick={() => setPreviewImageFile(null)}
                  className="px-4 py-1.5 bg-primary text-primary-foreground font-bold rounded-xl text-xs hover:opacity-90 transition cursor-pointer shadow-soft"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
