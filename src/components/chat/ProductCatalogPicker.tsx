import React, { useState, useEffect, useMemo } from "react";
import {
  Search,
  X,
  Package,
  Paperclip,
  Check,
  Maximize2,
  Loader2,
  RefreshCw,
  Image as ImageIcon,
  CheckSquare,
  Square,
} from "lucide-react";
import { toast } from "sonner";

export interface CatalogImageItem {
  id: string;
  name: string;
  sku: string;
  mediaUrl: string;
  thumbnailUrl: string;
  mimeType: string;
  size: string;
  type: string;
  uploadedAt: string;
}

interface ProductCatalogPickerProps {
  tenantId?: string;
  onAttachFiles: (files: File[]) => void;
  onClose: () => void;
}

export const ProductCatalogPicker: React.FC<ProductCatalogPickerProps> = ({
  tenantId = "valem",
  onAttachFiles,
  onClose,
}) => {
  const [images, setImages] = useState<CatalogImageItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [zoomImage, setZoomImage] = useState<CatalogImageItem | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);

  const fetchCatalogImages = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/valentina/catalog-images?tenantId=${tenantId}`);
      if (!res.ok) {
        throw new Error(`Status ${res.status}`);
      }
      const data = await res.json();
      if (Array.isArray(data.items)) {
        setImages(data.items);
      } else {
        setImages([]);
      }
    } catch (err) {
      console.error("[ProductCatalogPicker] Erro ao carregar imagens:", err);
      toast.error("Erro ao carregar catálogo de fotos reais.");
      setImages([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalogImages();
  }, [tenantId]);

  // Filtragem dinâmica por termo de busca
  const filteredImages = useMemo(() => {
    if (!searchTerm.trim()) return images;
    const term = searchTerm.toLowerCase().trim();
    const parts = term.split(/\s+/).filter(Boolean);

    return images.filter((item) => {
      const nameLower = item.name.toLowerCase();
      const skuLower = (item.sku || "").toLowerCase();
      return parts.every((p) => nameLower.includes(p) || skuLower.includes(p));
    });
  }, [images, searchTerm]);

  // Toggle de seleção
  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Selecionar todos os visíveis / Limpar seleção
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredImages.length && filteredImages.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredImages.map((img) => img.id)));
    }
  };

  // Converte base64 ou fetch para File de forma ágil
  const convertToFile = async (item: CatalogImageItem): Promise<File | null> => {
    try {
      // 1. Tenta buscar base64 leve via endpoint getFileData
      const res = await fetch(`/api/valentina/catalog-images?tenantId=${tenantId}&action=getFileData&fileId=${item.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.base64) {
          const byteCharacters = atob(data.base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          return new File([byteArray], item.name, { type: item.mimeType || "image/jpeg" });
        }
      }

      // 2. Fallback: busca binário via endpoint rawImage ou mediaUrl
      const blobRes = await fetch(item.thumbnailUrl || item.mediaUrl);
      if (blobRes.ok) {
        const blob = await blobRes.blob();
        return new File([blob], item.name, { type: item.mimeType || blob.type || "image/jpeg" });
      }

      return null;
    } catch (err) {
      console.error(`[ProductCatalogPicker] Falha ao converter ${item.name}:`, err);
      return null;
    }
  };

  // Executa anexação ao chat
  const handleAttachSelected = async () => {
    if (selectedIds.size === 0) {
      toast.error("Selecione ao menos uma imagem para anexar.");
      return;
    }

    setIsAttaching(true);
    const selectedItems = images.filter((img) => selectedIds.has(img.id));
    const filesToAttach: File[] = [];

    for (const item of selectedItems) {
      const file = await convertToFile(item);
      if (file) {
        filesToAttach.push(file);
      }
    }

    setIsAttaching(false);

    if (filesToAttach.length > 0) {
      onAttachFiles(filesToAttach);
      toast.success(
        filesToAttach.length === 1
          ? "1 imagem anexada ao chat"
          : `${filesToAttach.length} imagens anexadas ao chat`
      );
      onClose();
    } else {
      toast.error("Não foi possível processar as imagens selecionadas.");
    }
  };

  return (
    <div className="flex flex-col h-[380px] w-full bg-card border border-border rounded-2xl overflow-hidden shadow-soft animate-in slide-in-from-bottom-2 duration-200">
      {/* Top Bar: Search & Filters */}
      <div className="flex items-center gap-3 p-3 border-b border-border bg-muted/30">
        <div className="relative flex-1 flex items-center">
          <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Pesquisar por nome, SKU, rosca ou frasco (ex: pump, spray, 180013, 24/410)..."
            className="w-full pl-9 pr-8 py-1.5 text-xs bg-background border border-border rounded-xl focus:outline-none focus:border-primary/60 text-foreground placeholder:text-muted-foreground transition"
            autoFocus
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-2.5 p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Action Toggle Select All */}
        {filteredImages.length > 0 && (
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer shrink-0"
          >
            {selectedIds.size === filteredImages.length ? (
              <>
                <CheckSquare className="h-3.5 w-3.5 text-primary" /> Desmarcar
              </>
            ) : (
              <>
                <Square className="h-3.5 w-3.5" /> Selecionar todos
              </>
            )}
          </button>
        )}

        <button
          onClick={fetchCatalogImages}
          title="Recarregar catálogo"
          className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Grid de Imagens */}
      <div className="flex-1 p-3 overflow-y-auto min-h-0 bg-background/50 scrollbar-thin">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full space-y-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs">Carregando fotos reais de válvulas e embalagens...</span>
          </div>
        ) : filteredImages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full space-y-2 text-muted-foreground py-10">
            <ImageIcon className="h-10 w-10 opacity-25" />
            <span className="text-xs font-semibold text-foreground">Nenhuma imagem encontrada</span>
            <span className="text-[11px] text-muted-foreground max-w-xs text-center">
              {searchTerm
                ? `Nenhum produto corresponde a "${searchTerm}". Tente outros termos.`
                : "Nenhuma foto em formato real cadastrada na base de conhecimento."}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
            {filteredImages.map((item) => {
              const isSelected = selectedIds.has(item.id);
              const imgSrc = item.thumbnailUrl || item.mediaUrl;

              return (
                <div
                  key={item.id}
                  onClick={() => toggleSelect(item.id)}
                  className={`group relative flex flex-col rounded-xl border overflow-hidden bg-card cursor-pointer transition-all duration-150 select-none ${
                    isSelected
                      ? "border-primary ring-2 ring-primary/20 bg-primary/5 shadow-xs"
                      : "border-border hover:border-primary/40 hover:shadow-xs"
                  }`}
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-square w-full bg-muted/40 overflow-hidden flex items-center justify-center">
                    {imgSrc ? (
                      <img
                        src={imgSrc}
                        alt={item.name}
                        loading="lazy"
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200 relative z-1"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = "none";
                        }}
                      />
                    ) : null}
                    <Package className="h-8 w-8 text-muted-foreground/40 absolute z-0" />

                    {/* Checkbox indicator */}
                    <div
                      className={`absolute top-2 left-2 z-2 flex h-5 w-5 items-center justify-center rounded-md border transition-all ${
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground shadow-xs"
                          : "bg-background/80 backdrop-blur-xs border-border/80 text-transparent group-hover:border-foreground/40"
                      }`}
                    >
                      <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                    </div>

                    {/* Zoom button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setZoomImage(item);
                      }}
                      title="Ampliar visualização"
                      className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-md bg-background/80 backdrop-blur-xs border border-border text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition shadow-xs cursor-pointer"
                    >
                      <Maximize2 className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Informações do Produto */}
                  <div className="p-2 flex flex-col justify-between flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-foreground line-clamp-2 leading-tight">
                      {item.name}
                    </p>
                    <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-border/40">
                      {item.sku ? (
                        <span className="text-[9px] font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.2 rounded">
                          SKU {item.sku}
                        </span>
                      ) : (
                        <span className="text-[9px] text-muted-foreground">Valem</span>
                      )}
                      <span className="text-[9px] text-muted-foreground">{item.size}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Bar: Selection counter & Attach Button */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-card">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">
            {selectedIds.size === 0
              ? `${filteredImages.length} fotos disponíveis`
              : `${selectedIds.size} ${selectedIds.size === 1 ? "foto selecionada" : "fotos selecionadas"}`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
          >
            Cancelar
          </button>

          <button
            onClick={handleAttachSelected}
            disabled={selectedIds.size === 0 || isAttaching}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition shadow-xs cursor-pointer ${
              selectedIds.size > 0 && !isAttaching
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
            }`}
          >
            {isAttaching ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Anexando...
              </>
            ) : (
              <>
                <Paperclip className="h-3.5 w-3.5" />
                {selectedIds.size <= 1
                  ? "Anexar ao Chat"
                  : `Anexar ${selectedIds.size} ao Chat`}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Lightbox / Zoom Modal */}
      {zoomImage && (
        <div
          onClick={() => setZoomImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-2xl w-full bg-card border border-border rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-foreground truncate">{zoomImage.name}</span>
                {zoomImage.sku && (
                  <span className="text-[10px] font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                    SKU {zoomImage.sku}
                  </span>
                )}
              </div>
              <button
                onClick={() => setZoomImage(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 p-4 overflow-auto flex items-center justify-center bg-background min-h-0">
              <img
                src={zoomImage.thumbnailUrl || zoomImage.mediaUrl}
                alt={zoomImage.name}
                className="max-h-[60vh] max-w-full object-contain rounded-lg shadow-xs"
              />
            </div>

            <div className="flex items-center justify-between p-3 border-t border-border bg-card">
              <span className="text-[11px] text-muted-foreground">{zoomImage.size} · Formato Real</span>
              <button
                onClick={() => {
                  setSelectedIds((prev) => new Set([...prev, zoomImage.id]));
                  setZoomImage(null);
                  toast.success("Foto adicionada à seleção");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" /> Selecionar Foto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
