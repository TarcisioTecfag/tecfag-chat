import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { fetchCnpjInfo, CnpjFullDetails } from "@/lib/valentina/cnpj-service";
import { useChat } from "@/hooks/useChatState";
import { RdCrmCard } from "./RdCrmCard";
import { WhatsappLogo, InstagramLogo, MessengerLogo } from "./ChatList";
import { formatPhoneNumber, formatCPF, formatCNPJ, maskCPF, maskCNPJ } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  User,
  Phone,
  Mail,
  Tag,
  Shield,
  Smartphone,
  Plus,
  X,
  FileText,
  Building,
  CreditCard,
  QrCode,
  RefreshCw,
  LogOut,
  Radio,
  Image as ImageIcon,
  Film,
  Files,
  Folder,
  Link2,
  ChevronRight,
  Pencil,
  CheckCircle2,
  XCircle,
  PhoneCall,
  Save,
  Search,
  Check,
} from "lucide-react";

interface HistoryEventInfo {
  title: string;
  description: string;
  icon: any;
  dotBg: string;
  iconColor: string;
}

const isHistoryEvent = (msg: any) => {
  if (msg.senderType === "system" || msg.author === "Sistema" || msg.author === "Sistema — Ligação") {
    return true;
  }
  const text = msg.text || "";
  return (
    text.startsWith("CONVERSA INICIADA") ||
    text.startsWith("Conversa transferida") ||
    text.startsWith("Conversa encerrada") ||
    text.startsWith("Clique no botão de ligação") ||
    text.startsWith("📞 *Ligação iniciada")
  );
};

const parseHistoryEvent = (msg: any): HistoryEventInfo => {
  const text = msg.text || "";
  
  if (text.startsWith("CONVERSA INICIADA")) {
    const operator = text.replace("CONVERSA INICIADA POR", "").trim();
    return {
      title: "Atendimento Iniciado",
      description: operator ? `Atendimento capturado por ${operator}.` : "O atendimento foi iniciado.",
      icon: CheckCircle2,
      dotBg: "bg-emerald-500",
      iconColor: "text-white",
    };
  }
  
  if (text.startsWith("Conversa transferida")) {
    return {
      title: "Atendimento Transferido",
      description: text,
      icon: RefreshCw,
      dotBg: "bg-amber-500",
      iconColor: "text-white",
    };
  }
  
  if (text.startsWith("Conversa encerrada")) {
    return {
      title: "Atendimento Encerrado",
      description: "O atendimento foi encerrado.",
      icon: XCircle,
      dotBg: "bg-red-500",
      iconColor: "text-white",
    };
  }
  
  if (text.includes("botão de ligação") || text.includes("botão do VigosPhone")) {
    // Ex: "Clique no botão de ligação para o cliente por Pedro"
    const operatorNamePart = text.split("por ")[1] || "Agente";
    return {
      title: "Ligação Discada",
      description: `Ligação discada via VigosPhone para o cliente por ${operatorNamePart}.`,
      icon: PhoneCall,
      dotBg: "bg-teal-500",
      iconColor: "text-white",
    };
  }
  
  if (text.startsWith("📞 *Ligação iniciada") || text.includes("Ligação iniciada")) {
    return {
      title: "Chamada de Voz (WebRTC)",
      description: "Chamada de voz iniciada no navegador.",
      icon: Phone,
      dotBg: "bg-blue-500",
      iconColor: "text-white",
    };
  }

  return {
    title: "Mensagem do Sistema",
    description: text,
    icon: Shield,
    dotBg: "bg-gray-500",
    iconColor: "text-white",
  };
};

