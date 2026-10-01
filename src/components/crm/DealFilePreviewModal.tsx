import React, { useState, useEffect } from "react";
import {
  X,
  Download,
  ExternalLink,
  Trash2,
  FileText,
  FileSpreadsheet,
  Film,
  Music,
  ImageIcon,
  Archive,
  File,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Loader2,
  AlertCircle,
  Eye,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";

export interface DealFileItem {
  id: string;
  dealId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
  createdAt: string | Date;
  uploaderName?: string | null;
  conversationId?: string | null;
  url?: string;
  downloadUrl?: string;
}

interface DealFilePreviewModalProps {
  file: DealFileItem | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete?: (fileId: string) => Promise<void> | void;
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export type FileCategory =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "spreadsheet"
  | "document"
  | "archive"
  | "text"
  | "other";

export function getFileCategory(fileName: string, mimeType?: string): FileCategory {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (
    ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "ico"].includes(ext) ||
    mime.startsWith("image/")
  ) {
    return "image";
  }

  if (
    ["mp4", "webm", "mov", "mkv", "avi", "wmv", "flv", "m4v"].includes(ext) ||
    mime.startsWith("video/")
  ) {
    return "video";
  }

  if (
    ["mp3", "wav", "ogg", "m4a", "aac", "flac", "wma"].includes(ext) ||
    mime.startsWith("audio/")
  ) {
    return "audio";
  }

  if (ext === "pdf" || mime === "application/pdf") {
    return "pdf";
  }

  if (
    ["xls", "xlsx", "csv", "ods"].includes(ext) ||
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "text/csv"
  ) {
    return "spreadsheet";
  }

  if (
    ["txt", "json", "log", "md", "xml", "yaml", "yml"].includes(ext) ||
    mime.startsWith("text/")
  ) {
    return "text";
  }

  if (
    ["doc", "docx", "rtf", "odt", "ppt", "pptx"].includes(ext) ||
    mime.includes("word") ||
    mime.includes("officedocument")
  ) {
    return "document";
  }

  if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext) || mime.includes("zip") || mime.includes("tar")) {
    return "archive";
  }

  return "other";
}

export function getCategoryBadge(category: FileCategory, fileName: string) {
  const ext = (fileName.split(".").pop() || "").toUpperCase();

  switch (category) {
    case "image":
      return {
        icon: ImageIcon,
        label: ext || "IMAGEM",
        color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      };
    case "video":
      return {
        icon: Film,
        label: ext || "VÍDEO",
        color: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
      };
    case "audio":
      return {
        icon: Music,
        label: ext || "ÁUDIO",
        color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      };
    case "pdf":
      return {
        icon: FileText,
        label: "PDF",
        color: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      };
    case "spreadsheet":
      return {
        icon: FileSpreadsheet,
        label: ext || "PLANILHA",
        color: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
      };
    case "document":
      return {
        icon: FileText,
        label: ext || "DOC",
        color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      };
    case "archive":
      return {
        icon: Archive,
        label: ext || "ZIP",
        color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
      };
    case "text":
      return {
        icon: FileText,
        label: ext || "TEXTO",
        color: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
      };
    default:
      return {
        icon: File,
        label: ext || "ARQUIVO",
        color: "bg-muted text-muted-foreground border-border",
      };
  }
}

