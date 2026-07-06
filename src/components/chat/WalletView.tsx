import React, { useState, useRef } from "react";
import { useChat } from "@/hooks/useChatState";
import { WhatsappLogo, InstagramLogo, MessengerLogo } from "./ChatList";
import { formatPhoneNumber, formatCPF, formatCNPJ } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Plus,
  User,
  Phone,
  Mail,
  Building,
  Tag,
  MessageSquare,
  Edit2,
  Trash2,
  X,
  PlusCircle,
  Briefcase,
  LayoutTemplate,
  Check,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { Conversation, OperatorTemplate } from "@/lib/mockData";

export function WalletView() {
  const {
    tenant,
    conversations,
    operators,
    currentOperatorId,
    templates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    setSelectedChatId,
    setActiveView,
    setActiveQueue,
  } = useChat();

  const [activeTab, setActiveTab] = useState<"wallet" | "templates">("wallet");
  const [search, setSearch] = useState("");
  
  // Template CRUD modal states
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingTemplate, setEditingTemplate] = useState<OperatorTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState({
    title: "",
    text: "",
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInsertTag = (tag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentText = templateForm.text;

    const newText = currentText.substring(0, start) + tag + currentText.substring(end);
    setTemplateForm({ ...templateForm, text: newText });

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 50);
  };

  // Filter clients in the wallet (walletOperatorId === currentOperatorId)
  const walletClients = conversations.filter((c) => {
    const isInWallet = c.walletOperatorId === currentOperatorId;
    if (!isInWallet) return false;

    if (search.trim() !== "") {
      const q = search.toLowerCase();
      const matchName = c.name.toLowerCase().includes(q);
      const matchPhone = c.phone?.toLowerCase().includes(q) || false;
      const matchEmail = c.email?.toLowerCase().includes(q) || false;
      const matchCnpj = c.cnpj?.toLowerCase().includes(q) || false;
      const matchCpf = c.cpf?.toLowerCase().includes(q) || false;
      return matchName || matchPhone || matchEmail || matchCnpj || matchCpf;
    }
    return true;
  });

  // Filter templates of the operator
  const filteredTemplates = templates.filter((tpl) => {
    if (search.trim() !== "") {
      const q = search.toLowerCase();
      return (
        tpl.title.toLowerCase().includes(q) || tpl.text.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Stats
  const activeAttendancesCount = walletClients.filter(
    (c) => c.queue === "meus" && c.operatorId === currentOperatorId
  ).length;

  const handleOpenCreateModal = () => {
    setModalMode("create");
    setTemplateForm({ title: "", text: "" });
    setShowModal(true);
  };

  const handleOpenEditModal = (tpl: OperatorTemplate) => {
    setModalMode("edit");
    setEditingTemplate(tpl);
    setTemplateForm({ title: tpl.title, text: tpl.text });
    setShowModal(true);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateForm.title.trim() || !templateForm.text.trim()) return;

    if (modalMode === "create") {
      await createTemplate(templateForm.title, templateForm.text);
    } else if (modalMode === "edit" && editingTemplate) {
      await updateTemplate(editingTemplate.id, templateForm.title, templateForm.text);
    }

    setShowModal(false);
  };

  const handleDeleteTemplate = async (id: string) => {
    if (confirm("Tem certeza que deseja excluir este template?")) {
      await deleteTemplate(id);
    }
  };

  const getAttendanceStatus = (c: Conversation) => {
    if (c.queue === "finalizados") {
      return { text: "Sem atendimento ativo", color: "text-muted-foreground bg-muted/50 border-muted-foreground/20" };
    }
    if (c.queue === "fila") {
      return { text: "Aguardando na fila", color: "text-amber-500 bg-amber-500/10 border-amber-500/20" };
    }
    if (c.queue === "meus") {
      if (c.operatorId === currentOperatorId) {
        return { text: "Atendimento com você", color: "text-primary bg-primary-soft border-primary/20" };
      } else {
        const op = operators.find((o) => o.id === c.operatorId);
        return {
          text: `Ativo com ${op ? op.name : "outro atendente"}`,
          color: "text-blue-500 bg-blue-500/10 border-blue-500/20",
        };
      }
    }
    return { text: "Sem atendimento ativo", color: "text-muted-foreground bg-muted/50 border-muted-foreground/20" };
  };

  const handleGoToChat = (c: Conversation) => {
    setSelectedChatId(c.id);
    if (c.queue === "fila" || c.queue === "finalizados" || c.queue === "meus" || c.queue === "automacao") {
      setActiveQueue(c.queue);
    }
    setActiveView("chat");
  };

  return (
    <div className="flex h-full w-full flex-col rounded-3xl bg-card border border-border p-6 shadow-soft overflow-hidden select-none">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Minha Carteira & Templates</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Gerencie seus clientes vinculados e configure suas respostas rápidas personalizadas.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 rounded-2xl bg-muted p-1 border border-border">
          <button
            onClick={() => {
              setActiveTab("wallet");
              setSearch("");
            }}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "wallet"
                ? "bg-card text-foreground shadow-soft border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Briefcase className="h-3.5 w-3.5" />
            Clientes da Carteira
          </button>
          <button
            onClick={() => {
              setActiveTab("templates");
              setSearch("");
            }}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "templates"
                ? "bg-card text-foreground shadow-soft border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            Meus Templates
          </button>
        </div>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-1 gap-4 py-6 sm:grid-cols-3">
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-soft">
          <div className="rounded-xl bg-primary-soft p-3 text-primary">
            <Briefcase className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Clientes em Carteira</div>
            <div className="text-xl font-bold text-foreground mt-0.5">{walletClients.length}</div>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-soft">
          <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-500">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Atendimentos Ativos</div>
            <div className="text-xl font-bold text-foreground mt-0.5">{activeAttendancesCount}</div>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-soft">
          <div className="rounded-xl bg-blue-500/10 p-3 text-blue-500">
            <LayoutTemplate className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Meus Templates</div>
            <div className="text-xl font-bold text-foreground mt-0.5">{templates.length}</div>
          </div>
        </div>
      </div>

      {/* Controls: Search and Actions */}
      <div className="flex items-center justify-between gap-4 pb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={
              activeTab === "wallet"
                ? "Buscar cliente por nome, telefone ou CNPJ/CPF..."
                : "Buscar template por título ou conteúdo..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl border border-border bg-muted/40 py-2.5 pl-10 pr-4 text-xs text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus:bg-card focus:shadow-soft"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {activeTab === "templates" && (
          <button
            onClick={handleOpenCreateModal}
            className="flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground transition-all hover:opacity-95 active:scale-98 shadow-soft cursor-pointer"
          >
            <PlusCircle className="h-4 w-4" />
            Criar Template
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin pr-1">
        <AnimatePresence mode="wait">
          {activeTab === "wallet" ? (
            <motion.div
              key="wallet-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {walletClients.length > 0 ? (
                <div className="overflow-x-auto rounded-2xl border border-border bg-card">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-line bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        <th className="p-4">Cliente</th>
                        <th className="p-4">Canais / Contato</th>
                        <th className="p-4">CPF / CNPJ</th>
                        <th className="p-4">Status de Atendimento</th>
                        <th className="p-4 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line text-xs">
                      {walletClients.map((c) => {
                        const statusInfo = getAttendanceStatus(c);
                        const initials = c.name
                          .split(" ")
                          .map((w) => w[0])
                          .join("")
                          .toUpperCase()
                          .substring(0, 2);

                        return (
                          <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                {c.avatar ? (
                                  <img
                                    src={c.avatar}
                                    alt={c.name}
                                    className="h-9 w-9 rounded-xl object-cover border border-border"
                                  />
                                ) : (
                                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-xs font-bold text-primary border border-border">
                                    {initials}
                                  </div>
                                )}
                                <div>
                                  <div className="font-semibold text-foreground">{c.name}</div>
                                  <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                    {c.channel === "whatsapp" && <WhatsappLogo className="h-3 w-3 inline text-emerald-500" />}
                                    {c.channel === "instagram" && <InstagramLogo className="h-3 w-3 inline text-pink-500" />}
                                    {c.channel === "messenger" && <MessengerLogo className="h-3 w-3 inline text-blue-500" />}
                                    <span className="capitalize">{c.channel}</span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="flex flex-col gap-0.5">
                                {c.phone && (
                                  <span className="font-medium text-foreground flex items-center gap-1">
                                    <Phone className="h-3 w-3 text-muted-foreground" />
                                    {formatPhoneNumber(c.phone)}
                                  </span>
                                )}
                                {c.email && (
                                  <span className="text-muted-foreground flex items-center gap-1">
                                    <Mail className="h-3 w-3 text-muted-foreground" />
                                    {c.email}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-4">
                              {c.cnpj ? (
                                <span className="font-medium text-foreground flex items-center gap-1">
                                  <Building className="h-3.5 w-3.5 text-muted-foreground" />
                                  {formatCNPJ(c.cnpj)}
                                </span>
                              ) : c.cpf ? (
                                <span className="font-medium text-foreground flex items-center gap-1">
                                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                                  {formatCPF(c.cpf)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground italic">-</span>
                              )}
                            </td>
                            <td className="p-4">
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusInfo.color}`}>
                                {statusInfo.text}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <button
                                onClick={() => handleGoToChat(c)}
                                className="inline-flex items-center gap-1 rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-primary-soft hover:text-primary transition cursor-pointer border border-border hover:border-primary/20"
                              >
                                Conversar
                                <ChevronRight className="h-3 w-3" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-6 text-center">
                  <Briefcase className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <h3 className="text-sm font-semibold text-foreground">Sua carteira está vazia</h3>
                  <p className="text-xs text-muted-foreground max-w-sm mt-1">
                    Clientes serão vinculados automaticamente a você assim que você capturar ou iniciar um atendimento para eles.
                  </p>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="templates-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {filteredTemplates.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredTemplates.map((tpl) => (
                    <div
                      key={tpl.id}
                      className="flex flex-col justify-between rounded-2xl border border-border bg-card p-4 shadow-soft hover:border-primary/30 transition duration-200"
                    >
                      <div>
                        <h3 className="text-sm font-bold text-foreground line-clamp-1">{tpl.title}</h3>
                        <p className="text-xs text-muted-foreground/80 mt-2 line-clamp-4 font-normal whitespace-pre-line leading-relaxed bg-muted/30 rounded-xl p-3 border border-border/40">
                          {tpl.text}
                        </p>
                      </div>
                      <div className="mt-4 flex items-center justify-end gap-2 border-t border-line pt-3">
                        <button
                          onClick={() => handleOpenEditModal(tpl)}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-primary-soft hover:text-primary transition cursor-pointer"
                          title="Editar"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteTemplate(tpl.id)}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition cursor-pointer"
                          title="Excluir"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-6 text-center">
                  <LayoutTemplate className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <h3 className="text-sm font-semibold text-foreground">Nenhum template criado</h3>
                  <p className="text-xs text-muted-foreground max-w-sm mt-1">
                    Crie templates de mensagens frequentes para enviar rapidamente aos seus clientes durante o chat.
                  </p>
                  <button
                    onClick={handleOpenCreateModal}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-95 transition cursor-pointer shadow-soft"
                  >
                    <Plus className="h-4 w-4" />
                    Criar Meu Primeiro Template
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Create / Edit Template Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-card border border-border p-6 shadow-card">
            <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
              <h2 className="text-md font-bold text-foreground">
                {modalMode === "create" ? "Criar Novo Template" : "Editar Template"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTemplate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/80">Título do Template</label>
                <input
                  type="text"
                  placeholder="Ex: Saudação de boas-vindas"
                  value={templateForm.title}
                  onChange={(e) => setTemplateForm({ ...templateForm, title: e.target.value })}
                  className="rounded-2xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus:bg-card focus:shadow-soft"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/80">Mensagem</label>
                <textarea
                  ref={textareaRef}
                  placeholder="Olá! Como posso te ajudar hoje?"
                  value={templateForm.text}
                  onChange={(e) => setTemplateForm({ ...templateForm, text: e.target.value })}
                  rows={4}
                  className="rounded-2xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus:bg-card focus:shadow-soft resize-none scrollbar-thin leading-relaxed"
                  required
                />
              </div>

              {/* Tags Dinâmicas */}
              <div className="rounded-2xl bg-muted/50 p-3.5 border border-border/60">
                <span className="text-[9px] font-extrabold uppercase tracking-wide text-primary block mb-2">
                  Tags Dinâmicas (Clique para inserir)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleInsertTag("<<1>>")}
                    className="flex flex-col items-center justify-center gap-1 bg-card hover:bg-muted border border-border/80 hover:border-primary/20 rounded-xl p-2 transition cursor-pointer text-center group active:scale-95"
                    title="Inserir Nome do Vendedor"
                  >
                    <code className="text-primary font-bold font-mono px-1.5 py-0.5 bg-primary-soft rounded text-[10px] group-hover:bg-primary group-hover:text-primary-foreground transition">{"<<1>>"}</code>
                    <span className="text-[9px] text-muted-foreground font-medium">Nome do Vendedor</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertTag("<<2>>")}
                    className="flex flex-col items-center justify-center gap-1 bg-card hover:bg-muted border border-border/80 hover:border-primary/20 rounded-xl p-2 transition cursor-pointer text-center group active:scale-95"
                    title="Inserir Nome do Cliente"
                  >
                    <code className="text-primary font-bold font-mono px-1.5 py-0.5 bg-primary-soft rounded text-[10px] group-hover:bg-primary group-hover:text-primary-foreground transition">{"<<2>>"}</code>
                    <span className="text-[9px] text-muted-foreground font-medium">Nome do Cliente</span>
                  </button>
                </div>
                <p className="text-[9px] text-muted-foreground/80 mt-2 leading-relaxed text-center">
                  * No envio do chat, as tags são trocadas pelos nomes reais correspondentes.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-line pt-4 mt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-2xl border border-border px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-2xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-95 transition cursor-pointer shadow-soft"
                >
                  <Check className="h-4 w-4" />
                  Salvar Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
