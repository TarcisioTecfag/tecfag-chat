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
  Folder,
} from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";

export interface CatalogImageItem {
  id: string;
  name: string;
  displayName?: string;
  sku: string;
  category?: string;
  folderId?: string | null;
  mediaUrl: string;
  thumbnailUrl: string;
  mimeType: string;
  size: string;
  type: string;
  uploadedAt: string;
}

interface CatalogCategorySummary {
  name: string;
  count: number;
}

interface ProductCatalogPickerProps {
  tenantId?: string;
  onAttachFiles: (files: File[]) => void;
  onClose: () => void;
}

function normalizeSearchText(str: string): string {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export const ProductCatalogPicker: React.FC<ProductCatalogPickerProps> = ({
  tenantId: propTenantId,
  onAttachFiles,
  onClose,
}) => {
  const { tenant } = useChat();
  const tenantId = propTenantId || tenant || "valem";

  const [images, setImages] = useState<CatalogImageItem[]>([]);
  const [categories, setCategories] = useState<CatalogCategorySummary[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [zoomImage, setZoomImage] = useState<CatalogImageItem | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(60);

  const fetchCatalogImages = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/valentina/catalog-images?tenantId=${tenantId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Status ${res.status}`);
      }
      const data = await res.json();
      if (Array.isArray(data.items)) {
        setImages(data.items);
      } else {
        setImages([]);
      }
      if (Array.isArray(data.categories)) {
        setCategories(data.categories);
      } else {
        setCategories([]);
      }
    } catch (err) {
      console.error("[ProductCatalogPicker] Erro ao carregar imagens:", err);
      toast.error("Erro ao carregar catálogo de fotos.");
      setImages([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalogImages();
  }, [tenantId]);

  // Resetar limite de paginação ao filtrar
  useEffect(() => {
    setVisibleLimit(60);
  }, [searchTerm, selectedCategory]);

  // Categorias dinâmicas (caso o backend não envie ou para manter sincronizado)
  const effectiveCategories = useMemo(() => {
    if (categories.length > 0) return categories;
    const map = new Map<string, number>();
    for (const img of images) {
      if (img.category) {
        map.set(img.category, (map.get(img.category) || 0) + 1);
      }
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [categories, images]);

  // Filtragem dinâmica insensível a acentos + filtro de categoria
  const filteredImages = useMemo(() => {
    let base = images;
    if (selectedCategory !== "ALL") {
      base = base.filter((item) => (item.category || "") === selectedCategory);
    }

    if (!searchTerm.trim()) return base;
    const normalizedQuery = normalizeSearchText(searchTerm);
    const parts = normalizedQuery.split(/\s+/).filter(Boolean);

    return base.filter((item) => {
      const target = normalizeSearchText(
        `${item.displayName || item.name} ${item.sku || ""} ${item.category || ""}`
      );
      return parts.every((p) => target.includes(p));
    });
  }, [images, searchTerm, selectedCategory]);

  const visibleImages = useMemo(
    () => filteredImages.slice(0, visibleLimit),
    [filteredImages, visibleLimit]
  );

  // Scroll infinito na grade de fotos
  const handleGridScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 180) {
      if (visibleLimit < filteredImages.length) {
        setVisibleLimit((prev) => Math.min(prev + 60, filteredImages.length));
      }
    }
  };

  // Toggle de seleção individual
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

  // Converte imagem para File de forma ágil (priorizando binário nativo com cache HTTP)
  const convertToFile = async (item: CatalogImageItem): Promise<File | null> => {
    try {
      // 1. Prioriza binário direto (aproveita cache do navegador já carregado na miniatura)
      const blobRes = await fetch(item.thumbnailUrl || item.mediaUrl, {
        credentials: "include",
      });
      if (blobRes.ok) {
        const blob = await blobRes.blob();
        if (blob.size > 0) {
          return new File([blob], item.name, {
            type: item.mimeType || blob.type || "image/jpeg",
          });
        }
      }

      // 2. Fallback: busca base64 via endpoint getFileData
      const res = await fetch(
        `/api/valentina/catalog-images?tenantId=${tenantId}&action=getFileData&fileId=${item.id}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.base64) {
          const dataUrlRes = await fetch(
            `data:${data.mimeType || item.mimeType || "image/jpeg"};base64,${data.base64}`
          );
          const blob = await dataUrlRes.blob();
          return new File([blob], item.name, {
            type: data.mimeType || item.mimeType || "image/jpeg",
          });
        }
      }

      return null;
    } catch (err) {
      console.error(`[ProductCatalogPicker] Falha ao converter ${item.name}:`, err);
      return null;
    }
  };

  // Executa anexação ao chat em paralelo
  const handleAttachSelected = async () => {
    if (selectedIds.size === 0) {
      toast.error("Selecione ao menos uma imagem para anexar.");
      return;
    }

    setIsAttaching(true);
    const selectedItems = images.filter((img) => selectedIds.has(img.id));
    const convertedResults = await Promise.all(selectedItems.map((item) => convertToFile(item)));
    const filesToAttach = convertedResults.filter((f): f is File => f !== null);

    setIsAttaching(false);

    if (filesToAttach.length > 0) {
      onAttachFiles(filesToAttach);
      toast.success(
        filesToAttach.length === 1
          ? "1 foto anexada ao chat"
          : `${filesToAttach.length} fotos anexadas ao chat`
      );
      onClose();
    } else {
      toast.error("Não foi possível processar as imagens selecionadas.");
    }
  };

  return (
    <div className="flex flex-col h-[410px] w-full bg-card border border-border rounded-2xl overflow-hidden shadow-soft animate-in slide-in-from-bottom-2 duration-200">
      {/* Top Bar: Search & Actions */}
      <div className="flex items-center gap-2 p-2.5 border-b border-border bg-muted/30">
        <div className="relative flex-1 flex items-center">
          <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={
              tenantId === "tecfag"
                ? "Pesquisar máquina, modelo, código ou categoria (ex: seladora continua, FR900, vacuo)..."
                : "Pesquisar por nome, SKU, rosca ou frasco (ex: pump, spray, 180013, 24/410)..."
            }
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

        <button
          type="button"
          onClick={fetchCatalogImages}
          title="Recarregar catálogo"
          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Barra Horizontal de Categorias (Pastas da Base de Conhecimento) */}
      {effectiveCategories.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-card overflow-x-auto scrollbar-none shrink-0">
          <button
            type="button"
            onClick={() => setSelectedCategory("ALL")}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap transition cursor-pointer shrink-0 ${
              selectedCategory === "ALL"
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            Todas ({images.length})
          </button>
          {effectiveCategories.map((cat) => (
            <button
              key={cat.name}
              type="button"
              onClick={() =>
                setSelectedCategory((prev) => (prev === cat.name ? "ALL" : cat.name))
              }
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap transition cursor-pointer shrink-0 ${
                selectedCategory === cat.name
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <Folder className="h-2.5 w-2.5 opacity-75" />
              <span>{cat.name}</span>
              <span className="opacity-70">({cat.count})</span>
            </button>
          ))}
        </div>
      )}

      {/* Grid de Imagens */}
      <div
        onScroll={handleGridScroll}
        className="flex-1 p-3 overflow-y-auto min-h-0 bg-background/50 scrollbar-thin"
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full space-y-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs">
              {tenantId === "tecfag"
                ? "Carregando catálogo de máquinas e equipamentos..."
                : "Carregando fotos reais de válvulas e embalagens..."}
            </span>
          </div>
        ) : filteredImages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full space-y-2.5 text-muted-foreground py-6">
            <ImageIcon className="h-9 w-9 opacity-25" />
            <span className="text-xs font-semibold text-foreground">
              Nenhuma imagem encontrada
            </span>
            <span className="text-[11px] text-muted-foreground max-w-md text-center">
              {searchTerm || selectedCategory !== "ALL"
                ? `Nenhum produto corresponde ao filtro atual. Tente outros termos ou limpe a categoria.`
                : "Nenhuma foto cadastrada na Base de Conhecimento deste tenant."}
            </span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
              {visibleImages.map((item) => {
                const isSelected = selectedIds.has(item.id);
                const imgSrc = item.thumbnailUrl || item.mediaUrl;
                const cleanTitle =
                  item.displayName || item.name.replace(/\.(jpg|jpeg|png|webp|gif)$/i, "");

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
                    <div className="relative aspect-square w-full bg-white dark:bg-muted/40 overflow-hidden flex items-center justify-center">
                      {imgSrc ? (
                        <img
                          src={imgSrc}
                          alt={cleanTitle}
                          loading="lazy"
                          className="h-full w-full object-contain p-1 group-hover:scale-105 transition-transform duration-200 relative z-1"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = "none";
                          }}
                        />
                      ) : null}
                      <Package className="h-8 w-8 text-muted-foreground/30 absolute z-0" />

                      {/* Checkbox indicator */}
                      <div
                        className={`absolute top-2 left-2 z-2 flex h-5 w-5 items-center justify-center rounded-md border transition-all ${
                          isSelected
                            ? "bg-primary border-primary text-primary-foreground shadow-xs"
                            : "bg-background/85 backdrop-blur-xs border-border/80 text-transparent group-hover:border-foreground/40"
                        }`}
                      >
                        <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                      </div>

                      {/* Zoom button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setZoomImage(item);
                        }}
                        title="Ampliar visualização"
                        className="absolute top-2 right-2 z-2 flex h-6 w-6 items-center justify-center rounded-md bg-background/85 backdrop-blur-xs border border-border text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition shadow-xs cursor-pointer"
                      >
                        <Maximize2 className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Informações do Produto */}
                    <div className="p-2 flex flex-col justify-between flex-1 min-w-0">
                      <p
                        className="text-[11px] font-semibold text-foreground line-clamp-2 leading-tight"
                        title={cleanTitle}
                      >
                        {cleanTitle}
                      </p>
                      <div className="flex items-center justify-between gap-1 mt-1.5 pt-1 border-t border-border/40">
                        {item.sku ? (
                          <span className="text-[9px] font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.2 rounded truncate max-w-[110px]">
                            {tenantId === "tecfag" ? item.sku : `SKU ${item.sku}`}
                          </span>
                        ) : item.category ? (
                          <span className="text-[9px] font-medium text-muted-foreground truncate max-w-[110px]">
                            {item.category}
                          </span>
                        ) : (
                          <span className="text-[9px] text-muted-foreground">
                            {tenantId === "tecfag" ? "Tecfag" : "Valem"}
                          </span>
                        )}
                        <span className="text-[9px] text-muted-foreground shrink-0">
                          {item.size}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {visibleLimit < filteredImages.length && (
              <div className="flex justify-center pt-3 pb-1">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleLimit((prev) => Math.min(prev + 80, filteredImages.length))
                  }
                  className="px-4 py-1.5 rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
                >
                  Mostrar mais ({filteredImages.length - visibleLimit} restantes)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Bar: Selection counter & Attach Button */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-card">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">
            {selectedIds.size === 0
              ? `${filteredImages.length} ${
                  filteredImages.length === 1 ? "foto disponível" : "fotos disponíveis"
                }`
              : `${selectedIds.size} ${
                  selectedIds.size === 1 ? "foto selecionada" : "fotos selecionadas"
                }`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
          >
            Cancelar
          </button>

          <button
            type="button"
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
                <span className="text-xs font-bold text-foreground truncate">
                  {zoomImage.displayName || zoomImage.name}
                </span>
                {zoomImage.sku && (
                  <span className="text-[10px] font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                    {tenantId === "tecfag" ? zoomImage.sku : `SKU ${zoomImage.sku}`}
                  </span>
                )}
                {zoomImage.category && (
                  <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded shrink-0">
                    {zoomImage.category}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setZoomImage(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 p-4 overflow-auto flex items-center justify-center bg-white dark:bg-background min-h-0">
              <img
                src={zoomImage.thumbnailUrl || zoomImage.mediaUrl}
                alt={zoomImage.displayName || zoomImage.name}
                className="max-h-[60vh] max-w-full object-contain rounded-lg"
              />
            </div>

            <div className="flex items-center justify-between p-3 border-t border-border bg-card">
              <span className="text-[11px] text-muted-foreground">
                {zoomImage.size} {zoomImage.category ? `· ${zoomImage.category}` : "· Alta Resolução"}
              </span>
              <button
                type="button"
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