export function DealFilePreviewModal({
  file,
  isOpen,
  onClose,
  onDelete,
}: DealFilePreviewModalProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setTextContent(null);
    setConfirmDelete(false);
    setIsDeleting(false);

    if (isOpen && file) {
      const cat = getFileCategory(file.fileName, file.mimeType);
      const ext = (file.fileName.split(".").pop() || "").toLowerCase();
      if (cat === "text" || ext === "csv") {
        setLoadingText(true);
        const targetUrl = file.url || `/api/crm/deals/${file.dealId}/files/${file.id}`;
        fetch(targetUrl)
          .then((res) => (res.ok ? res.text() : Promise.reject("Falha ao carregar")))
          .then((text) => setTextContent(text.slice(0, 50000))) // Limite de 50KB para preview rápido
          .catch(() => setTextContent(null))
          .finally(() => setLoadingText(false));
      }
    }
  }, [isOpen, file]);

  // Tecla ESC para fechar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !file) return null;

  const fileUrl = file.url || `/api/crm/deals/${file.dealId}/files/${file.id}`;
  const downloadUrl =
    file.downloadUrl || `/api/crm/deals/${file.dealId}/files/${file.id}?download=1`;
  const category = getFileCategory(file.fileName, file.mimeType);
  const badge = getCategoryBadge(category, file.fileName);
  const BadgeIcon = badge.icon;
  const ext = (file.fileName.split(".").pop() || "").toLowerCase();

  const handleDelete = async () => {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete(file.id);
      onClose();
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in-50 duration-200"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-5xl max-h-[92vh] rounded-2xl bg-card border border-border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho do Visualizador */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-muted/40 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 ${badge.color}`}
            >
              <BadgeIcon className="h-4 w-4" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-foreground truncate max-w-sm sm:max-w-md">
                  {file.fileName}
                </h3>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${badge.color}`}
                >
                  {badge.label}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{formatBytes(file.fileSize)}</span>
                <span>•</span>
                <span>
                  {new Date(file.createdAt).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
                {file.uploaderName && (
                  <>
                    <span>•</span>
                    <span>Enviado por: {file.uploaderName}</span>
                  </>
                )}
                {file.conversationId && (
                  <span className="text-primary font-semibold">(Vindo do Chat)</span>
                )}
              </div>
            </div>
          </div>

          {/* Ações do Topo */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Controles de Imagem (Zoom/Rotação) */}
            {category === "image" && (
              <div className="hidden sm:flex items-center gap-1 mr-2 bg-muted/60 rounded-lg p-0.5 border border-border">
                <SystemTooltip content="Zoom Out (-25%)">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-card transition-colors cursor-pointer"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                </SystemTooltip>
                <span className="text-[11px] font-mono font-medium px-1 text-muted-foreground">
                  {Math.round(zoom * 100)}%
                </span>
                <SystemTooltip content="Zoom In (+25%)">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-card transition-colors cursor-pointer"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                </SystemTooltip>
                <SystemTooltip content="Girar 90°">
                  <button
                    type="button"
                    onClick={() => setRotation((r) => (r + 90) % 360)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-card transition-colors cursor-pointer ml-0.5"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </button>
                </SystemTooltip>
              </div>
            )}

            {/* Abrir em nova aba */}
            <SystemTooltip content="Abrir arquivo em nova guia">
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="h-8 px-2.5 rounded-lg border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Nova Guia</span>
              </a>
            </SystemTooltip>

            {/* Baixar */}
            <SystemTooltip content="Baixar para seu computador">
              <a
                href={downloadUrl}
                download={file.fileName}
                className="h-8 px-3 rounded-lg bg-primary hover:bg-primary/90 text-xs font-bold text-primary-foreground flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Baixar</span>
              </a>
            </SystemTooltip>

            {/* Excluir */}
            {onDelete && (
              <>
                {confirmDelete ? (
                  <div className="flex items-center gap-1 bg-destructive/10 border border-destructive/20 rounded-lg p-0.5">
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={handleDelete}
                      className="h-7 px-2 rounded bg-destructive hover:bg-destructive/90 text-destructive-foreground text-xs font-bold transition-colors cursor-pointer flex items-center gap-1"
                    >
                      {isDeleting && <Loader2 className="h-3 w-3 animate-spin" />}
                      <span>Confirmar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="h-7 px-2 rounded hover:bg-muted text-xs text-muted-foreground transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <SystemTooltip content="Excluir arquivo permanentemente">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="h-8 w-8 rounded-lg border border-border hover:border-destructive/40 hover:bg-destructive/10 text-muted-foreground hover:text-destructive flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </SystemTooltip>
                )}
              </>
            )}

            {/* Fechar */}
            <SystemTooltip content="Fechar visualizador (Esc)">
              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer ml-1"
              >
                <X className="h-4 w-4" />
              </button>
            </SystemTooltip>
          </div>
        </div>

        {/* Corpo do Visualizador com Renderização Especializada por Categoria */}
        <div className="relative flex-1 min-h-[350px] max-h-[calc(92vh-64px)] overflow-auto bg-muted/20 flex items-center justify-center p-4">
          {/* 1. IMAGEM */}
          {category === "image" && (
            <div className="flex items-center justify-center w-full h-full min-h-[300px] overflow-hidden">
              <img
                src={fileUrl}
                alt={file.fileName}
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transition: "transform 0.15s ease",
                }}
                className="max-h-[72vh] max-w-full object-contain rounded-lg shadow-md cursor-grab active:cursor-grabbing"
              />
            </div>
          )}

          {/* 2. VÍDEO */}
          {category === "video" && (
            <div className="w-full max-w-4xl flex flex-col items-center justify-center">
              <video
                src={fileUrl}
                controls
                playsInline
                autoPlay={false}
                preload="metadata"
                className="max-h-[70vh] w-full rounded-xl bg-black shadow-lg"
              >
                Seu navegador não suporta a tag de vídeo HTML5.
              </video>
            </div>
          )}

          {/* 3. ÁUDIO */}
          {category === "audio" && (
            <div className="w-full max-w-md p-6 rounded-2xl bg-card border border-border shadow-lg flex flex-col items-center gap-4 text-center">
              <div className="h-16 w-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center">
                <Music className="h-8 w-8 animate-pulse" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">{file.fileName}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Reprodução de Áudio • {formatBytes(file.fileSize)}
                </p>
              </div>
              <audio src={fileUrl} controls className="w-full mt-2" />
            </div>
          )}

          {/* 4. PDF */}
          {category === "pdf" && (
            <div className="w-full h-full min-h-[500px]">
              <iframe
                src={`${fileUrl}#toolbar=1&navpanes=0`}
                title={file.fileName}
                className="w-full h-[74vh] rounded-xl border border-border bg-white"
              />
            </div>
          )}

          {/* 5. TEXTO E PLANILHAS CSV */}
          {(category === "text" || ext === "csv") && (
            <div className="w-full h-full max-w-4xl max-h-[72vh] flex flex-col rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                <span>Pré-visualização de Conteúdo ({ext.toUpperCase()})</span>
                <span>{textContent ? `${textContent.length} caracteres` : ""}</span>
              </div>
              <div className="flex-1 overflow-auto p-4 font-mono text-xs text-foreground bg-muted/10 leading-relaxed whitespace-pre">
                {loadingText ? (
                  <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Carregando prévia do arquivo...</span>
                  </div>
                ) : textContent !== null ? (
                  textContent
                ) : (
                  <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
                    <AlertCircle className="h-6 w-6 text-amber-500" />
                    <span>Não foi possível gerar a prévia textual direta.</span>
                    <a
                      href={downloadUrl}
                      className="text-primary hover:underline font-semibold"
                    >
                      Baixar arquivo para visualizar
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 6. PLANILHAS EXCEL (XLSX / XLS) */}
          {category === "spreadsheet" && ext !== "csv" && (
            <div className="w-full max-w-md p-6 rounded-2xl bg-card border border-border shadow-lg flex flex-col items-center gap-4 text-center">
              <div className="h-16 w-16 rounded-2xl bg-teal-500/10 border border-teal-500/20 text-teal-600 dark:text-teal-400 flex items-center justify-center">
                <FileSpreadsheet className="h-8 w-8" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">{file.fileName}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Planilha Excel/OpenOffice • {formatBytes(file.fileSize)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground/80 max-w-xs">
                Planilhas binárias podem ser abertas diretamente no seu aplicativo local ou na nuvem após o download.
              </p>
              <div className="flex items-center gap-2 mt-2 w-full">
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 h-9 rounded-xl border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Abrir no Navegador</span>
                </a>
                <a
                  href={downloadUrl}
                  download={file.fileName}
                  className="flex-1 h-9 rounded-xl bg-primary hover:bg-primary/90 text-xs font-bold text-primary-foreground flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Baixar Planilha</span>
                </a>
              </div>
            </div>
          )}

          {/* 7. DOCUMENTOS (WORD / DOC / DOCX / PPT / PPTX) */}
          {category === "document" && (
            <div className="w-full max-w-md p-6 rounded-2xl bg-card border border-border shadow-lg flex flex-col items-center gap-4 text-center">
              <div className="h-16 w-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <FileText className="h-8 w-8" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">{file.fileName}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Documento Comercial • {formatBytes(file.fileSize)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground/80 max-w-xs">
                Para documentos formatados Office, baixe o arquivo para abrir com todas as fontes e formatações preservadas.
              </p>
              <div className="flex items-center gap-2 mt-2 w-full">
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 h-9 rounded-xl border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Ver em Nova Guia</span>
                </a>
                <a
                  href={downloadUrl}
                  download={file.fileName}
                  className="flex-1 h-9 rounded-xl bg-primary hover:bg-primary/90 text-xs font-bold text-primary-foreground flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Baixar Documento</span>
                </a>
              </div>
            </div>
          )}

          {/* 8. PACOTES COMPACTADOS (ZIP / RAR / 7Z) */}
          {category === "archive" && (
            <div className="w-full max-w-md p-6 rounded-2xl bg-card border border-border shadow-lg flex flex-col items-center gap-4 text-center">
              <div className="h-16 w-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 text-orange-600 dark:text-orange-400 flex items-center justify-center">
                <Archive className="h-8 w-8" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">{file.fileName}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Arquivo Compactado • {formatBytes(file.fileSize)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground/80 max-w-xs">
                Pacote com múltiplos itens compactados. Faça o download para descompactar os arquivos no seu computador.
              </p>
              <div className="flex items-center gap-2 mt-2 w-full">
                <a
                  href={downloadUrl}
                  download={file.fileName}
                  className="w-full h-9 rounded-xl bg-primary hover:bg-primary/90 text-xs font-bold text-primary-foreground flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Baixar Arquivo Compactado</span>
                </a>
              </div>
            </div>
          )}

          {/* 9. OUTROS FORMATOS */}
          {category === "other" && (
            <div className="w-full max-w-md p-6 rounded-2xl bg-card border border-border shadow-lg flex flex-col items-center gap-4 text-center">
              <div className="h-16 w-16 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center">
                <File className="h-8 w-8" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">{file.fileName}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {file.mimeType || "Arquivo genérico"} • {formatBytes(file.fileSize)}
                </p>
              </div>
              <div className="flex items-center gap-2 mt-2 w-full">
                <a
                  href={downloadUrl}
                  download={file.fileName}
                  className="w-full h-9 rounded-xl bg-primary hover:bg-primary/90 text-xs font-bold text-primary-foreground flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Baixar Arquivo</span>
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