export function SharedFiles() {
  const {
    tenant,
    activeChat,
    updateTags,
    updateClientInfo,
    baileysConfig,
    metaConfig,
    connectBaileys,
    disconnectBaileys,
    setRightSidebarOpen,
  } = useChat();

  const [activeTab, setActiveTab] = useState<"details" | "files" | "events">("details");
  const [newTag, setNewTag] = useState("");
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [editForm, setEditForm] = React.useState({
    name: "",
    phone: "",
    email: "",
    cnpj: "",
    cpf: "",
  });

  const [cnpjDetails, setCnpjDetails] = useState<CnpjFullDetails>({});
  const [isSavingCnpj, setIsSavingCnpj] = useState(false);
  const [isSearchingCnpj, setIsSearchingCnpj] = useState(false);

  useEffect(() => {
    if (activeChat) {
      setCnpjDetails((activeChat as any).cnpjDetails || {});
    }
  }, [activeChat?.id, (activeChat as any)?.cnpjDetails]);

  const handleSaveCnpjDetails = async () => {
    if (!activeChat) return;
    setIsSavingCnpj(true);
    try {
      const contactId = activeChat.contactId || activeChat.id;
      const res = await fetch(`${BACKEND_URL}/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpjDetails }),
      });
      if (res.ok) {
        toast.success("Ficha da Receita Federal salva com sucesso!");
        (activeChat as any).cnpjDetails = cnpjDetails;
      } else {
        toast.error("Erro ao salvar dados da Receita.");
      }
    } catch (err) {
      console.error("Erro ao salvar dados da Receita:", err);
      toast.error("Falha ao comunicar com o servidor.");
    } finally {
      setIsSavingCnpj(false);
    }
  };

  const handleQueryCnpjLive = async () => {
    const cnpjToQuery = activeChat?.cnpj || cnpjDetails.cleanCnpj || cnpjDetails.cnpjFormatted;
    if (!cnpjToQuery) {
      toast.error("Informe um CNPJ válido nos dados do cliente para consultar.");
      return;
    }
    setIsSearchingCnpj(true);
    try {
      const res = await fetchCnpjInfo(cnpjToQuery);
      if (!res.valid) {
        toast.error(res.erro || "CNPJ inválido nos dígitos verificadores.");
      } else if (res.details) {
        setCnpjDetails(res.details);
        toast.success("Ficha Cadastral da Receita Federal carregada!");
      } else {
        toast.error("Não foi possível retornar dados para este CNPJ.");
      }
    } catch (err) {
      toast.error("Erro ao consultar Receita Federal.");
    } finally {
      setIsSearchingCnpj(false);
    }
  };

  if (!activeChat) {
    return (
      <aside className="flex h-full w-[280px] shrink-0 flex-col rounded-3xl bg-card px-5 py-6 shadow-soft border border-border text-center justify-center text-muted-foreground select-none">
        <User className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-xs">Selecione uma conversa para ver os detalhes do cliente.</p>
      </aside>
    );
  }

  // Handle Tag Management
  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTag.trim()) return;
    if (activeChat.tags.includes(newTag.trim())) {
      setNewTag("");
      return;
    }
    const updated = [...activeChat.tags, newTag.trim()];
    updateTags(activeChat.id, updated);
    setNewTag("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const updated = activeChat.tags.filter((t) => t !== tagToRemove);
    updateTags(activeChat.id, updated);
  };

  // Handle Client Info Edit
  const startEditing = () => {
    setEditForm({
      name: activeChat.name || "",
      phone: activeChat.phone || "",
      email: activeChat.email || "",
      cnpj: maskCNPJ(activeChat.cnpj || ""),
      cpf: maskCPF((activeChat as any).cpf || ""),
    });
    setIsEditingInfo(true);
  };

  const handleSaveInfo = () => {
    updateClientInfo(activeChat.id, editForm);
    setIsEditingInfo(false);
  };

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  // Scan all messages of this client/chat to extract media files and links
  const mediaMessages = activeChat.messages.filter((m) => m.text.startsWith("[MEDIA:"));

  const parsedMediaFiles = mediaMessages
    .map((m) => {
      const match = m.text.match(
        /^\[MEDIA:(image|video|audio|document|sticker)\]([^:]+)(?::(.+))?$/,
      );
      if (!match) return null;
      const [, type, messageId, extra] = match;

      // For visual display:
      let displayName = "Arquivo";
      if (type === "image") displayName = "Imagem";
      else if (type === "sticker") displayName = "Figurinha";
      else if (type === "video") displayName = "Vídeo";
      else if (type === "audio") displayName = "Mensagem de voz";
      else if (type === "document") displayName = extra || "Documento";

      return {
        id: m.id,
        messageId,
        type,
        name: displayName,
        time: m.time,
        author: m.author,
        url: `${BACKEND_URL}/api/baileys/media?messageId=${messageId}`,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    messageId: string;
    type: string;
    name: string;
    time: string;
    author: string;
    url: string;
  }>;

  // Extract shared URLs/Links
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parsedLinks = activeChat.messages.flatMap((m) => {
    const matches = m.text.match(urlRegex);
    if (!matches) return [];
    return matches.map((url, idx) => ({
      id: `${m.id}-link-${idx}`,
      url,
      time: m.time,
      author: m.author,
    }));
  });

  const docsCount = parsedMediaFiles.filter((f) => f.type === "document").length;
  const imagesCount = parsedMediaFiles.filter((f) => ["image", "sticker"].includes(f.type)).length;
  const videosCount = parsedMediaFiles.filter((f) => f.type === "video").length;
  const othersCount = parsedMediaFiles.filter((f) => f.type === "audio").length;

  const hasCnpjSaved = !!((activeChat as any).cnpjDetails && Object.keys((activeChat as any).cnpjDetails).length > 0);

  const categories = [
    {
      id: "docs",
      icon: FileText,
      label: "Documentos",
      count: `${docsCount} ${docsCount === 1 ? "arquivo" : "arquivos"}`,
      color: "var(--icon-docs)",
      bg: "var(--icon-docs-bg)",
      files: parsedMediaFiles.filter((f) => f.type === "document"),
    },
    {
      id: "images",
      icon: ImageIcon,
      label: "Imagens",
      count: `${imagesCount} ${imagesCount === 1 ? "arquivo" : "arquivos"}`,
      color: "var(--icon-photos)",
      bg: "var(--icon-photos-bg)",
      files: parsedMediaFiles.filter((f) => ["image", "sticker"].includes(f.type)),
    },
    {
      id: "videos",
      icon: Film,
      label: "Vídeos",
      count: `${videosCount} ${videosCount === 1 ? "arquivo" : "arquivos"}`,
      color: "var(--icon-movies)",
      bg: "var(--icon-movies-bg)",
      files: parsedMediaFiles.filter((f) => f.type === "video"),
    },
    {
      id: "others",
      icon: Files,
      label: "Outros",
      count: `${othersCount} ${othersCount === 1 ? "arquivo" : "arquivos"}`,
      color: "var(--icon-other)",
      bg: "var(--icon-other-bg)",
      files: parsedMediaFiles.filter((f) => f.type === "audio"),
    },
  ];

  const handleTabChange = (tab: "details" | "files" | "events") => {
    setActiveTab(tab);
    setSelectedCategory(null);
  };

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col rounded-3xl bg-card px-4 py-5 shadow-soft border border-border select-none">
      {/* Sidebar Header with Minimize Button */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
          Painel de Informações
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setRightSidebarOpen(false)}
              className="grid h-6 w-6 place-items-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Minimizar Painel</TooltipContent>
        </Tooltip>
      </div>

      {/* Header Tabs (3 segments for Details, Shared Files and Channel Integration) */}
      <div className="flex rounded-xl bg-muted p-1 relative">
        <button
          onClick={() => handleTabChange("details")}
          className={`relative flex-1 rounded-lg py-1.5 text-center text-[10px] font-bold transition-colors duration-200 cursor-pointer z-10 ${
            activeTab === "details"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {activeTab === "details" && (
            <motion.span
              layoutId="activeSharedTabIndicator"
              className="absolute inset-0 bg-card rounded-lg shadow-soft -z-10"
              transition={{ type: "spring", stiffness: 350, damping: 28 }}
            />
          )}
          📋 Dados
        </button>
        <button
          onClick={() => handleTabChange("files")}
          className={`relative flex-1 rounded-lg py-1.5 text-center text-[10px] font-bold transition-colors duration-200 cursor-pointer z-10 ${
            activeTab === "files"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {activeTab === "files" && (
            <motion.span
              layoutId="activeSharedTabIndicator"
              className="absolute inset-0 bg-card rounded-lg shadow-soft -z-10"
              transition={{ type: "spring", stiffness: 350, damping: 28 }}
            />
          )}
          📁 Arquivos
        </button>
        <button
          onClick={() => handleTabChange("events")}
          className={`relative flex-1 rounded-lg py-1.5 text-center text-[10px] font-bold transition-colors duration-200 cursor-pointer z-10 ${
            activeTab === "events"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {activeTab === "events" && (
            <motion.span
              layoutId="activeSharedTabIndicator"
              className="absolute inset-0 bg-card rounded-lg shadow-soft -z-10"
              transition={{ type: "spring", stiffness: 350, damping: 28 }}
            />
          )}
          🕒 Eventos
        </button>
      </div>


      <div className="my-4 h-px bg-line" />

      {activeTab === "details" ? (
        /* TAB 1: DADOS DO CLIENTE */
        <div className="flex-1 flex flex-col overflow-y-auto pr-1 scrollbar-thin space-y-5">
          {/* Avatar and Name */}
          <div className="flex flex-col items-center text-center">
            {activeChat.avatar ? (
              <img
                src={activeChat.avatar}
                alt=""
                className="h-16 w-16 rounded-full object-cover border border-border shadow-soft"
              />
            ) : (
              <div
                className="grid h-16 w-16 place-items-center rounded-full text-base font-bold text-foreground"
                style={{ background: activeChat.initialsBg || "#eee" }}
              >
                {activeChat.initials || "U"}
              </div>
            )}
            {isEditingInfo ? (
              <div className="mt-3 w-full max-w-[200px] text-left">
                <label className="text-[9px] font-bold text-muted-foreground block text-center mb-0.5">
                  Nome Completo
                </label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="h-8 w-full rounded-lg bg-card px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary border border-border text-center"
                />
              </div>
            ) : (
              <div className="relative w-full flex justify-center items-center mt-3 group px-8">
                <h3 className="text-base font-bold text-foreground">{activeChat.name}</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={startEditing}
                      className="absolute right-6 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted text-muted-foreground transition duration-150 cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Editar dados do contato</TooltipContent>
                </Tooltip>
              </div>
            )}

            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase flex items-center gap-1 bg-muted px-2.5 py-0.5 rounded-full">
                Origem: {activeChat.channel}
              </span>
            </div>
          </div>

          {/* Contact Fields */}
          <div className="space-y-3 bg-muted/40 p-3 rounded-2xl border border-line">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase">
                Informações
              </span>
              <button
                onClick={isEditingInfo ? handleSaveInfo : startEditing}
                className="text-[10px] font-bold text-primary hover:underline cursor-pointer"
              >
                {isEditingInfo ? "Salvar" : "Editar"}
              </button>
            </div>

            {isEditingInfo ? (
              <div className="space-y-2.5">
                <div className="space-y-0.5">
                  <label className="text-[9px] font-bold text-muted-foreground">Telefone</label>
                  <input
                    type="text"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="h-8 w-full rounded-lg bg-card px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[9px] font-bold text-muted-foreground">E-mail</label>
                  <input
                    type="text"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="h-8 w-full rounded-lg bg-card px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[9px] font-bold text-muted-foreground">CNPJ</label>
                  <input
                    type="text"
                    value={editForm.cnpj}
                    onChange={(e) => setEditForm({ ...editForm, cnpj: maskCNPJ(e.target.value) })}
                    className="h-8 w-full rounded-lg bg-card px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[9px] font-bold text-muted-foreground">CPF</label>
                  <input
                    type="text"
                    value={editForm.cpf}
                    onChange={(e) => setEditForm({ ...editForm, cpf: maskCPF(e.target.value) })}
                    className="h-8 w-full rounded-lg bg-card px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-foreground font-medium">
                    {formatPhoneNumber(activeChat.phone)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-foreground font-medium truncate">
                    {activeChat.email || "Não informado"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Building className="h-3.5 w-3.5 text-muted-foreground" />
                  <div>
                    <div className="text-xs text-foreground font-medium">
                      {formatCNPJ(activeChat.cnpj)}
                    </div>
                    {activeChat.cnpj && (
                      <span className="text-[9px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 mt-0.5 inline-block">
                        CNPJ Validado
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-foreground font-medium">
                    {formatCPF((activeChat as any).cpf)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Tags Section */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-primary" />
              Categorização (Tags)
            </h4>

            {/* Display Tags */}
            <div className="flex flex-wrap gap-1.5">
              {activeChat.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary-soft/50 px-2 py-0.5 text-[10px] font-bold text-primary border border-primary/10"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="text-primary hover:text-red-500 cursor-pointer"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              {activeChat.tags.length === 0 && (
                <span className="text-[10px] text-muted-foreground italic">
                  Nenhuma tag atribuída
                </span>
              )}
            </div>

            {/* Add Tag Form */}
            <form onSubmit={handleAddTag} className="flex gap-2">
              <input
                type="text"
                placeholder="Nova tag..."
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                className="h-8 flex-1 rounded-lg bg-muted px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
              />
              <button
                type="submit"
                className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition cursor-pointer"
              >
                <Plus className="h-4 w-4" />
              </button>
            </form>
          </div>

          {/* RD Station CRM Card Integration */}
          {activeChat.id !== "valentina" && (
            <RdCrmCard contactId={activeChat.contactId || activeChat.id} tenantId={tenant} />
          )}
        </div>
      ) : activeTab === "files" ? (
        /* TAB 2: ARQUIVOS COMPARTILHADOS (REAL IMPLEMENTATION) */
        selectedCategory ? (
          /* SUB-VISUALIZAÇÃO DE UMA CATEGORIA / LINKS */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header com botão voltar */}
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => setSelectedCategory(null)}
                className="flex items-center gap-1 text-[10px] font-bold text-primary hover:underline cursor-pointer bg-primary-soft px-2 py-1 rounded-lg animate-fade-in"
              >
                ← Voltar
              </button>
              <span className="text-xs font-bold text-foreground truncate">
                {selectedCategory === "links"
                  ? "Links Compartilhados"
                  : categories.find((c) => c.id === selectedCategory)?.label || "Arquivos"}
              </span>
            </div>

            {/* Listagem */}
            <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin space-y-2">
              {selectedCategory === "receita" ? (
                /* FICHA CADASTRAL DA RECEITA FEDERAL (100% EDITÁVEL) */
                <div className="space-y-3 pb-4">
                  <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800">
                    <div className="flex items-center gap-2">
                      <Building className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-[11px] font-bold text-emerald-900 dark:text-emerald-200">
                        Dados da Receita Federal
                      </span>
                    </div>
                    <button
                      onClick={handleQueryCnpjLive}
                      disabled={isSearchingCnpj}
                      className="flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold transition disabled:opacity-50 cursor-pointer shadow-sm"
                    >
                      <Search className="h-3 w-3" />
                      {isSearchingCnpj ? "Consultando..." : "Consultar API"}
                    </button>
                  </div>

                  {/* Form com todos os campos da Receita */}
                  <div className="space-y-2.5">
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Razão Social</label>
                      <input
                        type="text"
                        value={cnpjDetails.razaoSocial || ""}
                        onChange={(e) => setCnpjDetails({ ...cnpjDetails, razaoSocial: e.target.value })}
                        placeholder="Ex: Empresa Exemplo Ltda"
                        className="h-8 w-full rounded-lg bg-card px-2.5 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary"
                      />
                    </div>

                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Nome Fantasia</label>
                      <input
                        type="text"
                        value={cnpjDetails.nomeFantasia || ""}
                        onChange={(e) => setCnpjDetails({ ...cnpjDetails, nomeFantasia: e.target.value })}
                        placeholder="Ex: Nome Comercial"
                        className="h-8 w-full rounded-lg bg-card px-2.5 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">CNPJ</label>
                        <input
                          type="text"
                          value={cnpjDetails.cnpjFormatted || activeChat?.cnpj || ""}
                          onChange={(e) => setCnpjDetails({ ...cnpjDetails, cnpjFormatted: e.target.value })}
                          placeholder="00.000.000/0001-00"
                          className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-semibold border border-border focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Situação</label>
                        <input
                          type="text"
                          value={cnpjDetails.situacaoCadastral || ""}
                          onChange={(e) => setCnpjDetails({ ...cnpjDetails, situacaoCadastral: e.target.value })}
                          placeholder="Ativa / Baixada"
                          className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-semibold border border-border focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Abertura</label>
                        <input
                          type="text"
                          value={cnpjDetails.dataAbertura || ""}
                          onChange={(e) => setCnpjDetails({ ...cnpjDetails, dataAbertura: e.target.value })}
                          placeholder="AAAA-MM-DD"
                          className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Capital Social</label>
                        <input
                          type="text"
                          value={cnpjDetails.capitalSocial || ""}
                          onChange={(e) => setCnpjDetails({ ...cnpjDetails, capitalSocial: e.target.value })}
                          placeholder="R$ 0,00"
                          className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Nat. Jurídica</label>
                        <input
                          type="text"
                          value={cnpjDetails.naturezaJuridica || ""}
                          onChange={(e) => setCnpjDetails({ ...cnpjDetails, naturezaJuridica: e.target.value })}
                          placeholder="Sociedade Empresária"
                          className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Porte</label>
                        <input
                          type="text"
                          value={cnpjDetails.porte || ""}
                          onChange={(e) => setCnpjDetails({ ...cnpjDetails, porte: e.target.value })}
                          placeholder="ME / EPP / Demais"
                          className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Atividade Principal (CNAE)</label>
                      <textarea
                        rows={2}
                        value={cnpjDetails.atividadePrincipal || ""}
                        onChange={(e) => setCnpjDetails({ ...cnpjDetails, atividadePrincipal: e.target.value })}
                        placeholder="Descrição da atividade principal"
                        className="w-full rounded-lg bg-card p-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary resize-none"
                      />
                    </div>

                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Atividades Secundárias</label>
                      <textarea
                        rows={2}
                        value={cnpjDetails.atividadesSecundarias || ""}
                        onChange={(e) => setCnpjDetails({ ...cnpjDetails, atividadesSecundarias: e.target.value })}
                        placeholder="Descrição das atividades secundárias"
                        className="w-full rounded-lg bg-card p-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary resize-none"
                      />
                    </div>

                    {/* Endereço */}
                    <div className="pt-2 border-t border-border/60 space-y-2">
                      <span className="text-[10px] font-extrabold text-primary block uppercase tracking-wider">Endereço Comercial</span>
                      
                      <div>
                        <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Logradouro / Rua</label>
                        <input
                          type="text"
                          value={cnpjDetails.logradouro || ""}
                          onChange={(e) => setCnpjDetails({ ...cnpjDetails, logradouro: e.target.value })}
                          placeholder="Rua / Av"
                          className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Número</label>
                          <input
                            type="text"
                            value={cnpjDetails.numero || ""}
                            onChange={(e) => setCnpjDetails({ ...cnpjDetails, numero: e.target.value })}
                            className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Complemento</label>
                          <input
                            type="text"
                            value={cnpjDetails.complemento || ""}
                            onChange={(e) => setCnpjDetails({ ...cnpjDetails, complemento: e.target.value })}
                            className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Bairro</label>
                          <input
                            type="text"
                            value={cnpjDetails.bairro || ""}
                            onChange={(e) => setCnpjDetails({ ...cnpjDetails, bairro: e.target.value })}
                            className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Cidade</label>
                          <input
                            type="text"
                            value={cnpjDetails.municipio || ""}
                            onChange={(e) => setCnpjDetails({ ...cnpjDetails, municipio: e.target.value })}
                            className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">UF</label>
                          <input
                            type="text"
                            value={cnpjDetails.uf || ""}
                            onChange={(e) => setCnpjDetails({ ...cnpjDetails, uf: e.target.value })}
                            className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border uppercase"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">CEP</label>
                        <input
                          type="text"
                          value={cnpjDetails.cep || ""}
                          onChange={(e) => setCnpjDetails({ ...cnpjDetails, cep: e.target.value })}
                          className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                        />
                      </div>
                    </div>

                    {/* Contato & QSA */}
                    <div className="pt-2 border-t border-border/60 space-y-2">
                      <span className="text-[10px] font-extrabold text-primary block uppercase tracking-wider">Contato & Sócios (QSA)</span>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Telefone Empresa</label>
                          <input
                            type="text"
                            value={cnpjDetails.telefone || ""}
                            onChange={(e) => setCnpjDetails({ ...cnpjDetails, telefone: e.target.value })}
                            className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">E-mail Empresa</label>
                          <input
                            type="text"
                            value={cnpjDetails.email || ""}
                            onChange={(e) => setCnpjDetails({ ...cnpjDetails, email: e.target.value })}
                            className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Quadro de Sócios (QSA)</label>
                        <textarea
                          rows={2}
                          value={cnpjDetails.qsa || ""}
                          onChange={(e) => setCnpjDetails({ ...cnpjDetails, qsa: e.target.value })}
                          placeholder="Nome dos sócios e qualificações"
                          className="w-full rounded-lg bg-card p-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary resize-none"
                        />
                      </div>
                    </div>

                    {/* Botão de Salvar */}
                    <div className="pt-2">
                      <button
                        onClick={handleSaveCnpjDetails}
                        disabled={isSavingCnpj}
                        className="w-full flex items-center justify-center gap-2 h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition shadow-soft cursor-pointer disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" />
                        {isSavingCnpj ? "Salvando Ficha..." : "Salvar Dados da Receita"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : selectedCategory === "links" ? (
                /* LISTAGEM DE LINKS */
                parsedLinks.length > 0 ? (
                  parsedLinks.map((link) => (
                    <div
                      key={link.id}
                      className="p-3 rounded-2xl bg-muted/40 border border-line hover:bg-muted/70 transition flex flex-col gap-1.5"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <Link2 className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-primary break-all hover:underline"
                        >
                          {link.url}
                        </a>
                      </div>
                      <div className="flex justify-between items-center text-[9px] text-muted-foreground font-medium pl-6">
                        <span>{link.author}</span>
                        <span>{link.time}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-xs text-muted-foreground italic">
                    Nenhum link compartilhado
                  </div>
                )
              ) : (
                /* LISTAGEM DE ARQUIVOS */
                (() => {
                  const categoryObj = categories.find((c) => c.id === selectedCategory);
                  const filesList = categoryObj?.files || [];
                  return filesList.length > 0 ? (
                    filesList.map((file) => (
                      <div
                        key={file.id}
                        className="p-3 rounded-2xl bg-muted/40 border border-line hover:bg-muted/70 transition flex flex-col gap-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {selectedCategory === "images" ? (
                            <img
                              src={file.url}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-lg object-cover border border-border bg-black/5"
                            />
                          ) : (
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-soft/50 text-primary border border-primary/10">
                              {React.createElement(categoryObj?.icon || Folder, {
                                className: "h-5 w-5",
                              })}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div
                              className="text-xs font-bold text-foreground truncate"
                              title={file.name}
                            >
                              {file.name}
                            </div>
                            <div className="text-[9px] text-muted-foreground font-medium">
                              Enviado por {file.author} às {file.time}
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => window.open(file.url, "_blank")}
                            className="px-2.5 py-1 text-[10px] font-bold text-primary bg-primary-soft hover:bg-primary-soft/80 rounded-lg transition cursor-pointer"
                          >
                            Visualizar
                          </button>
                          <a
                            href={file.url}
                            download={file.name}
                            target="_blank"
                            className="px-2.5 py-1 text-[10px] font-bold text-foreground bg-muted border border-border hover:bg-muted/80 rounded-lg transition cursor-pointer text-center"
                          >
                            Baixar
                          </a>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-xs text-muted-foreground italic">
                      Nenhum arquivo nesta categoria
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        ) : (
          /* TAB 2: ARQUIVOS COMPARTILHADOS (LISTA GERAL DE CATEGORIAS) */
          <div className="flex-1 flex flex-col overflow-y-auto pr-1 scrollbar-thin">
            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="relative rounded-2xl bg-primary-soft/50 border border-primary/10 p-3">
                <div className="text-[10px] font-bold text-foreground/70">Arquivos</div>
                <div className="mt-4 flex items-end justify-between">
                  <Folder className="h-6 w-6 text-primary" fill="currentColor" strokeWidth={0} />
                  <span className="text-xl font-bold text-foreground">
                    {parsedMediaFiles.length}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedCategory("links")}
                className="relative text-left rounded-2xl bg-muted p-3 border border-border hover:bg-muted/60 transition cursor-pointer"
              >
                <div className="text-[10px] font-bold text-foreground/70">Links</div>
                <div className="mt-4 flex items-end justify-between">
                  <Link2 className="h-6 w-6 text-muted-foreground" strokeWidth={2} />
                  <span className="text-xl font-bold text-foreground">{parsedLinks.length}</span>
                </div>
              </button>
            </div>

            <h4 className="text-xs font-bold text-foreground mb-2 px-1">Tipos de arquivo</h4>
            <ul className="space-y-1">
              {categories.map((c) => {
                const Icon = c.icon;
                return (
                  <li key={c.label}>
                    <button
                      onClick={() => setSelectedCategory(c.id)}
                      className="flex w-full items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-muted/60 cursor-pointer"
                    >
                      <div
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
                        style={{ background: c.bg }}
                      >
                        <Icon className="h-4.5 w-4.5" style={{ color: c.color }} strokeWidth={2} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-foreground">{c.label}</div>
                        <div className="text-[10px] text-muted-foreground">{c.count}</div>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* FICHA CADASTRAL DA RECEITA FEDERAL (DIRETAMENTE NA ABA DE ARQUIVOS) */}
            <div className="mt-5 pt-4 border-t border-line space-y-3 pb-6">
              <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800">
                <div className="flex items-center gap-2">
                  <Building className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-[11px] font-bold text-emerald-900 dark:text-emerald-200">
                    Dados da Receita Federal
                  </span>
                </div>
                <button
                  onClick={handleQueryCnpjLive}
                  disabled={isSearchingCnpj}
                  className="flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold transition disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  <Search className="h-3 w-3" />
                  {isSearchingCnpj ? "Consultando..." : "Consultar API"}
                </button>
              </div>

              {/* Form com todos os campos da Receita */}
              <div className="space-y-2.5">
                <div>
                  <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Razão Social</label>
                  <input
                    type="text"
                    value={cnpjDetails.razaoSocial || ""}
                    onChange={(e) => setCnpjDetails({ ...cnpjDetails, razaoSocial: e.target.value })}
                    placeholder="Ex: Empresa Exemplo Ltda"
                    className="h-8 w-full rounded-lg bg-card px-2.5 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Nome Fantasia</label>
                  <input
                    type="text"
                    value={cnpjDetails.nomeFantasia || ""}
                    onChange={(e) => setCnpjDetails({ ...cnpjDetails, nomeFantasia: e.target.value })}
                    placeholder="Ex: Nome Comercial"
                    className="h-8 w-full rounded-lg bg-card px-2.5 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">CNPJ</label>
                    <input
                      type="text"
                      value={cnpjDetails.cnpjFormatted || activeChat?.cnpj || ""}
                      onChange={(e) => setCnpjDetails({ ...cnpjDetails, cnpjFormatted: e.target.value })}
                      placeholder="00.000.000/0001-00"
                      className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-semibold border border-border focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Situação</label>
                    <input
                      type="text"
                      value={cnpjDetails.situacaoCadastral || ""}
                      onChange={(e) => setCnpjDetails({ ...cnpjDetails, situacaoCadastral: e.target.value })}
                      placeholder="Ativa / Baixada"
                      className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-semibold border border-border focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Abertura</label>
                    <input
                      type="text"
                      value={cnpjDetails.dataAbertura || ""}
                      onChange={(e) => setCnpjDetails({ ...cnpjDetails, dataAbertura: e.target.value })}
                      placeholder="AAAA-MM-DD"
                      className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Capital Social</label>
                    <input
                      type="text"
                      value={cnpjDetails.capitalSocial || ""}
                      onChange={(e) => setCnpjDetails({ ...cnpjDetails, capitalSocial: e.target.value })}
                      placeholder="R$ 0,00"
                      className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Nat. Jurídica</label>
                    <input
                      type="text"
                      value={cnpjDetails.naturezaJuridica || ""}
                      onChange={(e) => setCnpjDetails({ ...cnpjDetails, naturezaJuridica: e.target.value })}
                      placeholder="Sociedade Empresária"
                      className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Porte</label>
                    <input
                      type="text"
                      value={cnpjDetails.porte || ""}
                      onChange={(e) => setCnpjDetails({ ...cnpjDetails, porte: e.target.value })}
                      placeholder="ME / EPP / Demais"
                      className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Atividade Principal (CNAE)</label>
                  <textarea
                    rows={2}
                    value={cnpjDetails.atividadePrincipal || ""}
                    onChange={(e) => setCnpjDetails({ ...cnpjDetails, atividadePrincipal: e.target.value })}
                    placeholder="Descrição da atividade principal"
                    className="w-full rounded-lg bg-card p-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary resize-none"
                  />
                </div>

                <div>
                  <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Atividades Secundárias</label>
                  <textarea
                    rows={2}
                    value={cnpjDetails.atividadesSecundarias || ""}
                    onChange={(e) => setCnpjDetails({ ...cnpjDetails, atividadesSecundarias: e.target.value })}
                    placeholder="Descrição das atividades secundárias"
                    className="w-full rounded-lg bg-card p-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary resize-none"
                  />
                </div>

                {/* Endereço */}
                <div className="pt-2 border-t border-border/60 space-y-2">
                  <span className="text-[10px] font-extrabold text-primary block uppercase tracking-wider">Endereço Comercial</span>
                  
                  <div>
                    <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Logradouro / Rua</label>
                    <input
                      type="text"
                      value={cnpjDetails.logradouro || ""}
                      onChange={(e) => setCnpjDetails({ ...cnpjDetails, logradouro: e.target.value })}
                      placeholder="Rua / Av"
                      className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Número</label>
                      <input
                        type="text"
                        value={cnpjDetails.numero || ""}
                        onChange={(e) => setCnpjDetails({ ...cnpjDetails, numero: e.target.value })}
                        className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Complemento</label>
                      <input
                        type="text"
                        value={cnpjDetails.complemento || ""}
                        onChange={(e) => setCnpjDetails({ ...cnpjDetails, complemento: e.target.value })}
                        className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Bairro</label>
                      <input
                        type="text"
                        value={cnpjDetails.bairro || ""}
                        onChange={(e) => setCnpjDetails({ ...cnpjDetails, bairro: e.target.value })}
                        className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Cidade</label>
                      <input
                        type="text"
                        value={cnpjDetails.municipio || ""}
                        onChange={(e) => setCnpjDetails({ ...cnpjDetails, municipio: e.target.value })}
                        className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">UF</label>
                      <input
                        type="text"
                        value={cnpjDetails.uf || ""}
                        onChange={(e) => setCnpjDetails({ ...cnpjDetails, uf: e.target.value })}
                        className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border uppercase"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">CEP</label>
                    <input
                      type="text"
                      value={cnpjDetails.cep || ""}
                      onChange={(e) => setCnpjDetails({ ...cnpjDetails, cep: e.target.value })}
                      className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                    />
                  </div>
                </div>

                {/* Contato & QSA */}
                <div className="pt-2 border-t border-border/60 space-y-2">
                  <span className="text-[10px] font-extrabold text-primary block uppercase tracking-wider">Contato & Sócios (QSA)</span>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Telefone Empresa</label>
                      <input
                        type="text"
                        value={cnpjDetails.telefone || ""}
                        onChange={(e) => setCnpjDetails({ ...cnpjDetails, telefone: e.target.value })}
                        className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">E-mail Empresa</label>
                      <input
                        type="text"
                        value={cnpjDetails.email || ""}
                        onChange={(e) => setCnpjDetails({ ...cnpjDetails, email: e.target.value })}
                        className="h-8 w-full rounded-lg bg-card px-2 text-xs text-foreground font-medium border border-border"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Quadro de Sócios (QSA)</label>
                    <textarea
                      rows={2}
                      value={cnpjDetails.qsa || ""}
                      onChange={(e) => setCnpjDetails({ ...cnpjDetails, qsa: e.target.value })}
                      placeholder="Nome dos sócios e qualificações"
                      className="w-full rounded-lg bg-card p-2 text-xs text-foreground font-medium border border-border focus:ring-1 focus:ring-primary resize-none"
                    />
                  </div>
                </div>

                {/* Botão de Salvar */}
                <div className="pt-2">
                  <button
                    onClick={handleSaveCnpjDetails}
                    disabled={isSavingCnpj}
                    className="w-full flex items-center justify-center gap-2 h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition shadow-soft cursor-pointer disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {isSavingCnpj ? "Salvando Ficha..." : "Salvar Dados da Receita"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      ) : (
        /* TAB 3: EVENTOS */
        <div className="flex-1 flex flex-col overflow-hidden">
          <span className="text-[10px] font-bold text-muted-foreground uppercase mb-3 block px-1">
            Linha do Tempo
          </span>
          <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin">
            {activeChat.messages && activeChat.messages.filter(isHistoryEvent).length > 0 ? (
              <div className="relative pl-4 border-l border-line space-y-4 py-2 ml-2">
                {activeChat.messages.filter(isHistoryEvent).map((msg) => {
                  const eventInfo = parseHistoryEvent(msg);
                  return (
                    <div key={msg.id} className="relative group">
                      {/* Timeline dot */}
                      <span
                        className={`absolute -left-[21px] top-1 grid h-4.5 w-4.5 place-items-center rounded-full border border-background shadow-sm ${eventInfo.dotBg}`}
                      >
                        {React.createElement(eventInfo.icon, {
                          className: `h-2.5 w-2.5 ${eventInfo.iconColor}`,
                        })}
                      </span>
                      <div className="bg-muted/40 hover:bg-muted/60 transition-colors border border-line rounded-2xl p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-foreground">
                            {eventInfo.title}
                          </span>
                          <span className="text-[9px] font-semibold text-muted-foreground whitespace-nowrap">
                            {msg.time}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed font-medium">
                          {eventInfo.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-xs text-muted-foreground italic">
                Nenhum evento registrado neste atendimento.
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
