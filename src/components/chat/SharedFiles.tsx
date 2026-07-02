import React, { useState } from "react";
import { useChat } from "@/hooks/useChatState";
import { WhatsappLogo, InstagramLogo, MessengerLogo } from "./ChatList";
import { formatPhoneNumber } from "@/lib/utils";
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
} from "lucide-react";

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

  const [activeTab, setActiveTab] = useState<"details" | "files" | "channel">("details");
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
      cnpj: activeChat.cnpj || "",
      cpf: (activeChat as any).cpf || "",
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
  
  const parsedMediaFiles = mediaMessages.map((m) => {
    const match = m.text.match(/^\[MEDIA:(image|video|audio|document|sticker)\]([^:]+)(?::(.+))?$/);
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
  }).filter(Boolean) as Array<{
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

  const handleTabChange = (tab: "details" | "files" | "channel") => {
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
        <button
          onClick={() => setRightSidebarOpen(false)}
          className="grid h-6 w-6 place-items-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
          title="Minimizar Painel"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>

      {/* Header Tabs (3 segments for Details, Shared Files and Channel Integration) */}
      <div className="flex rounded-xl bg-muted p-1">
        <button
          onClick={() => handleTabChange("details")}
          className={`flex-1 rounded-lg py-1.5 text-center text-[10px] font-bold transition cursor-pointer ${
            activeTab === "details" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          📋 Dados
        </button>
        <button
          onClick={() => handleTabChange("files")}
          className={`flex-1 rounded-lg py-1.5 text-center text-[10px] font-bold transition cursor-pointer ${
            activeTab === "files" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          📁 Arquivos
        </button>
        <button
          onClick={() => handleTabChange("channel")}
          className={`flex-1 rounded-lg py-1.5 text-center text-[10px] font-bold transition cursor-pointer ${
            activeTab === "channel" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          🔗 Canal
        </button>
      </div>

      <div className="my-4 h-px bg-line" />

      {activeTab === "details" ? (
        /* TAB 1: DADOS DO CLIENTE */
        <div className="flex-1 flex flex-col overflow-y-auto pr-1 scrollbar-thin space-y-5">
          {/* Avatar and Name */}
          <div className="flex flex-col items-center text-center">
            {activeChat.avatar ? (
              <img src={activeChat.avatar} alt="" className="h-16 w-16 rounded-full object-cover border border-border shadow-soft" />
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
                <label className="text-[9px] font-bold text-muted-foreground block text-center mb-0.5">Nome Completo</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="h-8 w-full rounded-lg bg-card px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary border border-border text-center"
                />
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mt-3 group">
                <h3 className="text-base font-bold text-foreground">{activeChat.name}</h3>
                <button
                  onClick={startEditing}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted text-muted-foreground transition duration-150 cursor-pointer"
                  title="Editar dados do contato"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
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
              <span className="text-[10px] font-bold text-muted-foreground uppercase">Informações</span>
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
                    onChange={(e) => setEditForm({ ...editForm, cnpj: e.target.value })}
                    className="h-8 w-full rounded-lg bg-card px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[9px] font-bold text-muted-foreground">CPF</label>
                  <input
                    type="text"
                    value={editForm.cpf}
                    onChange={(e) => setEditForm({ ...editForm, cpf: e.target.value })}
                    className="h-8 w-full rounded-lg bg-card px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-foreground font-medium">{formatPhoneNumber(activeChat.phone)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-foreground font-medium truncate">{activeChat.email || "Não informado"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Building className="h-3.5 w-3.5 text-muted-foreground" />
                  <div>
                    <div className="text-xs text-foreground font-medium">{activeChat.cnpj || "Não informado"}</div>
                    {activeChat.cnpj && (
                      <span className="text-[9px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 mt-0.5 inline-block">
                        CNPJ Validado
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-foreground font-medium">{(activeChat as any).cpf || "Não informado"}</span>
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
                  <button onClick={() => handleRemoveTag(tag)} className="text-primary hover:text-red-500 cursor-pointer">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              {activeChat.tags.length === 0 && (
                <span className="text-[10px] text-muted-foreground italic">Nenhuma tag atribuída</span>
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
              {selectedCategory === "links" ? (
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
                              {React.createElement(categoryObj?.icon || Folder, { className: "h-5 w-5" })}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-foreground truncate" title={file.name}>
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
                  <span className="text-xl font-bold text-foreground">{parsedMediaFiles.length}</span>
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
          </div>
        )
      ) : (
        /* TAB 3: STATUS DO CANAL */
        <div className="flex-1 flex flex-col overflow-y-auto pr-1 scrollbar-thin space-y-4">
          {tenant === "tecfag" ? (
            /* META CONFIG PREVIEW */
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-muted p-3 border border-line">
                <span className="text-xs font-bold text-foreground">API Oficial Meta</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 uppercase bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ativo
                </span>
              </div>

              <div className="space-y-2.5 text-xs bg-muted/20 p-3 rounded-xl border border-line">
                <div>
                  <span className="block text-[9px] font-bold text-muted-foreground uppercase">Business Account ID</span>
                  <span className="font-mono text-foreground font-medium">{metaConfig.businessAccountId}</span>
                </div>
                <div>
                  <span className="block text-[9px] font-bold text-muted-foreground uppercase">WhatsApp Number ID</span>
                  <span className="font-mono text-foreground font-medium">{metaConfig.phoneNumberId}</span>
                </div>
              </div>

              {/* Webhook Logs mockup */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                  <Radio className="h-3 w-3 text-primary animate-pulse" /> Webhook Live Logs
                </span>
                <div className="rounded-xl bg-neutral-900 p-3 font-mono text-[9px] text-neutral-400 space-y-1.5 max-h-40 overflow-y-auto">
                  <div className="text-emerald-500">[10:48:02] POST 200 OK</div>
                  <div>- Event: msg_received</div>
                  <div>- From: Pedro Silva</div>
                  <div className="text-neutral-500">[10:48:03] Processed by AI</div>
                  <div className="text-emerald-500">[10:50:11] POST 200 OK</div>
                  <div>- Event: msg_delivered</div>
                </div>
              </div>
            </div>
          ) : (
            /* BAILEYS STATUS & QR CODE */
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-muted p-3 border border-line">
                <span className="text-xs font-bold text-foreground">Status Baileys</span>
                
                {baileysConfig.status === "connected" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 uppercase bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                    Conectado
                  </span>
                )}
                {baileysConfig.status === "qr_ready" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 uppercase bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                    Aguardando QR
                  </span>
                )}
                {baileysConfig.status === "connecting" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 uppercase bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                    Iniciando...
                  </span>
                )}
                {baileysConfig.status === "disconnected" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 uppercase bg-red-50 px-2 py-0.5 rounded border border-red-100">
                    Desconectado
                  </span>
                )}
              </div>

              {baileysConfig.status === "connected" ? (
                <div className="rounded-xl bg-emerald-50/50 border border-emerald-100 p-4 text-center">
                  <Smartphone className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
                  <h5 className="text-xs font-bold text-foreground">Aparelho Conectado</h5>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Valem Chat pareado no WhatsApp Web:
                  </p>
                  <div className="text-xs font-bold text-emerald-700 mt-1">{baileysConfig.pairedPhone}</div>

                  <button
                    onClick={disconnectBaileys}
                    className="mt-4 inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 text-[10px] font-bold text-red-600 hover:bg-red-100/50 transition cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Desconectar Celular
                  </button>
                </div>
              ) : baileysConfig.status === "connecting" ? (
                <div className="py-8 text-center bg-muted/40 rounded-xl border border-line">
                  <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
                  <p className="text-[10px] text-muted-foreground">Iniciando servidor de sessões Baileys...</p>
                </div>
              ) : baileysConfig.status === "qr_ready" ? (
                <div className="space-y-3 text-center bg-muted/40 p-4 rounded-xl border border-line">
                  <div className="bg-white p-2 rounded-lg inline-block border border-border shadow-soft">
                    {baileysConfig.qrCodeUrl ? (
                      <img src={baileysConfig.qrCodeUrl} alt="QR Code" className="h-32 w-32 object-contain" />
                    ) : (
                      <QrCode className="h-32 w-32 text-muted-foreground animate-pulse" />
                    )}
                  </div>
                  <h5 className="text-xs font-bold text-foreground">Escaneie o QR Code</h5>
                  <p className="text-[9px] text-muted-foreground max-w-[180px] mx-auto">
                    Abra o WhatsApp no seu celular, vá em Aparelhos Conectados e escaneie este código.
                  </p>
                  <button
                    onClick={() => {
                      connectBaileys();
                    }}
                    className="mt-2 text-[9px] text-primary font-bold hover:underline"
                  >
                    [Simular Leitura no Celular]
                  </button>
                </div>
              ) : (
                <div className="rounded-xl bg-red-50/50 border border-red-100 p-4 text-center">
                  <Smartphone className="h-8 w-8 text-red-500 mx-auto mb-2" />
                  <h5 className="text-xs font-bold text-foreground">Celular Desconectado</h5>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Você precisa gerar um código QR para sincronizar as mensagens da Valem.
                  </p>
                  <button
                    onClick={connectBaileys}
                    className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 text-[10px] font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer"
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    Conectar Celular
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
