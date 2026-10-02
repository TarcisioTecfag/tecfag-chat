import React, { useState, useEffect } from "react";
import {
  X,
  Building2,
  DollarSign,
  Star,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  PauseCircle,
  MessageSquare,
  ListTodo,
  History,
  Phone,
  Mail,
  Send,
  Plus,
  ChevronRight,
  ExternalLink,
  Edit2,
  Check,
  AlertCircle,
  Loader2,
  Calendar,
  Bookmark,
  Trash2,
  MessageCircle,
  Package,
  FileText,
  Copy,
  Percent,
  ShoppingBag,
  Users,
  RotateCcw,
  Link2,
  Unlink,
  Paperclip,
  ClipboardCheck,
  Sparkles,
  Download,
  ArrowLeft,
  UploadCloud,
  FileUp,
  Eye,
  Pencil,
  CheckSquare,
  Utensils,
  MapPin,
  Bold,
  Italic,
  List,
  ListOrdered,
  PhoneCall,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { DealAddContactDrawer } from "./DealAddContactDrawer";
import { useChat } from "@/hooks/useChatState";
import { AccountDetailModal } from "./AccountDetailModal";
import { CreateTaskModal } from "./CreateTaskModal";
import { CustomFieldsEditor, CustomFieldsSummary, changedCustomFieldValues } from "./CustomFieldsEditor";
import { ContactCustomFieldsCard } from "./ContactCustomFieldsCard";
import { DealEmailTab } from "./DealEmailTab";
import { CatalogSelect } from "./CatalogSelect";
import {
  DealFilePreviewModal,
  DealFileItem,
  getFileCategory,
  getCategoryBadge,
  formatBytes,
} from "./DealFilePreviewModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SystemTooltip } from "@/components/ui/tooltip";
import { formatDealEvent } from "@/lib/crm/deal-event-format";

function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return "";
  const tokenRegex = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, index) => {
    if (!part) return null;

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, url] = linkMatch;
      const href = url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
      return (
        <a
          key={index}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary font-semibold underline hover:opacity-80 transition-opacity break-all cursor-pointer"
        >
          {label}
        </a>
      );
    }

    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={index} className="font-extrabold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2 && !part.startsWith("**")) {
      return (
        <em key={index} className="italic text-foreground/90">
          {part.slice(1, -1)}
        </em>
      );
    }

    return part;
  });
}

function renderMarkdownContent(text: string) {
  if (!text) return null;

  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let currentList: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushList = () => {
    if (!currentList) return;
    if (currentList.type === "ul") {
      nodes.push(
        <ul key={`ul-${nodes.length}`} className="my-1 ml-4 list-disc space-y-0.5 text-foreground leading-relaxed">
          {currentList.items.map((it, idx) => (
            <li key={idx}>{renderInlineMarkdown(it)}</li>
          ))}
        </ul>
      );
    } else {
      nodes.push(
        <ol key={`ol-${nodes.length}`} className="my-1 ml-4 list-decimal space-y-0.5 text-foreground leading-relaxed">
          {currentList.items.map((it, idx) => (
            <li key={idx}>{renderInlineMarkdown(it)}</li>
          ))}
        </ol>
      );
    }
    currentList = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const bulletMatch = rawLine.match(/^[-*•]\s+(.*)$/);
    const numMatch = rawLine.match(/^\d+[\.\)]\s+(.*)$/);

    if (bulletMatch) {
      if (currentList && currentList.type !== "ul") flushList();
      if (!currentList) currentList = { type: "ul", items: [] };
      currentList.items.push(bulletMatch[1]);
    } else if (numMatch) {
      if (currentList && currentList.type !== "ol") flushList();
      if (!currentList) currentList = { type: "ol", items: [] };
      currentList.items.push(numMatch[1]);
    } else {
      flushList();
      if (rawLine.trim() === "") {
        nodes.push(<div key={`blank-${i}`} className="h-2" />);
      } else {
        nodes.push(
          <div key={`p-${i}`} className="leading-relaxed">
            {renderInlineMarkdown(rawLine)}
          </div>
        );
      }
    }
  }
  flushList();

  return <div className="space-y-1">{nodes}</div>;
}

function formatContactPhone(phone?: string | null) {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (digits.length >= 20 && digits.length % 2 === 0) {
    const half = digits.length / 2;
    if (digits.substring(0, half) === digits.substring(half)) {
      digits = digits.substring(0, half);
    }
  }
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    digits = digits.substring(2);
  }
  if (digits.length === 11) {
    return `(${digits.substring(0, 2)}) ${digits.substring(2, 7)}-${digits.substring(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.substring(0, 2)}) ${digits.substring(2, 6)}-${digits.substring(6)}`;
  }
  return phone;
}

function getVigosPhoneLink(phone?: string | null) {
  if (!phone) return "#";
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("55") && n.length > 10) n = n.substring(2);
  if (n.startsWith("0")) n = n.substring(1);
  if (n.startsWith("14")) n = n.substring(2);
  return `tel:${n}`;
}

interface DealDetailModalProps {
  dealId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onDealUpdated: (updatedDeal: any) => void;
  onOpenConversation: (conversationId: string) => void;
  pipelineStages: Array<{ id: string; name: string; orderIndex: number }>;
  operatorsMap: Map<string, string>;
  backLabel?: string;
}

function getTaskTypeMeta(type?: string | null) {
  switch (type) {
    case "call":
      return { label: "Ligar", icon: Phone };
    case "email":
      return { label: "Email", icon: Mail };
    case "meeting":
      return { label: "Reunião", icon: Users };
    case "lunch":
      return { label: "Almoço", icon: Utensils };
    case "visit":
      return { label: "Visita", icon: MapPin };
    case "whatsapp":
      return { label: "WhatsApp", icon: MessageCircle };
    case "task":
    default:
      return { label: "Tarefa", icon: CheckSquare };
  }
}

export function DealDetailModal({
  dealId,
  isOpen,
  onClose,
  onDealUpdated,
  onOpenConversation,
  pipelineStages,
  operatorsMap,
  backLabel,
}: DealDetailModalProps) {
  let chatContext: any = null;
  try {
    chatContext = useChat();
  } catch (e) {
    // Fallback gracioso caso renderizado fora do ChatProvider
  }
  const operatorProfile = chatContext?.operatorProfile;
  const operators = chatContext?.operators;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deal, setDeal] = useState<any>(null);
  const [customFieldDraft, setCustomFieldDraft] = useState<Record<string, unknown>>({});
  useEffect(() => { setCustomFieldDraft((deal?.customFields || {}) as Record<string, unknown>); }, [deal?.id, deal?.customFields]);
  const [activeTab, setActiveTab] = useState<
    "history" | "tasks" | "conversations" | "evidence" | "products" | "files" | "questionnaires" | "emails"
  >("history");

  // Drawer de Adicionar Contato (Buscar existente ou Criar novo)
  const [isAddContactDrawerOpen, setIsAddContactDrawerOpen] = useState(false);
  const [openingChatContactId, setOpeningChatContactId] = useState<string | null>(null);

  const handleOpenChatForContact = async (contactId: string) => {
    setOpeningChatContactId(contactId);
    try {
      const res = await fetch(`/api/contacts/${contactId}/conversations`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao abrir conversa.");
      }
      const data = await res.json();
      if (data.conversationId) {
        onOpenConversation(data.conversationId);
      }
    } catch (err: any) {
      toast.error(err.message || "Não foi possível abrir o chat.");
    } finally {
      setOpeningChatContactId(null);
    }
  };

  const handleOpenMiniChatForContact = async (contactId: string) => {
    setOpeningChatContactId(contactId);
    try {
      const res = await fetch(`/api/contacts/${contactId}/conversations`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao abrir conversa.");
      }
      const data = await res.json();
      if (data.conversationId) {
        window.dispatchEvent(
          new CustomEvent("open-crm-chat-widget", { detail: { conversationId: data.conversationId } })
        );
      }
    } catch (err: any) {
      toast.error(err.message || "Não foi possível abrir o mini-chat.");
    } finally {
      setOpeningChatContactId(null);
    }
  };

  // Edição rápida de título e valor
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [isEditingValue, setIsEditingValue] = useState(false);
  const [editValue, setEditValue] = useState("");

  // Arquivos
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadingFilesCount, setUploadingFilesCount] = useState(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [previewFile, setPreviewFile] = useState<DealFileItem | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Questionários
  const [questTitle, setQuestTitle] = useState("Qualificação Comercial & Briefing Técnico");
  const [questVolume, setQuestVolume] = useState("");
  const [questApplication, setQuestApplication] = useState("");
  const [questHasSample, setQuestHasSample] = useState("Sim");
  const [questForecast, setQuestForecast] = useState("");
  const [savingQuest, setSavingQuest] = useState(false);

  // Priorização IA
  const [calculatingPriority, setCalculatingPriority] = useState(false);

  // Produtos e Catálogo
  const [catalogProducts, setCatalogProducts] = useState<any[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newProductQty, setNewProductQty] = useState("1");
  const [newProductUnitPrice, setNewProductUnitPrice] = useState("");
  const [newProductDiscount, setNewProductDiscount] = useState("0");
  const [newProductNotes, setNewProductNotes] = useState("");
  const [addingProduct, setAddingProduct] = useState(false);

  // Proposta Comercial
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalPaymentTerms, setProposalPaymentTerms] = useState("À vista / Boleto bancário 30 dias");
  const [proposalDeliveryTerms, setProposalDeliveryTerms] = useState("FOB - Retirada na fábrica ou frete a combinar");
  const [proposalValidityDays, setProposalValidityDays] = useState(15);
  const [generatingProposal, setGeneratingProposal] = useState(false);

  // Ações de Ganho/Perda/Pausa
  const [showWinPrompt, setShowWinPrompt] = useState(false);
  const [winReason, setWinReason] = useState("");
  const [showLossPrompt, setShowLossPrompt] = useState(false);
  const [lossReason, setLossReason] = useState("");
  const [showPausePrompt, setShowPausePrompt] = useState(false);
  const [pauseReason, setPauseReason] = useState("");

  // Diálogo para vincular conversa na aba Conversas
  const [showLinkConvModal, setShowLinkConvModal] = useState(false);
  const [searchConvQuery, setSearchConvQuery] = useState("");
  const [searchingConvs, setSearchingConvs] = useState(false);
  const [availableConvs, setAvailableConvs] = useState<any[]>([]);

  // Criação de Nova Atividade / Tarefa / Nota
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [newActivityType, setNewActivityType] = useState<"note" | "task" | "call" | "meeting">("note");
  const [newActivityTitle, setNewActivityTitle] = useState("");
  const [newActivityDesc, setNewActivityDesc] = useState("");
  const [newActivityDueDate, setNewActivityDueDate] = useState("");
  const [submittingActivity, setSubmittingActivity] = useState(false);

  // Sub-abas e ações de atividades
  const [tasksSubTab, setTasksSubTab] = useState<"pending" | "completed" | "cancelled" | "notes">("pending");
  const [historyFilter, setHistoryFilter] = useState<"all" | "event" | "activity" | "proposal" | "evidence" | "file" | "email" | "questionnaire">("all");
  const [historySourceFilter, setHistorySourceFilter] = useState<"all" | "conversas" | "crm">("all");
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [inlineNoteText, setInlineNoteText] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const noteTextareaRef = React.useRef<HTMLTextAreaElement>(null);

  const handleFormatNote = (format: "bold" | "italic" | "bullet" | "numbered" | "link") => {
    const textarea = noteTextareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = inlineNoteText.substring(start, end);

    let replacement = "";
    if (format === "bold") {
      replacement = selected ? `**${selected}**` : "**texto em negrito**";
    } else if (format === "italic") {
      replacement = selected ? `*${selected}*` : "*texto em itálico*";
    } else if (format === "bullet") {
      replacement = selected
        ? selected.split("\n").map((l) => `- ${l}`).join("\n")
        : "- item da lista";
    } else if (format === "numbered") {
      replacement = selected
        ? selected.split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n")
        : "1. item numerado";
    } else if (format === "link") {
      replacement = selected ? `[${selected}](https://)` : "[link](https://)";
    }

    const newText = inlineNoteText.substring(0, start) + replacement + inlineNoteText.substring(end);
    setInlineNoteText(newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + replacement.length, start + replacement.length);
    }, 10);
  };

  const handleSaveInlineNote = async () => {
    if (!inlineNoteText.trim() || !deal) return;
    setIsSavingNote(true);
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "note",
          title: "Anotação",
          description: inlineNoteText.trim(),
          status: "completed",
          completed: true,
        }),
      });

      if (!res.ok) {
        throw new Error("Erro ao salvar anotação.");
      }

      toast.success("Anotação salva no histórico!");
      setInlineNoteText("");
      setIsCreatingNote(false);
      loadDealDetail();
    } catch (err: any) {
      console.error("[DealDetailModal] Erro ao salvar anotação inline:", err);
      toast.error(err.message || "Falha ao salvar anotação.");
    } finally {
      setIsSavingNote(false);
    }
  };

  const adjustNoteTextareaHeight = () => {
    const el = noteTextareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.max(el.scrollHeight, 90)}px`;
    }
  };

  useEffect(() => {
    if (isCreatingNote) {
      setTimeout(adjustNoteTextareaHeight, 10);
    }
  }, [isCreatingNote, inlineNoteText]);

  // Lista de funis para troca rápida pelo cabeçalho
  const [availablePipelines, setAvailablePipelines] = useState<Array<{ id: string; name: string; stages?: any[] }>>([]);

  const loadPipelines = async () => {
    try {
      const res = await fetch("/api/crm/pipelines");
      if (res.ok) {
        const data = await res.json();
        setAvailablePipelines(data.pipelines || []);
      }
    } catch (err: any) {
      console.warn("[DealDetailModal] Falha ao carregar funis:", err);
    }
  };

  const handleSwitchPipeline = async (targetPipelineId: string) => {
    if (!deal || targetPipelineId === deal.pipelineId) return;
    try {
      await updateDeal({ pipelineId: targetPipelineId });
      toast.success("Funil alterado com sucesso!");
      loadDealDetail();
    } catch (e: any) {
      toast.error(e.message || "Erro ao alterar funil.");
    }
  };

  const [reschedulingActivityId, setReschedulingActivityId] = useState<string | null>(null);
  const [rescheduleDueDate, setRescheduleDueDate] = useState("");
  const [reschedulingLoading, setReschedulingLoading] = useState(false);

  // Ficha detalhada do cliente
  const [isAccountDetailOpen, setIsAccountDetailOpen] = useState(false);

  // Gestão de Participantes
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [participantContactId, setParticipantContactId] = useState("");
  const [participantRole, setParticipantRole] = useState("buyer");
  const [submittingParticipant, setSubmittingParticipant] = useState(false);

  const handleAddParticipant = async () => {
    if (!dealId || !participantContactId.trim()) return;
    setSubmittingParticipant(true);
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: participantContactId.trim(),
          role: participantRole,
          isPrimary: !deal?.contacts || deal.contacts.length === 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao adicionar participante.");
      }
      toast.success("Participante adicionado com sucesso!");
      setShowAddParticipant(false);
      setParticipantContactId("");
      loadDealDetail();
    } catch (e: any) {
      toast.error(e.message || "Erro ao vincular participante.");
    } finally {
      setSubmittingParticipant(false);
    }
  };

  const handleRemoveParticipant = async (contactId: string) => {
    if (!dealId || !confirm("Deseja remover este participante da negociação?")) return;
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/contacts?contactId=${contactId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao remover participante.");
      }
      toast.success("Participante removido da negociação.");
      loadDealDetail();
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover participante.");
    }
  };

  const handleSetPrimaryParticipant = async (contactId: string) => {
    if (!dealId) return;
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/contacts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, isPrimary: true }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao definir participante principal.");
      }
      toast.success("Contato principal definido.");
      loadDealDetail();
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar participante.");
    }
  };

  // Carrega detalhes do Deal
  const loadDealDetail = async () => {
    if (!dealId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/crm/deals/${dealId}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Não foi possível carregar a negociação.");
      }
      const data = await res.json();
      setDeal(data.deal);
      setEditTitle(data.deal.title);
      setEditValue(data.deal.value ? String(data.deal.value) : "");
    } catch (err: any) {
      console.error("[DealDetailModal] Erro ao carregar deal:", err);
      setLoadError(err.message || "Erro ao carregar detalhes.");
      toast.error(err.message || "Erro ao carregar detalhes.");
    } finally {
      setLoading(false);
    }
  };

  // Carrega Catálogo de Produtos
  const loadCatalog = async () => {
    setLoadingCatalog(true);
    try {
      const res = await fetch("/api/crm/products?isActive=true");
      if (res.ok) {
        const data = await res.json();
        setCatalogProducts(data.products || []);
      }
    } catch (err: any) {
      console.warn("[DealDetailModal] Falha ao carregar catálogo:", err.message);
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    if (isOpen && dealId) {
      loadDealDetail();
      loadCatalog();
      loadPipelines();
    } else {
      setDeal(null);
      setShowWinPrompt(false);
      setShowLossPrompt(false);
    }
  }, [isOpen, dealId]);

  // Manipulação de Produto do Catálogo
  const handleSelectCatalogItem = (productId: string) => {
    setSelectedCatalogId(productId);
    if (!productId) return;
    const prod = catalogProducts.find((p) => p.id === productId);
    if (prod) {
      setNewProductName(prod.name);
      setNewProductUnitPrice(String(prod.unitPrice));
    }
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deal || !newProductName.trim() || !newProductUnitPrice) return;

    setAddingProduct(true);
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedCatalogId || null,
          name: newProductName.trim(),
          quantity: parseFloat(newProductQty) || 1,
          unitPrice: parseFloat(newProductUnitPrice) || 0,
          discountPercent: parseFloat(newProductDiscount) || 0,
          notes: newProductNotes.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao adicionar produto.");
      }

      toast.success("Produto adicionado e valor da negociação recalculado!");
      setSelectedCatalogId("");
      setNewProductName("");
      setNewProductQty("1");
      setNewProductUnitPrice("");
      setNewProductDiscount("0");
      setNewProductNotes("");
      await loadDealDetail();
      if (onDealUpdated && deal) {
        onDealUpdated({ ...deal, value: editValue });
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao adicionar produto.");
    } finally {
      setAddingProduct(false);
    }
  };

  const handleRemoveProduct = async (dealProductId: string) => {
    if (!deal) return;
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/products?dealProductId=${dealProductId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Erro ao remover produto.");
      }

      toast.success("Produto removido e valor recalculado!");
      await loadDealDetail();
    } catch (err: any) {
      toast.error(err.message || "Falha ao remover produto.");
    }
  };

  const handleGenerateProposal = async () => {
    if (!deal) return;
    setGeneratingProposal(true);
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: proposalTitle.trim() || undefined,
          paymentTerms: proposalPaymentTerms.trim() || undefined,
          deliveryTerms: proposalDeliveryTerms.trim() || undefined,
          validityDays: proposalValidityDays,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao gerar proposta.");
      }

      const data = await res.json();
      toast.success(`Proposta ${data.proposal.proposalNumber} gerada com sucesso!`);
      setShowProposalModal(false);
      await loadDealDetail();
    } catch (err: any) {
      toast.error(err.message || "Erro ao emitir proposta.");
    } finally {
      setGeneratingProposal(false);
    }
  };

  const handleUpdateProposalStatus = async (proposalId: string, status: string) => {
    if (!deal) return;
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/proposals`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, status }),
      });

      if (!res.ok) throw new Error("Erro ao atualizar status da proposta.");
      toast.success(`Status da proposta atualizado para ${status}!`);
      await loadDealDetail();
    } catch (err: any) {
      toast.error(err.message || "Erro ao alterar status.");
    }
  };

  const handleCopyProposalText = async (prop: any) => {
    try {
      const itemsList = Array.isArray(prop.items)
        ? prop.items
            .map(
              (it: any) =>
                `• *${it.name}*\n  Qtd: ${it.quantity} | Preço: R$ ${parseFloat(it.unitPrice).toFixed(2)}${
                  parseFloat(it.discountPercent) > 0 ? ` (Desc: ${it.discountPercent}%)` : ""
                } = R$ ${parseFloat(it.totalPrice).toFixed(2)}`
            )
            .join("\n")
        : "";

      const text = `*PROPOSTA COMERCIAL: ${prop.proposalNumber}*\n` +
        `*Cliente / Negócio:* ${deal.title}\n` +
        `*Data:* ${new Date(prop.createdAt).toLocaleDateString("pt-BR")}\n\n` +
        `*ITENS / ESPECIFICAÇÕES:*\n${itemsList || "• Conforme alinhamento comercial"}\n\n` +
        `*Subtotal:* R$ ${parseFloat(prop.subtotal).toFixed(2)}\n` +
        `${parseFloat(prop.discount) > 0 ? `*Desconto Concedido:* R$ ${parseFloat(prop.discount).toFixed(2)}\n` : ""}` +
        `*VALOR TOTAL:* R$ ${parseFloat(prop.total).toFixed(2)}\n\n` +
        `*Condições de Pagamento:* ${prop.paymentTerms || "À vista / Boleto bancário"}\n` +
        `*Prazo & Frete:* ${prop.deliveryTerms || "FOB - Retirada na fábrica ou frete a combinar"}\n` +
        `*Validade:* ${prop.validityDays || 15} dias`;

      await navigator.clipboard.writeText(text);
      toast.success("Texto copiado para a área de transferência! Envio deve ser confirmado explicitamente.");
    } catch (err: any) {
      toast.error("Não foi possível copiar para a área de transferência.");
    }
  };

  // Priorização IA
  const handleCalculateAiPriority = async () => {
    if (!deal) return;
    try {
      setCalculatingPriority(true);
      const res = await fetch(`/api/crm/deals/${deal.id}/ai-priority`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao calcular prioridade comercial.");
      toast.success(`Prioridade comercial atualizada: ${data.priority.score} pts (${data.priority.level})!`);
      await loadDealDetail();
    } catch (err: any) {
      toast.error(err.message || "Falha na avaliação de IA.");
    } finally {
      setCalculatingPriority(false);
    }
  };

  // Upload Direto de Arquivos da Máquina (até 100MB)
  const handleFilesUpload = async (fileList: FileList | File[]) => {
    if (!deal || !fileList || fileList.length === 0) return;
    const MAX_SIZE = 100 * 1024 * 1024; // 100MB
    const validFiles: File[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (file.size > MAX_SIZE) {
        toast.error(`O arquivo "${file.name}" excede o limite de 100MB (${(file.size / (1024 * 1024)).toFixed(1)} MB).`);
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    try {
      setUploadingFile(true);
      setUploadingFilesCount(validFiles.length);

      const formData = new FormData();
      for (const file of validFiles) {
        formData.append("files", file);
      }

      const res = await fetch(`/api/crm/deals/${deal.id}/files`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao fazer upload dos arquivos.");

      toast.success(
        validFiles.length === 1
          ? `Arquivo "${validFiles[0].name}" anexado com sucesso!`
          : `${validFiles.length} arquivos anexados com sucesso!`
      );
      await loadDealDetail();
    } catch (err: any) {
      toast.error(err.message || "Erro ao anexar arquivo(s).");
    } finally {
      setUploadingFile(false);
      setUploadingFilesCount(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Exclusão de Arquivo
  const handleDeleteFile = async (fileId: string) => {
    if (!deal) return;
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/files`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao excluir arquivo.");
      toast.success("Arquivo removido.");
      if (previewFile?.id === fileId) {
        setIsPreviewOpen(false);
        setPreviewFile(null);
      }
      await loadDealDetail();
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir arquivo.");
    }
  };

  // Salvar Questionário
  const handleSaveQuestionnaire = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deal) return;
    const answers = [
      { question: "Volume mensal estimado de demanda", answer: questVolume || "Não informado" },
      { question: "Aplicação e especificação técnica do produto", answer: questApplication || "Padrão" },
      { question: "Cliente já testou ou aprovou amostras físicas?", answer: questHasSample },
      { question: "Previsão estimada de fechamento comercial", answer: questForecast || "Imediato" },
    ];
    try {
      setSavingQuest(true);
      const res = await fetch(`/api/crm/deals/${deal.id}/questionnaires`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formTitle: questTitle.trim(),
          version: (deal.questionnaires?.length || 0) + 1,
          answers,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar questionário.");
      toast.success("Questionário de qualificação salvo!");
      setQuestVolume("");
      setQuestApplication("");
      setQuestForecast("");
      await loadDealDetail();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar questionário.");
    } finally {
      setSavingQuest(false);
    }
  };

  if (!isOpen || !dealId) return null;

  // Atualização com concorrência otimista
  const updateDeal = async (patch: Record<string, any>) => {
    if (!deal) return;
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...patch,
          expectedVersion: deal.version,
        }),
      });

      if (res.status === 409) {
        toast.error("Esta negociação foi alterada por outro operador. Os dados foram atualizados.");
        loadDealDetail();
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Erro ao atualizar negociação.");
      }

      const data = await res.json();
      setDeal((prev: any) => ({ ...prev, ...data.deal }));
      onDealUpdated(data.deal);
      toast.success("Negociação atualizada com sucesso.");
    } catch (err: any) {
      console.error("[DealDetailModal] Erro no patch:", err);
      toast.error(err.message || "Falha ao salvar alteração.");
    }
  };

  // Salvar título
  const handleSaveTitle = async () => {
    if (!editTitle.trim() || editTitle === deal.title) {
      setIsEditingTitle(false);
      return;
    }
    await updateDeal({ title: editTitle.trim() });
    setIsEditingTitle(false);
  };

  // Salvar valor
  const handleSaveValue = async () => {
    if (!editValue || editValue.trim() === "") {
      await updateDeal({ value: null });
    } else {
      const num = parseFloat(editValue.replace(/\./g, "").replace(",", "."));
      if (isNaN(num)) {
        toast.error("Valor numérico inválido.");
        return;
      }
      await updateDeal({ value: num });
    }
    setIsEditingValue(false);
  };

  // Mudar etapa
  const handleStageChange = async (newStageId: string) => {
    if (newStageId === deal.stageId) return;
    await updateDeal({ stageId: newStageId });
  };

  // Marcar como Ganho
  const handleConfirmWin = async () => {
    await updateDeal({
      status: "won",
      winReason: winReason.trim() || undefined,
      closedAt: new Date().toISOString(),
    });
    setShowWinPrompt(false);
  };

  // Marcar como Perdido
  // Marcar como Perdido
  const handleConfirmLoss = async () => {
    await updateDeal({
      status: "lost",
      lossReason: lossReason.trim() || undefined,
      closedAt: new Date().toISOString(),
    });
    setShowLossPrompt(false);
  };

  // Confirmar Pausa da Negociação
  const handleConfirmPause = async () => {
    await updateDeal({
      status: "paused",
      pausedReason: pauseReason.trim() || undefined,
    });
    setShowPausePrompt(false);
  };

  // Reabrir ou retomar negociação
  const handleReopen = async () => {
    await updateDeal({
      status: "open",
      winReason: null,
      lossReason: null,
      pausedReason: null,
      closedAt: null,
    });
  };

  // Desvincular conversa do negócio
  const handleUnlinkConversation = async (conversationId: string) => {
    if (!dealId || !confirm("Deseja realmente desvincular este atendimento da negociação?")) return;
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/conversations?conversationId=${conversationId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Erro ao desvincular conversa.");
      toast.success("Atendimento desvinculado com sucesso.");
      await loadDealDetail();
      if (onDealUpdated && deal) onDealUpdated(deal);
    } catch (e: any) {
      toast.error(e.message || "Falha ao desvincular.");
    }
  };

  // Buscar conversas para vincular
  const handleSearchConversations = async () => {
    setSearchingConvs(true);
    try {
      const params = new URLSearchParams();
      if (searchConvQuery.trim()) {
        params.set("search", searchConvQuery.trim());
      }
      params.set("limit", "15");
      const res = await fetch(`/api/chats?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const linkedConvIds = new Set((deal?.conversations || []).map((c: any) => c.conversationId || c.id));
        const list = data.chats || data.conversations || [];
        setAvailableConvs(list.filter((c: any) => !linkedConvIds.has(c.id)));
      }
    } catch (e: any) {
      console.error("[DealDetailModal] Erro ao buscar chats:", e);
    } finally {
      setSearchingConvs(false);
    }
  };

  // Vincular conversa
  const handleLinkConversation = async (convId: string) => {
    if (!dealId || !convId) return;
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, origin: "crm" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao vincular atendimento.");
      }
      toast.success("Atendimento vinculado com sucesso!");
      setShowLinkConvModal(false);
      setSearchConvQuery("");
      await loadDealDetail();
      if (onDealUpdated && deal) onDealUpdated(deal);
    } catch (e: any) {
      toast.error(e.message || "Falha ao vincular atendimento.");
    }
  };

  // Criar nova atividade / nota
  const handleCreateActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newActivityTitle.trim()) {
      toast.error("Informe o assunto da atividade.");
      return;
    }

    setSubmittingActivity(true);
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newActivityType,
          title: newActivityTitle.trim(),
          description: newActivityDesc.trim() || undefined,
          dueDate: newActivityDueDate || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error("Erro ao criar atividade.");
      }

      toast.success(newActivityType === "note" ? "Nota adicionada!" : "Tarefa agendada!");
      setNewActivityTitle("");
      setNewActivityDesc("");
      setNewActivityDueDate("");
      loadDealDetail();
    } catch (err: any) {
      console.error("[DealDetailModal] Erro ao criar atividade:", err);
      toast.error(err.message || "Falha ao registrar atividade.");
    } finally {
      setSubmittingActivity(false);
    }
  };

  // Concluir Atividade Comercial
  const handleCompleteActivity = async (activityId: string) => {
    if (!deal) return;
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao concluir tarefa.");
      }
      toast.success("Tarefa concluída!");
      await loadDealDetail();
      if (onDealUpdated && deal) onDealUpdated(deal);
    } catch (err: any) {
      toast.error(err.message || "Falha ao concluir tarefa.");
    }
  };

  // Reabrir Atividade Comercial
  const handleReopenActivity = async (activityId: string) => {
    if (!deal) return;
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao reabrir tarefa.");
      }
      toast.success("Tarefa reaberta como pendente!");
      await loadDealDetail();
      if (onDealUpdated && deal) onDealUpdated(deal);
    } catch (err: any) {
      toast.error(err.message || "Falha ao reabrir tarefa.");
    }
  };

  // Cancelar Atividade Comercial
  const handleCancelActivity = async (activityId: string) => {
    if (!deal) return;
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao cancelar tarefa.");
      }
      toast.success("Tarefa cancelada.");
      await loadDealDetail();
      if (onDealUpdated && deal) onDealUpdated(deal);
    } catch (err: any) {
      toast.error(err.message || "Falha ao cancelar tarefa.");
    }
  };

  // Reagendar Atividade Comercial
  const handleRescheduleActivity = async (activityId: string, newDueDate: string) => {
    if (!deal || !newDueDate) return;
    setReschedulingLoading(true);
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueDate: newDueDate }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao reagendar tarefa.");
      }
      toast.success("Tarefa reagendada com sucesso!");
      setReschedulingActivityId(null);
      setRescheduleDueDate("");
      await loadDealDetail();
      if (onDealUpdated && deal) onDealUpdated(deal);
    } catch (err: any) {
      toast.error(err.message || "Falha ao reagendar tarefa.");
    } finally {
      setReschedulingLoading(false);
    }
  };

  // Excluir Atividade Comercial
  const handleDeleteActivity = async (activityId: string) => {
    if (!deal || !confirm("Deseja realmente remover esta atividade?")) return;
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/activities/${activityId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao excluir atividade.");
      }
      toast.success("Atividade excluída.");
      await loadDealDetail();
      if (onDealUpdated && deal) onDealUpdated(deal);
    } catch (err: any) {
      toast.error(err.message || "Falha ao excluir atividade.");
    }
  };

  // Abrir conversa vinculada diretamente no chat
  const handleOpenConversation = (conversationId: string) => {
    onOpenConversation(conversationId);
  };

  // Remover evidência comercial
  const handleRemoveEvidence = async (evidenceId: string) => {
    if (!dealId) return;
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/evidence?evidenceId=${evidenceId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Erro ao remover evidência.");
      toast.success("Evidência removida com sucesso.");
      loadDealDetail();
    } catch (err: any) {
      toast.error(err.message || "Falha ao remover evidência.");
    }
  };

  // Trilha de etapas do funil real do negócio (sem fixar funil padrão)
  const effectiveStages = (deal?.pipeline?.stages && deal.pipeline.stages.length > 0)
    ? deal.pipeline.stages.map((s: any) => ({
        id: s.id,
        name: s.name,
        orderIndex: s.orderIndex ?? 0,
      }))
    : pipelineStages;
  const sortedStages = [...effectiveStages].sort((a, b) => a.orderIndex - b.orderIndex);
  const currentStageIndex = sortedStages.findIndex((s) => s.id === deal?.stageId);

  // Formatação de valor: distinção estrita entre null e zero
  const isNullValue = deal?.value === null || deal?.value === undefined;
  const rawValue = !isNullValue ? Number(deal.value) : null;
  const formattedValue = rawValue !== null && !isNaN(rawValue)
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(rawValue)
    : "Adicionar valor";

  // Linha do tempo unificada combinando eventos, tarefas, notas, propostas, evidências, arquivos, emails e questionários
  const unifiedTimeline = React.useMemo(() => {
    if (!deal) return [];
    const items: Array<{
      id: string;
      category: "event" | "activity" | "proposal" | "evidence" | "file" | "email" | "questionnaire";
      title: string;
      description?: string | null;
      author: string;
      authorAvatar?: string | null;
      date: Date;
      iconType: string;
      badgeColor: string;
      isNote?: boolean;
      source: "conversas" | "crm";
    }> = [];

    // 1. Eventos de auditoria
    const stageNames = new Map<string, string>(
      (deal.pipeline?.stages?.length ? deal.pipeline.stages : pipelineStages).map(
        (stage: { id: string; name: string }) => [stage.id, stage.name],
      ),
    );
    (deal.events || []).forEach((evt: any) => {
      // Ignorar evento de auditoria se for criação de nota comercial (já é exibido com o card de anotação da atividade)
      if (evt.eventType === "note_created") return;

      const { title, description } = formatDealEvent(evt, stageNames, operatorsMap);
      if (title === "Nota comercial registrada") return;

      // Também ignorar activity_created se a tarefa correspondente já estiver na lista de activities
      if (
        evt.eventType === "activity_created" &&
        deal.activities?.some((a: any) => a.id === evt.metadata?.activityId)
      ) {
        return;
      }

      const authorName = evt.operatorId
        ? operatorsMap.get(evt.operatorId) || "Operador"
        : "Sistema";

      const opObj = operators?.find((op: any) =>
        (evt.operatorId && op.id === evt.operatorId) ||
        (op.name && authorName && op.name.toLowerCase().trim() === authorName.toLowerCase().trim())
      );
      const authorAvatar = opObj?.avatar || (authorName === operatorProfile?.name ? operatorProfile?.avatar : null);

      items.push({
        id: `evt-${evt.id}`,
        category: "event",
        title,
        description,
        author: authorName,
        authorAvatar: authorAvatar || null,
        date: new Date(evt.createdAt),
        iconType: "history",
        badgeColor: "bg-muted text-muted-foreground",
        source: "crm",
      });
    });

    // 2. Atividades (Notas comerciais e Tarefas)
    (deal.activities || []).forEach((act: any) => {
      const isNote = act.type === "note";
      // Se for nota, usa diretamente o texto sem duplicar title e description
      const fullNoteText = isNote
        ? (act.description || act.title || "")
        : (act.description || (act.dueDate ? `Prazo: ${new Date(act.dueDate).toLocaleString("pt-BR")}` : null));

      const authorName = act.operatorName || act.assignedToOperatorName || "Operador";
      const opObj = operators?.find((op: any) =>
        (act.operatorId && op.id === act.operatorId) ||
        (act.assignedToOperatorId && op.id === act.assignedToOperatorId) ||
        (op.name && authorName && op.name.toLowerCase().trim() === authorName.toLowerCase().trim())
      );
      const authorAvatar = opObj?.avatar || (authorName === operatorProfile?.name ? operatorProfile?.avatar : null);

      items.push({
        id: `act-${act.id}`,
        category: "activity",
        title: isNote ? "Anotação" : act.status === "completed" ? `Tarefa Concluída: ${act.title}` : `Tarefa: ${act.title}`,
        description: fullNoteText,
        author: authorName,
        authorAvatar: authorAvatar || null,
        date: new Date(act.createdAt),
        iconType: isNote ? "note" : "task",
        badgeColor: isNote ? "bg-primary/10 text-primary border border-primary/20" : "bg-muted text-muted-foreground",
        isNote,
        source: act.conversationId ? "conversas" : "crm",
      });
    });

    // 3. Propostas Comerciais
    (deal.proposals || []).forEach((prop: any) => {
      items.push({
        id: `prop-${prop.id}`,
        category: "proposal",
        title: `Proposta Comercial ${prop.proposalNumber} (${prop.status})`,
        description: `Valor Total: R$ ${Number(prop.total || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} | Itens: ${Array.isArray(prop.items) ? prop.items.length : 0}`,
        author: prop.createdByName || "Comercial",
        date: new Date(prop.createdAt),
        iconType: "proposal",
        badgeColor: "bg-muted text-muted-foreground",
        source: "crm",
      });
    });

    // 4. Evidências Comerciais
    (deal.evidences || []).forEach((evi: any) => {
      items.push({
        id: `evi-${evi.id}`,
        category: "evidence",
        title: `Evidência Marcada (${evi.evidenceType || "Mensagem"})`,
        description: evi.message?.content ? `"${evi.message.content.substring(0, 160)}..."` : evi.notes || null,
        author: evi.createdByName || evi.message?.senderName || "Chat",
        date: new Date(evi.createdAt),
        iconType: "evidence",
        badgeColor: "bg-muted text-muted-foreground",
        source: "conversas",
      });
    });

    // 5. Arquivos Anexados
    (deal.files || []).forEach((file: any) => {
      items.push({
        id: `file-${file.id}`,
        category: "file",
        title: `Arquivo Anexado: ${file.fileName}`,
        description: file.fileSize ? `Tamanho: ${formatBytes(file.fileSize)}` : null,
        author: file.uploaderName || file.uploadedByName || "Operador",
        date: new Date(file.createdAt),
        iconType: "file",
        badgeColor: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
        source: "crm",
      });
    });

    // 6. E-mails
    (deal.emails || []).forEach((email: any) => {
      items.push({
        id: `email-${email.id}`,
        category: "email",
        title: `${email.isVerified && email.metadata?.delivery === "smtp_accepted" ? "E-mail Enviado" : "E-mail registrado manualmente"}: ${email.subject || "Sem assunto"}`,
        description: email.bodyText ? email.bodyText.substring(0, 300) : null,
        author: email.fromAddress || "Comercial",
        date: new Date(email.createdAt),
        iconType: "email",
        badgeColor: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
        source: "crm",
      });
    });

    // 7. Questionários Respondidos
    (deal.questionnaires || []).forEach((q: any) => {
      items.push({
        id: `q-${q.id}`,
        category: "questionnaire",
        title: `Questionário Preenchido: ${q.title || "Briefing Comercial"}`,
        description: null,
        author: q.createdByName || "Comercial",
        date: new Date(q.createdAt),
        iconType: "questionnaire",
        badgeColor: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        source: "crm",
      });
    });

    // Ordenação cronológica decrescente (mais recente primeiro)
    items.sort((a, b) => b.date.getTime() - a.date.getTime());
    return items;
  }, [deal, operatorsMap, pipelineStages, operators, operatorProfile]);

  const filteredTimeline = React.useMemo(() => {
    return unifiedTimeline.filter((item) => {
      if (historySourceFilter === "conversas" && item.source !== "conversas") return false;
      if (historySourceFilter === "crm" && item.source !== "crm") return false;
      if (historyFilter !== "all" && item.category !== historyFilter) return false;
      return true;
    });
  }, [unifiedTimeline, historySourceFilter, historyFilter]);

  return (
    <div className="crm-deal-detail bg-card h-full flex flex-col overflow-hidden">
      <div className="relative flex flex-col h-full w-full bg-card overflow-hidden">
        {/* Cabeçalho Superior Unificado */}
        <div className="border-b border-border bg-card px-5 py-3 shrink-0">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* Esquerda: Voltar ao CRM + Nome da Negociação + Metas (Funil, Empresa, Status, IA Avaliar) */}
            <div className="flex items-center gap-3 min-w-0 flex-wrap">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted py-1.5 px-2.5 rounded-lg transition-colors cursor-pointer shrink-0"
                title={backLabel || "Voltar ao CRM"}
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">{backLabel || "Voltar ao CRM"}</span>
              </button>

              <div className="h-4 w-px bg-border/80 shrink-0 hidden sm:block" />

              {/* Nome da Negociação */}
              <h2 className="text-base font-extrabold text-foreground truncate max-w-xs sm:max-w-md" title={deal?.title}>
                {loading ? "Carregando negociação..." : deal?.title}
              </h2>

              {!loading && deal && (
                <div className="flex items-center gap-2 flex-wrap">
                  {/* 1. Status Badge */}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase ${
                      deal.status === "lost"
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : deal.status === "won"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        : deal.status === "paused"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                        : "bg-muted text-foreground border border-border"
                    }`}
                  >
                    {deal.status === "won"
                      ? "Ganho"
                      : deal.status === "lost"
                      ? "Perdido"
                      : deal.status === "paused"
                      ? "Pausado"
                      : "Em Aberto"}
                  </span>

                  {/* 2. Funil com Menu Suspenso */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                        title="Clique para alterar o funil"
                      >
                        <span>{deal.pipeline?.name || "Funil Comercial"}</span>
                        <ChevronDown className="h-3 w-3 opacity-70" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56 p-1">
                      <div className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        Mudar de Funil
                      </div>
                      {availablePipelines.map((p) => {
                        const isCurrent = p.id === (deal.pipelineId || deal.pipeline?.id);
                        return (
                          <DropdownMenuItem
                            key={p.id}
                            onClick={() => handleSwitchPipeline(p.id)}
                            className="flex items-center justify-between text-xs font-medium cursor-pointer"
                          >
                            <span className={isCurrent ? "font-bold text-primary" : "text-foreground"}>
                              {p.name}
                            </span>
                            {isCurrent && <Check className="h-3.5 w-3.5 text-primary" />}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* 3. Avaliar */}
                  {deal.aiPriorityScore !== null && deal.aiPriorityScore !== undefined && (
                    <SystemTooltip content={deal.aiPriorityReason || "Prioridade comercial calculada por critérios explicáveis e IA"}>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          deal.aiPriorityLevel === "critica"
                            ? "bg-primary/10 text-primary border border-primary/30"
                            : "bg-muted text-muted-foreground border border-border"
                        }`}
                      >
                        <Sparkles className="h-2.5 w-2.5 text-primary" />
                        <span>IA: {deal.aiPriorityScore} pts ({deal.aiPriorityLevel || "normal"})</span>
                      </span>
                    </SystemTooltip>
                  )}

                  <SystemTooltip content="Calcular prioridade comercial com IA">
                    <button
                      type="button"
                      disabled={calculatingPriority}
                      onClick={handleCalculateAiPriority}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline cursor-pointer disabled:opacity-50"
                    >
                      {calculatingPriority ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      <span>Avaliar</span>
                    </button>
                  </SystemTooltip>

                  {/* 4. Empresa (sempre o nome completo, sem limite de caracteres) */}
                  {deal.account && (
                    <SystemTooltip content="Ver ficha do cliente">
                      <button
                        type="button"
                        onClick={() => setIsAccountDetailOpen(true)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold text-foreground hover:text-primary transition-colors cursor-pointer"
                      >
                        <span className="underline decoration-dotted whitespace-nowrap">{deal.account.name}</span>
                      </button>
                    </SystemTooltip>
                  )}
                </div>
              )}
            </div>

            {/* Direita: Ações Terminais no mesmo cabeçalho */}
            <div className="flex items-center gap-2 shrink-0">
              {!loading && deal && (
                <>
                  {deal.status === "open" && (
                    <>
                      <SystemTooltip content="Pausar negociação">
                        <button
                          onClick={() => setShowPausePrompt(true)}
                          className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-bold text-foreground hover:bg-muted transition-colors cursor-pointer"
                        >
                          <PauseCircle className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>Pausar</span>
                        </button>
                      </SystemTooltip>
                      <SystemTooltip content="Marcar como Perdido">
                        <button
                          onClick={() => setShowLossPrompt(true)}
                          className="flex h-8 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-xs font-bold text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          <span>Marcar perda</span>
                        </button>
                      </SystemTooltip>
                      <SystemTooltip content="Marcar como Ganho">
                        <button
                          onClick={() => setShowWinPrompt(true)}
                          className="flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity cursor-pointer"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Marcar venda</span>
                        </button>
                      </SystemTooltip>
                    </>
                  )}

                  {deal.status === "paused" && (
                    <button
                      onClick={handleReopen}
                      className="flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Retomar Negociação</span>
                    </button>
                  )}

                  {(deal.status === "won" || deal.status === "lost") && (
                    <button
                      onClick={handleReopen}
                      className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Reabrir Negociação</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Modal / Prompt de Ganho */}
          {showWinPrompt && (
            <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3 animate-in fade-in">
              <span className="text-xs font-bold text-foreground block mb-1">
                Confirmar Ganho da Negociação
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Motivo do ganho (opcional, ex: Melhor preço / Atendimento rápido)..."
                  value={winReason}
                  onChange={(e) => setWinReason(e.target.value)}
                  className="h-8 flex-1 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={handleConfirmWin}
                  className="h-8 px-4 rounded-lg bg-primary text-xs font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
                >
                  Confirmar Venda
                </button>
                <button
                  onClick={() => setShowWinPrompt(false)}
                  className="h-8 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Modal / Prompt de Perda */}
          {showLossPrompt && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 animate-in fade-in">
              <span className="text-xs font-bold text-red-800 dark:text-red-300 block mb-1">
                Confirmar Perda da Negociação
              </span>
              <div className="flex gap-2">
                <CatalogSelect kind="loss_reason" value={lossReason} onChange={setLossReason} className="h-8 flex-1 rounded-lg border-red-500/40 bg-card text-xs" placeholder="Selecione o motivo" />
                <button
                  onClick={handleConfirmLoss}
                  className="h-8 px-4 rounded-lg bg-red-600 text-xs font-bold text-white hover:bg-red-700 cursor-pointer"
                >
                  Confirmar Perda
                </button>
                <button
                  onClick={() => setShowLossPrompt(false)}
                  className="h-8 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Modal / Prompt de Pausa */}
          {showPausePrompt && (
            <div className="mt-3 rounded-xl border border-border bg-muted/50 p-3 animate-in fade-in">
              <span className="text-xs font-bold text-foreground block mb-1">
                Confirmar Pausa da Negociação
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Motivo da pausa (opcional, ex: Aguardando aprovação orçamentária do cliente)..."
                  value={pauseReason}
                  onChange={(e) => setPauseReason(e.target.value)}
                  className="h-8 flex-1 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={handleConfirmPause}
                  className="h-8 px-4 rounded-lg bg-primary text-xs font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
                >
                  Confirmar Pausa
                </button>
                <button
                  onClick={() => setShowPausePrompt(false)}
                  className="h-8 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Trilha de Etapas do Funil */}
          {!loading && deal && sortedStages.length > 0 && (
            <div className="crm-stage-track mt-3 flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
              {sortedStages.map((stage, idx) => {
                const isPassed = idx < currentStageIndex;
                const isCurrent = stage.id === deal.stageId;
                return (
                  <button
                    key={stage.id}
                    onClick={() => handleStageChange(stage.id)}
                    className={`crm-stage flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                      isCurrent
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : isPassed
                        ? "bg-primary/10 text-primary hover:bg-primary/20"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>{stage.name}</span>
                    {idx < sortedStages.length - 1 && (
                      <ChevronRight className="h-3 w-3 opacity-40 shrink-0 ml-1" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Corpo Principal: Lado Esquerdo (Dados Comprador) + Lado Direito (Abas) */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : loadError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm font-semibold text-foreground">{loadError}</p>
            <button type="button" onClick={onClose} className="text-sm font-semibold text-primary hover:underline">Voltar ao CRM</button>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 max-lg:flex-col overflow-hidden">
            {/* Painel Esquerdo: Dados da Negociação, Contatos, Empresa e Campos Personalizados */}
            <div className="crm-deal-sidebar w-80 shrink-0 flex flex-col gap-3 border-r border-border bg-muted/20 p-4 overflow-y-auto scrollbar-none max-lg:w-full max-lg:h-auto">
              {/* 1. Card Negociação */}
              <div className="crm-side-deal order-1 rounded-sm border border-border bg-card p-3.5 space-y-3 scrollbar-none">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Negociação
                </span>

                <div className="space-y-3 text-xs">
                  {/* Nome da Negociação Editável */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground font-semibold block">Nome</label>
                    {isEditingTitle ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="h-7 flex-1 rounded-lg border border-primary bg-card px-2 text-xs font-bold text-foreground focus:outline-none"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveTitle();
                            if (e.key === "Escape") setIsEditingTitle(false);
                          }}
                        />
                        <button
                          type="button"
                          onClick={handleSaveTitle}
                          className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 shrink-0"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditTitle(deal.title);
                            setIsEditingTitle(false);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted shrink-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-1 group">
                        <span className="font-bold text-foreground truncate text-xs" title={deal?.title}>
                          {deal?.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditTitle(deal?.title || "");
                            setIsEditingTitle(true);
                          }}
                          className="p-1 text-muted-foreground hover:text-foreground opacity-60 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                          title="Editar nome"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Valor Total Editável */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground font-semibold block">Valor total</label>
                    {isEditingValue ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-muted-foreground">R$</span>
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          placeholder="0,00"
                          className="h-7 flex-1 rounded-lg border border-primary bg-card px-2 text-xs font-extrabold text-foreground focus:outline-none"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveValue();
                            if (e.key === "Escape") setIsEditingValue(false);
                          }}
                        />
                        <button
                          type="button"
                          onClick={handleSaveValue}
                          className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 shrink-0"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingValue(false)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted shrink-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-1 group">
                        <span className="font-extrabold text-foreground text-xs">
                          {formattedValue}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditValue(deal?.value ? String(deal.value).replace(".", ",") : "");
                            setIsEditingValue(true);
                          }}
                          className="p-1 text-muted-foreground hover:text-foreground opacity-60 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                          title="Editar valor"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Qualificação (1 a 5 estrelas) logo após o valor */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground font-semibold block">Qualificação</label>
                    <div className="flex items-center gap-1 py-0.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          onClick={() => updateDeal({ rating: star })}
                          className={`h-4 w-4 cursor-pointer hover:scale-110 transition-transform ${
                            (deal?.rating || 0) >= star
                              ? "fill-primary text-primary"
                              : "text-muted-foreground/30"
                          }`}
                        />
                      ))}
                      <span className="text-[11px] text-muted-foreground ml-1.5 font-bold">
                        {deal?.rating ? `${deal.rating}/5` : "Não avaliado"}
                      </span>
                    </div>
                  </div>

                  {/* Responsável / Vendedor Editável */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground font-semibold block">Responsável</label>
                    <Select
                      value={deal?.operatorId || deal?.ownerId || "__none__"}
                      onValueChange={(val) => updateDeal({ operatorId: val === "__none__" ? null : val })}
                    >
                      <SelectTrigger className="h-7 w-full text-xs rounded-lg border border-border bg-card px-2 font-semibold text-foreground">
                        <SelectValue placeholder="Sem vendedor atribuído" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-xs text-muted-foreground">Sem vendedor atribuído</SelectItem>
                        {Array.from(operatorsMap.entries()).map(([id, name]) => (
                          <SelectItem key={id} value={id} className="text-xs font-medium">
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Previsão de Fechamento */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground font-semibold block">Previsão de Fechamento</label>
                    <input
                      type="date"
                      value={deal?.expectedCloseDate ? String(deal.expectedCloseDate).substring(0, 10) : ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateDeal({ expectedCloseDate: val ? new Date(val + "T12:00:00Z").toISOString() : null });
                      }}
                      className="w-full h-7 rounded-lg border border-border bg-card px-2 text-xs text-foreground outline-none focus:border-primary cursor-pointer"
                    />
                  </div>

                  {/* Origem do Lead -> agora com nome "Fonte" */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground font-semibold block">Fonte</label>
                    <CatalogSelect kind="source" value={deal?.source || ""} onChange={(val) => updateDeal({ source: val })} className="w-full h-7 rounded-lg border-border bg-card px-2 text-xs" />
                  </div>

                  {/* Campanha */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground font-semibold block">Campanha</label>
                    <CatalogSelect kind="campaign" value={deal?.campaign || ""} onChange={(val) => updateDeal({ campaign: val })} className="w-full h-7 rounded-lg border-border bg-card px-2 text-xs" />
                  </div>

                  {/* Datas do Sistema */}
                  <div className="pt-2 border-t border-border/60 space-y-1 text-[10px] text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>Criado em:</span>
                      <span className="font-semibold text-foreground">
                        {deal?.createdAt
                          ? new Date(deal.createdAt).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "-"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Atualizado em:</span>
                      <span className="font-semibold text-foreground">
                        {deal?.updatedAt
                          ? new Date(deal.updatedAt).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "-"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Card Contatos Participantes */}
              <div className="crm-side-contacts order-2 rounded-sm border border-border bg-card p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Contatos ({deal?.contacts?.length || 0})
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsAddContactDrawerOpen(true)}
                    className="text-[10px] font-medium text-primary hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Adicionar</span>
                  </button>
                </div>

                {deal?.contacts && deal.contacts.length > 0 ? (
                  deal.contacts.map((c: any) => (
                    <div key={c.id} className="rounded-sm bg-muted/40 p-2 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-foreground truncate">{c.contact?.name || "Contato"}</div>
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Ligar via VigosPhone */}
                          {c.contact?.phone && (
                            <SystemTooltip content="Ligar via VigosPhone">
                              <a
                                href={getVigosPhoneLink(c.contact.phone)}
                                className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-primary transition-colors cursor-pointer"
                              >
                                <PhoneCall className="h-3.5 w-3.5" />
                              </a>
                            </SystemTooltip>
                          )}

                          {/* Abrir Chat Principal */}
                          <SystemTooltip content="Abrir conversa no Chat">
                            <button
                              type="button"
                              onClick={() => handleOpenChatForContact(c.contactId)}
                              disabled={openingChatContactId === c.contactId}
                              className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-primary transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {openingChatContactId === c.contactId ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                              ) : (
                                <MessageSquare className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </SystemTooltip>

                          {/* Abrir Mini Chat */}
                          <SystemTooltip content="Abrir no Mini Chat">
                            <button
                              type="button"
                              onClick={() => handleOpenMiniChatForContact(c.contactId)}
                              disabled={openingChatContactId === c.contactId}
                              className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-primary transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                            </button>
                          </SystemTooltip>

                          {/* Remover participante */}
                          <SystemTooltip content="Remover participante">
                            <button
                              type="button"
                              onClick={() => handleRemoveParticipant(c.contactId)}
                              className="text-muted-foreground hover:text-rose-500 p-0.5 rounded-sm transition-colors cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </SystemTooltip>
                        </div>
                      </div>
                      {c.contact?.phone && (
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {formatContactPhone(c.contact.phone)}
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1">
                        <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary uppercase">
                          {c.role || "buyer"}
                        </span>
                        {c.isPrimary ? (
                          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-bold text-foreground">
                            Principal
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSetPrimaryParticipant(c.contactId)}
                            className="text-[9px] text-muted-foreground hover:text-primary hover:underline cursor-pointer"
                          >
                            Tornar principal
                          </button>
                        )}
                      </div>
                      <ContactCustomFieldsCard contactId={c.contactId} />
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-muted-foreground/60 italic">Nenhum contato participante vinculado.</p>
                )}
              </div>

              {/* 3. Card da Empresa */}
              <div className="crm-side-account order-3 rounded-sm border border-border bg-card p-3.5 space-y-3 scrollbar-none">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Empresa
                </span>

                {deal?.account ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        {deal.account.type === "company" ? (
                          <Building2 className="h-4 w-4 text-primary shrink-0" />
                        ) : (
                          <User className="h-4 w-4 text-primary shrink-0" />
                        )}
                        <div className="min-w-0">
                          <SystemTooltip content="Ver ficha completa do cliente">
                            <button
                              type="button"
                              onClick={() => setIsAccountDetailOpen(true)}
                              className="text-xs font-bold text-primary hover:underline block truncate text-left"
                            >
                              {deal.account.name}
                            </button>
                          </SystemTooltip>
                          <span className="text-[10px] text-muted-foreground block">
                            {deal.account.type === "company" ? "Pessoa Jurídica (PJ)" : "Pessoa Física (PF)"}
                          </span>
                        </div>
                      </div>
                      <SystemTooltip content="Abrir ficha cadastral do cliente">
                        <button
                          type="button"
                          onClick={() => setIsAccountDetailOpen(true)}
                          className="p-1 text-muted-foreground hover:text-primary rounded-md transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </SystemTooltip>
                    </div>

                    {deal.account.tradeName && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        Nome Fantasia: <span className="text-foreground">{deal.account.tradeName}</span>
                      </p>
                    )}
                    {deal.account.segment && <p className="truncate text-[11px] text-muted-foreground">Segmento: <span className="text-foreground">{deal.account.segment}</span></p>}

                    {deal.account.document && (
                      <div className="text-[11px] text-muted-foreground">
                        {deal.account.type === "company" || deal.account.document.length === 14 ? "CNPJ" : "CPF"}:{" "}
                        <span className="font-semibold text-foreground font-mono">
                          {deal.account.document.length === 14
                            ? deal.account.document.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")
                            : deal.account.document.length === 11
                            ? deal.account.document.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
                            : deal.account.document}
                        </span>
                      </div>
                    )}

                    {deal.account.phone && (
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span>{deal.account.phone}</span>
                      </div>
                    )}

                    {deal.account.email && (
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{deal.account.email}</span>
                      </div>
                    )}

                    {deal.account.address && (deal.account.address.city || deal.account.address.state) && (
                      <div className="text-[11px] text-muted-foreground">
                        {deal.account.address.city}{deal.account.address.state ? ` - ${deal.account.address.state}` : ""}
                      </div>
                    )}
                    <CustomFieldsSummary entity="company" values={deal.account.customFields || {}} />
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground/60 italic py-2">
                    Nenhum cliente ou empresa vinculado.
                  </div>
                )}
              </div>

              {/* 4. Card Exclusivo de Campos Personalizados */}
              <div className="crm-side-custom-fields order-4 rounded-sm border border-border bg-card p-3.5 space-y-3 scrollbar-none">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Campos Personalizados
                </span>

                <CustomFieldsEditor entity="deal" pipelineId={deal?.pipelineId} values={customFieldDraft} onChange={setCustomFieldDraft} hideTitle />

                {JSON.stringify(customFieldDraft) !== JSON.stringify(deal?.customFields || {}) && (
                  <button
                    type="button"
                    onClick={() => updateDeal({ customFields: changedCustomFieldValues(deal?.customFields || {}, customFieldDraft) })}
                    className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 shadow-xs cursor-pointer transition-opacity"
                  >
                    Salvar campos personalizados
                  </button>
                )}
              </div>
            </div>

            {/* Painel Direito: Próximas Tarefas (Topo) + Abas Compactas + Conteúdo */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
              {/* Bloco de Próximas Tarefas no topo da coluna direita */}
              {!loading && deal && (
                <div className="p-4 border-b border-border/60 bg-card shrink-0 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-bold text-foreground">Próximas tarefas</h3>
                    </div>
                    {deal.nextTask && (
                      <button
                        type="button"
                        onClick={() => setIsCreateTaskModalOpen(true)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Nova tarefa</span>
                      </button>
                    )}
                  </div>

                  {deal.nextTask ? (
                    <div className="rounded-xl border border-border bg-card p-3.5 shadow-2xs flex items-center justify-between gap-4 transition-all">
                      {/* Left: Tipo + Assunto + Descrição (Padrão Referência) */}
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/80 mt-0.5">
                          {(() => {
                            const taskTypeMeta = getTaskTypeMeta(deal.nextTask.type);
                            const TaskIcon = taskTypeMeta.icon;
                            return <TaskIcon className="h-4 w-4" />;
                          })()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-extrabold text-foreground shrink-0">
                              {getTaskTypeMeta(deal.nextTask.type).label}
                            </span>
                            <span className="text-xs font-bold text-foreground truncate">
                              {deal.nextTask.title}
                            </span>
                          </div>
                          {deal.nextTask.description && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                              {deal.nextTask.description}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Right: Badge ATRASADA/VENCE HOJE/NO PRAZO em Vermelho + Data/Hora + Ações */}
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div>
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                deal.nextTask.isOverdue
                                  ? "bg-primary text-primary-foreground"
                                  : deal.nextTask.isToday
                                  ? "bg-amber-600 text-white"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {deal.nextTask.isOverdue
                                ? "ATRASADA"
                                : deal.nextTask.isToday
                                ? "VENCE HOJE"
                                : deal.nextTask.hasNoDueDate
                                ? "SEM PRAZO"
                                : "NO PRAZO"}
                            </span>
                          </div>
                          {deal.nextTask.dueDate && (
                            <span className="text-[11px] font-medium text-muted-foreground block mt-0.5">
                              {new Date(deal.nextTask.dueDate).toLocaleDateString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <SystemTooltip content="Editar tarefa">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTab("tasks");
                                setTasksSubTab("pending");
                              }}
                              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors cursor-pointer"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </SystemTooltip>

                          <SystemTooltip content="Reagendar prazo da tarefa">
                            <button
                              type="button"
                              onClick={() => {
                                setReschedulingActivityId(deal.nextTask.id);
                                setRescheduleDueDate(deal.nextTask.dueDate ? deal.nextTask.dueDate.slice(0, 16) : "");
                                setActiveTab("tasks");
                                setTasksSubTab("pending");
                              }}
                              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors cursor-pointer"
                            >
                              <Clock className="h-4 w-4" />
                            </button>
                          </SystemTooltip>

                          <SystemTooltip content="Concluir tarefa">
                            <button
                              type="button"
                              onClick={() => handleCompleteActivity(deal.nextTask.id)}
                              className="h-8 w-8 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground flex items-center justify-center transition-colors shadow-xs cursor-pointer"
                            >
                              <Check className="h-4 w-4 stroke-[2.5]" />
                            </button>
                          </SystemTooltip>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs">
                      <div className="flex items-center gap-4 min-w-0">
                        <img
                          src="/illustrations/empty-tasks-v2.png"
                          alt="Sem tarefas pendentes"
                          className="h-14 sm:h-16 w-auto object-contain shrink-0"
                        />
                        <span className="text-xs font-medium text-foreground">
                          Não existem tarefas pendentes para essa Negociação
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsCreateTaskModalOpen(true)}
                        className="flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground px-3.5 py-1.5 text-xs font-semibold shadow-xs transition-colors cursor-pointer shrink-0"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Criar tarefa</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Barra de Abas Compactas */}
              <div className="crm-deal-tabs flex overflow-x-auto scrollbar-none border-b border-border bg-card px-4 shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("history")}
                  className={`px-3 py-2 text-xs transition-colors cursor-pointer whitespace-nowrap border-b-2 ${
                    activeTab === "history"
                      ? "border-primary text-primary font-bold"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border font-medium"
                  }`}
                >
                  Histórico
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("emails")}
                  className={`px-3 py-2 text-xs transition-colors cursor-pointer whitespace-nowrap border-b-2 ${
                    activeTab === "emails"
                      ? "border-primary text-primary font-bold"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border font-medium"
                  }`}
                >
                  E-mail
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("tasks")}
                  className={`px-3 py-2 text-xs transition-colors cursor-pointer whitespace-nowrap border-b-2 ${
                    activeTab === "tasks"
                      ? "border-primary text-primary font-bold"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border font-medium"
                  }`}
                >
                  Tarefas & Notas
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("questionnaires")}
                  className={`px-3 py-2 text-xs transition-colors cursor-pointer whitespace-nowrap border-b-2 ${
                    activeTab === "questionnaires"
                      ? "border-primary text-primary font-bold"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border font-medium"
                  }`}
                >
                  Questionários
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("products")}
                  className={`px-3 py-2 text-xs transition-colors cursor-pointer whitespace-nowrap border-b-2 ${
                    activeTab === "products"
                      ? "border-primary text-primary font-bold"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border font-medium"
                  }`}
                >
                  Produtos
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("files")}
                  className={`px-3 py-2 text-xs transition-colors cursor-pointer whitespace-nowrap border-b-2 ${
                    activeTab === "files"
                      ? "border-primary text-primary font-bold"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border font-medium"
                  }`}
                >
                  Arquivos
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("conversations")}
                  className={`px-3 py-2 text-xs transition-colors cursor-pointer whitespace-nowrap border-b-2 ${
                    activeTab === "conversations"
                      ? "border-primary text-primary font-bold"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border font-medium"
                  }`}
                >
                  Conversas
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("evidence")}
                  className={`px-3 py-2 text-xs transition-colors cursor-pointer whitespace-nowrap border-b-2 ${
                    activeTab === "evidence"
                      ? "border-primary text-primary font-bold"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border font-medium"
                  }`}
                >
                  Evidências
                </button>
              </div>

              {/* Conteúdo da Aba */}
              <div className="crm-deal-tab-content flex-1 min-h-0 p-5 overflow-y-auto scrollbar-none">
                {/* ABA 1: TAREFAS & NOTAS */}
                {activeTab === "tasks" && (
                  <div className="space-y-6 animate-in fade-in-50 duration-200 slide-in-from-bottom-1">
                    {/* Sub-abas de Atividades e Notas */}
                    {(() => {
                      const allActivities = deal?.activities || [];
                      const pendingTasks = allActivities.filter((a: any) => a.status === "pending" && a.type !== "note");
                      const completedTasks = allActivities.filter((a: any) => a.status === "completed" && a.type !== "note");
                      const cancelledTasks = allActivities.filter((a: any) => a.status === "cancelled" && a.type !== "note");
                      const notesList = allActivities.filter((a: any) => a.type === "note");

                      const displayedList =
                        tasksSubTab === "pending"
                          ? pendingTasks
                          : tasksSubTab === "completed"
                          ? completedTasks
                          : tasksSubTab === "cancelled"
                          ? cancelledTasks
                          : notesList;

                      return (
                        <div className="space-y-4">
                          {/* Botões de Filtro / Sub-abas */}
                          <div className="flex items-center justify-between border-b border-border/60 pb-2 flex-wrap gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() => setTasksSubTab("pending")}
                                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                                  tasksSubTab === "pending"
                                    ? "bg-primary text-primary-foreground shadow-xs"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                }`}
                              >
                                <span>Pendentes</span>
                                <span className="rounded-full bg-primary-foreground/20 px-1.5 py-0.2 text-[10px]">
                                  {pendingTasks.length}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setTasksSubTab("completed")}
                                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                                  tasksSubTab === "completed"
                                    ? "bg-primary text-primary-foreground shadow-xs"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                }`}
                              >
                                <span>Concluídas</span>
                                <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px]">
                                  {completedTasks.length}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setTasksSubTab("cancelled")}
                                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                                  tasksSubTab === "cancelled"
                                    ? "bg-slate-700 text-white shadow-xs"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                }`}
                              >
                                <span>Canceladas</span>
                                <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px]">
                                  {cancelledTasks.length}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setTasksSubTab("notes")}
                                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                                  tasksSubTab === "notes"
                                    ? "bg-primary text-primary-foreground shadow-xs"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                }`}
                              >
                                <span>Notas Comerciais</span>
                                <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px]">
                                  {notesList.length}
                                </span>
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => setIsCreateTaskModalOpen(true)}
                              className="flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-1.5 text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              <span>Criar tarefa</span>
                            </button>
                          </div>

                          {/* Lista Filtrada */}
                          <div className="space-y-2.5">
                            {displayedList.length > 0 ? (
                              displayedList.map((act: any) => {
                                const isNote = act.type === "note";
                                const isPending = act.status === "pending";
                                const isCompleted = act.status === "completed";
                                const isCancelled = act.status === "cancelled";

                                const due = act.dueDate ? new Date(act.dueDate) : null;
                                const now = new Date();
                                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
                                const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
                                const isOverdue = due ? due.getTime() < now.getTime() : false;
                                const isToday = due ? due >= startOfToday && due <= endOfToday : false;

                                return (
                                  <div
                                    key={act.id}
                                    className={`rounded-xl border p-3.5 shadow-xs transition-colors space-y-2 ${
                                      isNote
                                        ? "border-border bg-muted/20"
                                        : isCompleted
                                        ? "border-border/60 bg-muted/10 opacity-80"
                                        : isCancelled
                                        ? "border-border/40 bg-muted/10 opacity-60 line-through"
                                        : isOverdue
                                        ? "border-rose-500/30 bg-rose-500/5"
                                        : isToday
                                        ? "border-primary/30 bg-primary/5"
                                        : "border-border/80 bg-card"
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex-1 min-w-0 space-y-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-bold text-xs text-foreground">{act.title}</span>
                                          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground uppercase font-semibold">
                                            {act.type}
                                          </span>

                                          {/* Status temporal para pendentes */}
                                          {isPending && !isNote && (
                                            <span
                                              className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${
                                                isOverdue
                                                  ? "bg-rose-600 text-white"
                                                  : isToday
                                                  ? "bg-primary/10 text-primary"
                                                  : act.dueDate
                                                  ? "bg-primary/10 text-primary"
                                                  : "bg-muted text-muted-foreground"
                                              }`}
                                            >
                                              {isOverdue ? "Atrasada" : isToday ? "Hoje" : act.dueDate ? "No Prazo" : "Sem Prazo"}
                                            </span>
                                          )}

                                          {/* Selo de Nota Imutável */}
                                          {isNote && (
                                            <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-muted-foreground">
                                              Histórico Permanente
                                            </span>
                                          )}
                                        </div>

                                        {act.description && (
                                          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{act.description}</p>
                                        )}
                                      </div>

                                      {/* Ações Rápidas por Tipo */}
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {isPending && !isNote && (
                                          <>
                                            <SystemTooltip content="Marcar como concluída">
                                              <button
                                                type="button"
                                                onClick={() => handleCompleteActivity(act.id)}
                                                className="flex h-7 items-center gap-1 rounded-lg bg-primary px-2 text-[11px] font-bold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
                                              >
                                                <Check className="h-3 w-3" />
                                                <span>Concluir</span>
                                              </button>
                                            </SystemTooltip>

                                            <SystemTooltip content="Reagendar prazo">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  if (reschedulingActivityId === act.id) {
                                                    setReschedulingActivityId(null);
                                                  } else {
                                                    setReschedulingActivityId(act.id);
                                                    setRescheduleDueDate(act.dueDate ? act.dueDate.slice(0, 16) : "");
                                                  }
                                                }}
                                                className="flex h-7 items-center gap-1 rounded-lg border border-border bg-card px-2 text-[11px] font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                                              >
                                                <Calendar className="h-3 w-3 text-muted-foreground" />
                                                <span>Reagendar</span>
                                              </button>
                                            </SystemTooltip>

                                            <SystemTooltip content="Cancelar tarefa">
                                              <button
                                                type="button"
                                                onClick={() => handleCancelActivity(act.id)}
                                                className="flex h-7 items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/5 px-2 text-[11px] font-semibold text-red-600 hover:bg-red-500/10 transition-colors cursor-pointer"
                                              >
                                                <XCircle className="h-3 w-3" />
                                                <span>Cancelar</span>
                                              </button>
                                            </SystemTooltip>
                                          </>
                                        )}

                                        {(isCompleted || isCancelled) && (
                                          <SystemTooltip content="Reabrir tarefa como pendente">
                                            <button
                                              type="button"
                                              onClick={() => handleReopenActivity(act.id)}
                                              className="flex h-7 items-center gap-1 rounded-lg border border-border bg-card px-2 text-[11px] font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                                            >
                                              <RotateCcw className="h-3 w-3 text-primary" />
                                              <span>Reabrir</span>
                                            </button>
                                          </SystemTooltip>
                                        )}

                                        {!isNote && (
                                          <SystemTooltip content="Excluir tarefa">
                                            <button
                                              type="button"
                                              onClick={() => handleDeleteActivity(act.id)}
                                              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors cursor-pointer"
                                            >
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                          </SystemTooltip>
                                        )}
                                      </div>
                                    </div>

                                    {/* Formulário Inline de Reagendamento */}
                                    {reschedulingActivityId === act.id && (
                                      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2 animate-in fade-in">
                                        <span className="text-[11px] font-bold text-foreground">Novo Prazo:</span>
                                        <input
                                          type="datetime-local"
                                          value={rescheduleDueDate}
                                          onChange={(e) => setRescheduleDueDate(e.target.value)}
                                          className="h-7 rounded border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                        <button
                                          type="button"
                                          disabled={reschedulingLoading || !rescheduleDueDate}
                                          onClick={() => handleRescheduleActivity(act.id, rescheduleDueDate)}
                                          className="h-7 rounded bg-primary px-3 text-[11px] font-bold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                                        >
                                          {reschedulingLoading ? "Salvando..." : "Salvar Prazo"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setReschedulingActivityId(null)}
                                          className="h-7 rounded border border-border bg-card px-2.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted cursor-pointer"
                                        >
                                          Cancelar
                                        </button>
                                      </div>
                                    )}

                                    {/* Metadados e Rodapé do Card */}
                                    <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[10px] text-muted-foreground">
                                      <div className="flex items-center gap-3">
                                        {act.dueDate && (
                                          <span>
                                            Prazo: <span className="font-semibold text-foreground">{new Date(act.dueDate).toLocaleString("pt-BR")}</span>
                                          </span>
                                        )}
                                        {act.completedAt && (
                                          <span>
                                            Concluída em: {new Date(act.completedAt).toLocaleString("pt-BR")}
                                          </span>
                                        )}
                                        {act.assignedToOperatorName && (
                                          <span>
                                            Responsável: <span className="font-semibold text-foreground">{act.assignedToOperatorName}</span>
                                          </span>
                                        )}
                                      </div>
                                      <span>
                                        Criado em {new Date(act.createdAt).toLocaleDateString("pt-BR")}
                                        {act.operatorName ? ` por ${act.operatorName}` : ""}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              <p className="text-center py-8 text-xs text-muted-foreground/60 italic">
                                {tasksSubTab === "pending"
                                  ? "Nenhuma tarefa pendente nesta negociação."
                                  : tasksSubTab === "completed"
                                  ? "Nenhuma tarefa concluída nesta negociação."
                                  : tasksSubTab === "cancelled"
                                  ? "Nenhuma tarefa cancelada nesta negociação."
                                  : "Nenhuma nota comercial registrada."}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* ABA 2: CONVERSAS VINCULADAS */}
                {activeTab === "conversations" && (
                  <div className="space-y-4 animate-in fade-in-50 duration-200 slide-in-from-bottom-1">
                    {/* Topo da aba com ação de vincular */}
                    <div className="flex items-center justify-between border-b border-border/60 pb-3">
                      <div>
                        <h4 className="text-xs font-bold text-foreground">Atendimentos Vinculados</h4>
                        <p className="text-[11px] text-muted-foreground">
                          Conversas dos canais de mensagem vinculadas a este card
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          handleSearchConversations();
                          setShowLinkConvModal(true);
                        }}
                        className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer shadow-xs"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Vincular Conversa</span>
                      </button>
                    </div>

                    {/* Modal para Vincular Conversa Existente */}
                    {showLinkConvModal && (
                      <div className="rounded-2xl border border-primary/30 bg-card p-4 shadow-lg space-y-3 animate-in fade-in">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground">Vincular Atendimento Existente</span>
                          <button
                            type="button"
                            onClick={() => setShowLinkConvModal(false)}
                            className="p-1 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Buscar conversa por nome do cliente ou telefone..."
                            value={searchConvQuery}
                            onChange={(e) => setSearchConvQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSearchConversations()}
                            className="h-8 flex-1 rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <button
                            type="button"
                            onClick={handleSearchConversations}
                            className="h-8 px-3 rounded-xl bg-primary text-xs font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
                          >
                            Buscar
                          </button>
                        </div>

                        <div className="max-h-56 overflow-y-auto space-y-1.5">
                          {searchingConvs ? (
                            <div className="py-6 text-center">
                              <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                            </div>
                          ) : availableConvs.length === 0 ? (
                            <p className="py-6 text-center text-xs text-muted-foreground/60 italic">
                              Nenhuma conversa encontrada para vincular.
                            </p>
                          ) : (
                            availableConvs.map((cv: any) => {
                              const contactName = cv.customerName || cv.contact?.name || cv.name || "Cliente";
                              const contactPhone = cv.phone || cv.contact?.phone || "-";
                              return (
                                <div
                                  key={cv.id}
                                  className="flex items-center justify-between p-2.5 rounded-xl border border-border/60 hover:bg-muted/30 transition-colors"
                                >
                                  <div className="min-w-0 pr-2">
                                    <p className="text-xs font-bold text-foreground truncate">{contactName}</p>
                                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                      <span>{contactPhone}</span>
                                      <span>•</span>
                                      <span className="uppercase">{cv.mainChannel || cv.channel || "WhatsApp"}</span>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleLinkConversation(cv.id)}
                                    className="flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer shrink-0"
                                  >
                                    <Link2 className="h-3 w-3" />
                                    <span>Vincular</span>
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}

                    {/* Lista de Conversas Vinculadas com DTO Rico */}
                    {deal?.conversations && deal.conversations.length > 0 ? (
                      deal.conversations.map((c: any) => {
                        const contactName = c.contactName || c.conversation?.customerName || "Cliente sem nome";
                        const contactPhone = c.contactPhone || c.conversation?.phone || "-";
                        const channel = (c.mainChannel || c.channel || c.conversation?.channel || "whatsapp").toLowerCase();
                        const queueState = c.queueState || c.conversation?.queueState || "meus";
                        const operatorName = c.operatorName || (c.conversation?.operatorId ? "Operador" : "Na Fila");

                        // Tradução amigável do queueState
                        const queueLabel =
                          queueState === "meus"
                            ? "Em atendimento"
                            : queueState === "fila"
                            ? "Na fila"
                            : queueState === "automacao"
                            ? "Automação / Bot"
                            : queueState === "finalizados"
                            ? "Finalizado"
                            : queueState;

                        return (
                          <div
                            key={c.id || c.linkId}
                            className="flex items-center justify-between rounded-xl border border-border bg-card p-3.5 shadow-xs hover:border-primary/40 transition-colors"
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              {/* Avatar */}
                              {c.contactAvatar ? (
                                <img
                                  src={c.contactAvatar}
                                  alt={contactName}
                                  className="h-10 w-10 rounded-full object-cover shrink-0 border border-border"
                                />
                              ) : (
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-xs text-primary">
                                  {contactName.substring(0, 2).toUpperCase()}
                                </div>
                              )}

                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-bold text-foreground">
                                    {contactName}
                                  </span>

                                  {/* Canal Real */}
                                  <span
                                    className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground"
                                  >
                                    {channel}
                                  </span>

                                  {/* Estado / Fila */}
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                      queueState === "finalizados"
                                        ? "bg-muted text-muted-foreground"
                                        : queueState === "fila"
                                        ? "bg-muted text-foreground"
                                        : "bg-primary/10 text-primary"
                                    }`}
                                  >
                                    {queueLabel}
                                  </span>

                                  {/* Responsável */}
                                  <span className="text-[10px] text-muted-foreground font-medium">
                                    • Resp: <span className="text-foreground">{operatorName}</span>
                                  </span>
                                </div>

                                <p className="text-[11px] text-muted-foreground truncate">
                                  Telefone: <span className="font-mono text-foreground">{contactPhone}</span>
                                  {c.linkedAt && (
                                    <span className="ml-2 opacity-75">
                                      (Vinculado em {new Date(c.linkedAt).toLocaleDateString("pt-BR")})
                                    </span>
                                  )}
                                </p>

                                {c.lastMessageText && (
                                  <p className="text-[11px] text-muted-foreground/90 italic truncate max-w-md">
                                    "{c.lastMessageText}"
                                    {c.lastMessageTime && (
                                      <span className="ml-1 text-[10px] opacity-75 not-italic">
                                        • {new Date(c.lastMessageTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                                      </span>
                                    )}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0 ml-3">
                              {/* Botão Abrir Chat */}
                              <SystemTooltip content="Abrir conversa no chat principal">
                                <button
                                  type="button"
                                  onClick={() => handleOpenConversation(c.conversationId || c.id)}
                                  className="flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
                                >
                                  <span>Abrir Chat</span>
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </button>
                              </SystemTooltip>

                              {/* Botão Desvincular */}
                              <SystemTooltip content="Desvincular atendimento deste negócio">
                                <button
                                  type="button"
                                  onClick={() => handleUnlinkConversation(c.conversationId || c.id)}
                                  className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors cursor-pointer"
                                >
                                  <Unlink className="h-3.5 w-3.5" />
                                </button>
                              </SystemTooltip>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-10 space-y-2">
                        <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground/40" />
                        <p className="text-xs text-muted-foreground/60 italic">
                          Nenhum atendimento vinculado a esta negociação ainda.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            handleSearchConversations();
                            setShowLinkConvModal(true);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline cursor-pointer"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Vincular primeira conversa</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ABA DE EVIDÊNCIAS COMERCIAIS */}
                {activeTab === "evidence" && (
                  <div className="space-y-3 animate-in fade-in-50 duration-200 slide-in-from-bottom-1">
                    {deal?.evidences && deal.evidences.length > 0 ? (
                      deal.evidences.map((evi: any) => (
                        <div
                          key={evi.id}
                          className="rounded-xl border border-border bg-card p-4 shadow-xs space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Bookmark className="h-4 w-4 text-primary fill-primary/20" />
                              <span className="text-xs font-bold text-foreground">
                                {evi.message?.author || "Mensagem de Chat"}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {evi.createdAt ? new Date(evi.createdAt).toLocaleString("pt-BR") : ""}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {evi.message?.conversationId && (
                                <SystemTooltip content="Abrir no Chat">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenConversation(evi.message.conversationId)}
                                    className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
                                  >
                                    <MessageCircle className="h-3 w-3" />
                                    <span>Ver no Chat</span>
                                  </button>
                                </SystemTooltip>
                              )}
                              <SystemTooltip content="Desmarcar evidência">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveEvidence(evi.id)}
                                  className="flex items-center gap-1 rounded-lg bg-red-500/10 px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-500 hover:text-white transition-colors cursor-pointer"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  <span>Remover</span>
                                </button>
                              </SystemTooltip>
                            </div>
                          </div>

                          {/* Balão da Mensagem */}
                          <div className="rounded-lg bg-muted/50 p-3 text-xs text-foreground font-mono whitespace-pre-wrap border border-border/40">
                            {evi.message?.content || evi.message?.text || "(Mensagem sem conteúdo textual)"}
                          </div>

                          {/* Nota Explicativa Comercial */}
                          {evi.note && (
                            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-2.5 text-xs text-foreground">
                              <span className="font-bold shrink-0">Nota:</span>
                              <span className="italic">{evi.note}</span>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12 space-y-2">
                        <Bookmark className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                        <p className="text-xs text-muted-foreground font-medium">
                          Nenhuma mensagem foi marcada como evidência comercial nesta negociação.
                        </p>
                        <p className="text-[11px] text-muted-foreground/60 max-w-sm mx-auto">
                          No painel de atendimento, passe o mouse sobre mensagens importantes (propostas, aprovações, dados de pagamento) e clique no ícone de evidência.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* ABA 4: PRODUTOS & PROPOSTA COMERCIAL */}
                {activeTab === "products" && (
                  <div className="space-y-6 animate-in fade-in-50 duration-200 slide-in-from-bottom-1">
                    {/* Cabeçalho da Seção de Produtos */}
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                      <div>
                        <span className="text-xs font-bold text-foreground block">
                          Composição Comercial & Itens da Negociação
                        </span>
                        <p className="text-[11px] text-muted-foreground">
                          Adicione itens do catálogo ou personalizados. O valor da negociação é recalculado automaticamente.
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowProposalModal(true)}
                          className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <span>Emitir Proposta Comercial</span>
                        </button>
                      </div>
                    </div>

                    {/* Modal / Card Inline de Emissão de Proposta */}
                    {showProposalModal && (
                      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3 animate-in fade-in">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                            <FileText className="h-4 w-4 text-primary" />
                            Formalizar Proposta Comercial
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowProposalModal(false)}
                            className="text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          <div>
                            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                              Título da Proposta
                            </label>
                            <input
                              type="text"
                              value={proposalTitle}
                              onChange={(e) => setProposalTitle(e.target.value)}
                              placeholder={`Proposta Comercial - ${deal?.title || ""}`}
                              className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                              Validade (Dias)
                            </label>
                            <input
                              type="number"
                              value={proposalValidityDays}
                              onChange={(e) => setProposalValidityDays(parseInt(e.target.value, 10) || 15)}
                              className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                              Condições de Pagamento
                            </label>
                            <input
                              type="text"
                              value={proposalPaymentTerms}
                              onChange={(e) => setProposalPaymentTerms(e.target.value)}
                              className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                              Condições de Frete / Entrega
                            </label>
                            <input
                              type="text"
                              value={proposalDeliveryTerms}
                              onChange={(e) => setProposalDeliveryTerms(e.target.value)}
                              className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                          <button
                            type="button"
                            onClick={() => setShowProposalModal(false)}
                            className="h-7 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={handleGenerateProposal}
                            disabled={generatingProposal}
                            className="flex h-7 items-center gap-1.5 px-4 rounded-lg bg-primary text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
                          >
                            {generatingProposal ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                            <span>Gerar Proposta Oficial</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Formulário: Adicionar Item ao Deal */}
                    <form onSubmit={handleAddProduct} className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <Plus className="h-3.5 w-3.5 text-primary" />
                          Adicionar Item à Negociação
                        </span>

                        {/* Atalho Catálogo */}
                        {catalogProducts.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <ShoppingBag className="h-3 w-3 text-muted-foreground" />
                            <Select
                              value={selectedCatalogId || "__none__"}
                              onValueChange={(val) => handleSelectCatalogItem(val === "__none__" ? "" : val)}
                            >
                              <SelectTrigger className="h-7 rounded-lg border border-border bg-card px-2 text-[11px] text-foreground min-w-[170px]">
                                <SelectValue placeholder="-- Puxar do Catálogo --" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__" className="text-xs text-muted-foreground">-- Puxar do Catálogo --</SelectItem>
                                {catalogProducts.map((p) => (
                                  <SelectItem key={p.id} value={p.id} className="text-xs">
                                    {p.name} (R$ {parseFloat(p.unitPrice).toFixed(2)})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 text-xs">
                        <div className="md:col-span-5">
                          <input
                            type="text"
                            required
                            placeholder="Nome / Descrição do produto ou serviço..."
                            value={newProductName}
                            onChange={(e) => setNewProductName(e.target.value)}
                            className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <input
                            type="number"
                            step="any"
                            min="0.001"
                            required
                            placeholder="Qtd"
                            value={newProductQty}
                            onChange={(e) => setNewProductQty(e.target.value)}
                            className="h-8 w-full rounded-lg border border-border bg-card px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            required
                            placeholder="Preço R$"
                            value={newProductUnitPrice}
                            onChange={(e) => setNewProductUnitPrice(e.target.value)}
                            className="h-8 w-full rounded-lg border border-border bg-card px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <div className="relative">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="100"
                              placeholder="Desc %"
                              value={newProductDiscount}
                              onChange={(e) => setNewProductDiscount(e.target.value)}
                              className="h-8 w-full rounded-lg border border-border bg-card px-2 pr-6 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            <Percent className="h-3 w-3 text-muted-foreground absolute right-2 top-2.5 pointer-events-none" />
                          </div>
                        </div>

                        <div className="md:col-span-1 flex items-center">
                          <SystemTooltip content="Adicionar produto">
                            <button
                              type="submit"
                              disabled={addingProduct || !newProductName.trim() || !newProductUnitPrice}
                              className="flex h-8 w-full items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
                            >
                              {addingProduct ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-4 w-4" />}
                            </button>
                          </SystemTooltip>
                        </div>
                      </div>
                    </form>

                    {/* Tabela de Produtos Vinculados */}
                    <div className="space-y-3">
                      <span className="text-xs font-bold text-foreground block">
                        Itens Cadastrados ({deal?.products?.length || 0})
                      </span>

                      {deal?.products && deal.products.length > 0 ? (
                        <div className="rounded-xl border border-border overflow-hidden bg-card">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-border bg-muted/40 text-[11px] font-bold text-muted-foreground">
                                <th className="p-3">Produto / Serviço</th>
                                <th className="p-3 text-right">Qtd</th>
                                <th className="p-3 text-right">Unitário</th>
                                <th className="p-3 text-right">Desconto</th>
                                <th className="p-3 text-right">Subtotal</th>
                                <th className="p-3 text-center w-12">Ação</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                              {deal.products.map((item: any) => (
                                <tr key={item.id} className="hover:bg-muted/10 transition-colors">
                                  <td className="p-3 font-semibold text-foreground">
                                    {item.name}
                                    {item.notes && (
                                      <span className="block text-[10px] text-muted-foreground font-normal">
                                        {item.notes}
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3 text-right text-muted-foreground">
                                    {parseFloat(item.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                                  </td>
                                  <td className="p-3 text-right text-muted-foreground">
                                    R$ {parseFloat(item.unitPrice).toFixed(2)}
                                  </td>
                                  <td className="p-3 text-right text-muted-foreground">
                                    {parseFloat(item.discountPercent) > 0 ? `${item.discountPercent}%` : "-"}
                                  </td>
                                  <td className="p-3 text-right font-bold text-foreground">
                                    R$ {parseFloat(item.totalPrice).toFixed(2)}
                                  </td>
                                  <td className="p-3 text-center">
                                    <SystemTooltip content="Remover item">
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveProduct(item.id)}
                                        className="p-1 rounded text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </SystemTooltip>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-border bg-muted/30 font-bold text-xs">
                                <td colSpan={4} className="p-3 text-right text-muted-foreground">
                                  Valor Total Recalculado:
                                </td>
                                <td className="p-3 text-right text-primary font-extrabold text-sm">
                                  R$ {parseFloat(deal.value || "0").toFixed(2)}
                                </td>
                                <td></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-border p-6 text-center space-y-1 bg-muted/5">
                          <Package className="h-6 w-6 text-muted-foreground/40 mx-auto" />
                          <p className="text-xs text-muted-foreground font-medium">
                            Nenhum item específico adicionado a esta negociação.
                          </p>
                          <p className="text-[11px] text-muted-foreground/60">
                            Adicione os produtos para que o orçamento seja gerado com precisão e transparência.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Propostas Comerciais Emitidas */}
                    <div className="space-y-3 pt-2">
                      <span className="text-xs font-bold text-foreground block">
                        Propostas Comerciais Emitidas ({deal?.proposals?.length || 0})
                      </span>

                      {deal?.proposals && deal.proposals.length > 0 ? (
                        <div className="space-y-3">
                          {deal.proposals.map((prop: any) => {
                            const statusColor =
                              prop.status === "rejected"
                                ? "bg-primary/10 text-primary border-primary/20"
                                : "bg-muted text-foreground border-border";

                            const statusLabel =
                              prop.status === "accepted"
                                ? "Aceita"
                                : prop.status === "sent"
                                ? "Enviada"
                                : prop.status === "copied"
                                ? "Texto Copiado"
                                : prop.status === "rejected"
                                ? "Recusada"
                                : prop.status === "expired"
                                ? "Expirada"
                                : "Rascunho";

                            return (
                              <div
                                key={prop.id}
                                className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-xs"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-primary" />
                                    <span className="text-xs font-bold text-foreground">
                                      {prop.proposalNumber}
                                    </span>
                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusColor}`}>
                                      {statusLabel}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground">
                                      • {new Date(prop.createdAt).toLocaleDateString("pt-BR")}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <SystemTooltip content="Copiar texto formatado para o WhatsApp (marca como 'Texto Copiado')">
                                      <button
                                        type="button"
                                        onClick={() => handleCopyProposalText(prop)}
                                        className="flex h-7 items-center gap-1 rounded-lg border border-border bg-muted/30 px-2.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                                      >
                                        <Copy className="h-3 w-3" />
                                        <span>Copiar p/ WhatsApp</span>
                                      </button>
                                    </SystemTooltip>

                                    {/* Ações de Status */}
                                    {(prop.status === "draft" || prop.status === "copied") && (
                                      <SystemTooltip content="Confirmar que a proposta foi efetivamente enviada ao cliente">
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateProposalStatus(prop.id, "sent")}
                                          className="h-7 px-2.5 rounded-lg bg-primary text-xs font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
                                        >
                                          Confirmar Envio
                                        </button>
                                      </SystemTooltip>
                                    )}

                                    {prop.status === "sent" && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateProposalStatus(prop.id, "accepted")}
                                          className="h-7 px-2.5 rounded-lg bg-primary text-xs font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
                                        >
                                          Aceita
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateProposalStatus(prop.id, "rejected")}
                                          className="h-7 px-2.5 rounded-lg border border-red-500/30 text-xs font-bold text-red-600 hover:bg-red-500/10 cursor-pointer"
                                        >
                                          Recusada
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>

                                <div className="text-xs text-muted-foreground space-y-1">
                                  <div className="flex justify-between font-semibold text-foreground">
                                    <span>{prop.title}</span>
                                    <span className="text-primary font-bold text-sm">
                                      R$ {parseFloat(prop.total).toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="text-[11px]">
                                    Pagamento: <span className="text-foreground">{prop.paymentTerms}</span> | Frete:{" "}
                                    <span className="text-foreground">{prop.deliveryTerms}</span> | Validade:{" "}
                                    <span className="text-foreground">{prop.validityDays} dias</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground/60 italic">
                          Nenhuma proposta formal emitida para este negócio ainda.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* ABA 6: ARQUIVOS & DOCUMENTOS */}
                {activeTab === "files" && (
                  <div className="space-y-6 animate-in fade-in-50 duration-200 slide-in-from-bottom-1">
                    {/* Área de Upload Direto da Máquina / Drag & Drop */}
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingOver(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingOver(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingOver(false);
                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                          handleFilesUpload(e.dataTransfer.files);
                        }
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      className={`relative flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed transition-all cursor-pointer ${
                        isDraggingOver
                          ? "border-primary bg-primary/10 scale-[1.01]"
                          : "border-border hover:border-primary/50 bg-card hover:bg-muted/30"
                      }`}
                    >
                      <input
                        type="file"
                        multiple
                        ref={fileInputRef}
                        onChange={(e) => {
                          if (e.target.files && e.target.files.length > 0) {
                            handleFilesUpload(e.target.files);
                          }
                        }}
                        className="hidden"
                      />

                      {uploadingFile ? (
                        <div className="flex flex-col items-center gap-2.5 py-3">
                          <Loader2 className="h-8 w-8 text-primary animate-spin" />
                          <div className="text-center">
                            <p className="text-xs font-bold text-foreground">
                              Enviando {uploadingFilesCount > 1 ? `${uploadingFilesCount} arquivos` : "arquivo"}...
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Gravando com segurança na negociação. Aguarde...
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center text-center gap-2">
                          <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shadow-sm">
                            <UploadCloud className="h-6 w-6" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-foreground">
                              Arraste e solte arquivos aqui, ou{" "}
                              <span className="text-primary underline">clique para procurar</span> no seu computador
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-1 max-w-md">
                              Suporta <strong>todos os tipos de arquivos</strong> (vídeos, fotos, planilhas, PDFs, documentos Word, arquivos ZIP, etc.) • Limite de até <strong>100MB</strong> por arquivo
                            </p>
                          </div>

                          <div className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-xs font-semibold text-foreground hover:bg-muted/80 transition-colors">
                            <FileUp className="h-3.5 w-3.5 text-primary" />
                            <span>Selecionar Arquivo(s) da Máquina</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Lista de Arquivos */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground block">
                          Documentos e Anexos ({deal?.files?.length || 0})
                        </span>
                        {deal?.files && deal.files.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            Clique em qualquer arquivo para abrir o visualizador completo
                          </span>
                        )}
                      </div>

                      {deal?.files && deal.files.length > 0 ? (
                        <div className="space-y-2">
                          {deal.files.map((file: any) => {
                            const cat = getFileCategory(file.fileName, file.mimeType);
                            const badge = getCategoryBadge(cat, file.fileName);
                            const BadgeIcon = badge.icon;
                            const downloadUrl = file.downloadUrl || `/api/crm/deals/${deal.id}/files/${file.id}?download=1`;

                            return (
                              <div
                                key={file.id}
                                onClick={() => {
                                  setPreviewFile(file);
                                  setIsPreviewOpen(true);
                                }}
                                className="flex items-center justify-between rounded-xl border border-border bg-card p-3 hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer group"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className={`h-10 w-10 rounded-xl border flex items-center justify-center shrink-0 ${badge.color}`}>
                                    <BadgeIcon className="h-5 w-5" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="text-xs font-bold text-foreground truncate max-w-sm sm:max-w-md group-hover:text-primary transition-colors">
                                        {file.fileName}
                                      </p>
                                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider border ${badge.color}`}>
                                        {badge.label}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                                      <span className="font-semibold text-foreground/80">{formatBytes(file.fileSize)}</span>
                                      <span>•</span>
                                      <span>
                                        {new Date(file.createdAt).toLocaleString("pt-BR", {
                                          dateStyle: "short",
                                          timeStyle: "short",
                                        })}
                                      </span>
                                      {(file.uploaderName || file.uploadedByName) && (
                                        <>
                                          <span>•</span>
                                          <span>Por: {file.uploaderName || file.uploadedByName}</span>
                                        </>
                                      )}
                                      {file.conversationId && (
                                        <span className="text-primary font-semibold">(Vindo do Chat)</span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                  <SystemTooltip content="Visualizar arquivo em tamanho grande">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPreviewFile(file);
                                        setIsPreviewOpen(true);
                                      }}
                                      className="h-8 px-2.5 rounded-lg border border-border bg-muted/30 text-xs font-semibold text-foreground hover:bg-muted hover:border-primary/40 transition-colors flex items-center gap-1.5 cursor-pointer"
                                    >
                                      <Eye className="h-3.5 w-3.5 text-primary" />
                                      <span>Visualizar</span>
                                    </button>
                                  </SystemTooltip>

                                  <SystemTooltip content="Baixar para seu computador">
                                    <a
                                      href={downloadUrl}
                                      download={file.fileName}
                                      className="h-8 px-2.5 rounded-lg border border-border bg-muted/30 text-xs font-semibold text-foreground hover:bg-muted transition-colors flex items-center gap-1.5 cursor-pointer"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                      <span className="hidden sm:inline">Baixar</span>
                                    </a>
                                  </SystemTooltip>

                                  <SystemTooltip content="Excluir arquivo permanentemente">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteFile(file.id)}
                                      className="h-8 w-8 rounded-lg border border-border hover:bg-rose-500/10 text-muted-foreground hover:text-rose-600 flex items-center justify-center transition-colors cursor-pointer"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </SystemTooltip>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center p-8 rounded-xl border border-border/60 bg-muted/10 text-center">
                          <Paperclip className="h-8 w-8 text-muted-foreground/40 mb-2" />
                          <p className="text-xs font-semibold text-muted-foreground">
                            Nenhum arquivo ou documento anexado a este negócio ainda.
                          </p>
                          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                            Arraste arquivos para o quadro acima ou clique para selecionar.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ABA 7: QUESTIONÁRIOS E BRIEFINGS */}
                {activeTab === "questionnaires" && (
                  <div className="space-y-6 animate-in fade-in-50 duration-200 slide-in-from-bottom-1">
                    {/* Formulário de Qualificação Técnica */}
                    <form onSubmit={handleSaveQuestionnaire} className="rounded-xl border border-border bg-card p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <ClipboardCheck className="h-4 w-4 text-primary" />
                          Preencher Questionário de Qualificação & Briefing
                        </span>
                        <span className="text-[10px] text-primary font-bold">
                          Versão {(deal?.questionnaires?.length || 0) + 1}.0
                        </span>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div>
                          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                            Título do Formulário
                          </label>
                          <input
                            type="text"
                            value={questTitle}
                            onChange={(e) => setQuestTitle(e.target.value)}
                            className="h-8 w-full rounded-lg border border-border bg-muted/20 px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                              Volume mensal estimado de demanda
                            </label>
                            <input
                              type="text"
                              placeholder="Ex: 50.000 unidades / mês..."
                              value={questVolume}
                              onChange={(e) => setQuestVolume(e.target.value)}
                              className="h-8 w-full rounded-lg border border-border bg-muted/20 px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                              Aplicação técnica do produto
                            </label>
                            <input
                              type="text"
                              placeholder="Ex: Perfumaria / Cosméticos / Linha Farmacêutica..."
                              value={questApplication}
                              onChange={(e) => setQuestApplication(e.target.value)}
                              className="h-8 w-full rounded-lg border border-border bg-muted/20 px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                              Cliente já testou amostras físicas?
                            </label>
                            <Select value={questHasSample} onValueChange={setQuestHasSample}>
                              <SelectTrigger className="h-8 w-full rounded-lg border border-border bg-muted/20 px-2.5 text-xs text-foreground focus:ring-1 focus:ring-primary">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Sim - Aprovado" className="text-xs">Sim - Amostra aprovada tecnicamente</SelectItem>
                                <SelectItem value="Sim - Em teste" className="text-xs">Sim - Em teste de compatibilidade</SelectItem>
                                <SelectItem value="Não - Requer envio" className="text-xs">Não - Precisa enviar amostras</SelectItem>
                                <SelectItem value="Não se aplica" className="text-xs">Não se aplica</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                              Previsão de Fechamento Comercial
                            </label>
                            <input
                              type="text"
                              placeholder="Ex: Esta semana / Próximo mês..."
                              value={questForecast}
                              onChange={(e) => setQuestForecast(e.target.value)}
                              className="h-8 w-full rounded-lg border border-border bg-muted/20 px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end pt-1">
                          <button
                            type="submit"
                            disabled={savingQuest}
                            className="h-8 px-4 rounded-lg bg-primary text-xs font-bold text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            {savingQuest ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            <span>Salvar Respostas do Questionário</span>
                          </button>
                        </div>
                      </div>
                    </form>

                    {/* Histórico de Questionários */}
                    <div className="space-y-3">
                      <span className="text-xs font-bold text-foreground block">
                        Questionários Preenchidos ({deal?.questionnaires?.length || 0})
                      </span>

                      {deal?.questionnaires && deal.questionnaires.length > 0 ? (
                        <div className="space-y-3">
                          {deal.questionnaires.map((q: any) => (
                            <div
                              key={q.id}
                              className="rounded-xl border border-border bg-card p-4 space-y-2 hover:border-primary/40 transition-colors"
                            >
                              <div className="flex items-center justify-between text-xs font-bold text-foreground border-b border-border/60 pb-2">
                                <span className="flex items-center gap-2">
                                  <ClipboardCheck className="h-4 w-4 text-primary" />
                                  {q.formTitle} (v{q.version})
                                </span>
                                <span className="text-[10px] text-muted-foreground font-normal">
                                  {new Date(q.createdAt).toLocaleDateString("pt-BR")} às{" "}
                                  {new Date(q.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                                  {q.filledByName && ` • Por: ${q.filledByName}`}
                                </span>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                                {Array.isArray(q.answers) &&
                                  q.answers.map((ans: any, idx: number) => (
                                    <div key={idx} className="rounded-lg bg-muted/20 p-2 space-y-0.5">
                                      <span className="text-[10px] font-bold text-muted-foreground block">
                                        {ans.question}
                                      </span>
                                      <span className="text-foreground font-semibold">{String(ans.answer)}</span>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground/60 italic">
                          Nenhum questionário respondido para este negócio ainda.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* ABA 8: E-MAILS COMERCIAIS */}
                {activeTab === "emails" && deal && (
                  <DealEmailTab dealId={deal.id} onSent={loadDealDetail} />
                )}

                {/* ABA 5: HISTÓRICO UNIFICADO */}
                {activeTab === "history" && (
                  <div className="space-y-4 animate-in fade-in-50 duration-200 slide-in-from-bottom-1">
                    {/* Barra de Filtros e Ação Criar Anotação (Alinhada como nas Fotos 3 e 4) */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
                      <div className="flex items-center gap-4 flex-wrap">
                        {/* Filtro "Do" */}
                        <div className="flex items-center gap-1.5">
                          <label htmlFor="crm-history-source-filter" className="text-xs font-bold text-foreground">
                            Do
                          </label>
                          <Select
                            value={historySourceFilter}
                            onValueChange={(val) => setHistorySourceFilter(val as typeof historySourceFilter)}
                          >
                            <SelectTrigger id="crm-history-source-filter" className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground min-w-[130px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all" className="text-xs font-medium">Todos</SelectItem>
                              <SelectItem value="conversas" className="text-xs font-medium">Conversas</SelectItem>
                              <SelectItem value="crm" className="text-xs font-medium">CRM</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Filtro "Exibir" */}
                        <div className="flex items-center gap-1.5">
                          <label htmlFor="crm-history-filter" className="text-xs font-bold text-foreground">
                            Exibir
                          </label>
                          <Select
                            value={historyFilter}
                            onValueChange={(val) => setHistoryFilter(val as typeof historyFilter)}
                          >
                            <SelectTrigger id="crm-history-filter" className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground min-w-[160px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all" className="text-xs font-medium">Todos os eventos</SelectItem>
                              <SelectItem value="activity" className="text-xs font-medium">Atividades & Notas</SelectItem>
                              <SelectItem value="event" className="text-xs font-medium">Alterações</SelectItem>
                              <SelectItem value="proposal" className="text-xs font-medium">Propostas</SelectItem>
                              <SelectItem value="evidence" className="text-xs font-medium">Evidências</SelectItem>
                              <SelectItem value="file" className="text-xs font-medium">Arquivos</SelectItem>
                              <SelectItem value="email" className="text-xs font-medium">E-mails</SelectItem>
                              <SelectItem value="questionnaire" className="text-xs font-medium">Questionários</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Botão "+ Criar anotação" */}
                      <button
                        type="button"
                        onClick={() => setIsCreatingNote(!isCreatingNote)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary/10 px-3.5 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer whitespace-nowrap shadow-2xs"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Criar anotação</span>
                      </button>
                    </div>

                    {/* Campo Animado para Criar e Salvar Anotação (Conforme Foto 3) */}
                    <AnimatePresence>
                      {isCreatingNote && (
                        <motion.div
                          initial={{ opacity: 0, height: 0, y: -8 }}
                          animate={{ opacity: 1, height: "auto", y: 0 }}
                          exit={{ opacity: 0, height: 0, y: -8 }}
                          transition={{ duration: 0.22, ease: "easeInOut" }}
                          className="overflow-hidden rounded-sm border border-border bg-card p-4 space-y-3 shadow-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-foreground">Anotação</span>
                          </div>

                          {/* Toolbar de Formatação */}
                          <div className="flex items-center gap-1 border-b border-border/60 pb-2">
                            <button
                              type="button"
                              onClick={() => handleFormatNote("bold")}
                              title="Negrito"
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            >
                              <Bold className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFormatNote("italic")}
                              title="Itálico"
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            >
                              <Italic className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFormatNote("bullet")}
                              title="Lista com marcadores"
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            >
                              <List className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFormatNote("numbered")}
                              title="Lista numerada"
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            >
                              <ListOrdered className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFormatNote("link")}
                              title="Inserir link"
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {/* Área de Texto da Anotação com Auto-expansão Vertical */}
                          <textarea
                            ref={noteTextareaRef}
                            rows={3}
                            value={inlineNoteText}
                            onChange={(e) => {
                              setInlineNoteText(e.target.value);
                              adjustNoteTextareaHeight();
                            }}
                            placeholder="Digite aqui os detalhes da anotação..."
                            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 resize-none overflow-hidden outline-none min-h-[90px] leading-relaxed transition-all"
                            autoFocus
                          />

                          {/* Rodapé: Cancelar e Salvar no histórico */}
                          <div className="flex items-center justify-between pt-2 border-t border-border/40">
                            <button
                              type="button"
                              onClick={() => {
                                setIsCreatingNote(false);
                                setInlineNoteText("");
                              }}
                              className="text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              disabled={isSavingNote || !inlineNoteText.trim()}
                              onClick={handleSaveInlineNote}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
                            >
                              {isSavingNote && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                              <span>Salvar no histórico</span>
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {filteredTimeline.length > 0 ? (
                      <div className="crm-deal-timeline relative pl-7 border-l-2 border-border/70 space-y-3.5 pt-2 pb-6 w-full pr-4">
                        {filteredTimeline.map((item: any) => {
                          const isLeadOrImportant = item.category === "event" && item.title.includes("criou");
                          const bulletColor = item.isNote
                            ? "border-primary bg-primary"
                            : item.category === "evidence"
                            ? "border-purple-500 bg-purple-500"
                            : item.category === "proposal"
                            ? "border-emerald-500 bg-emerald-500"
                            : isLeadOrImportant
                            ? "border-purple-600 bg-purple-600"
                            : "border-muted-foreground/40 bg-muted-foreground/40";

                          const authorInitials = (() => {
                            if (!item.author) return "CRM";
                            const parts = item.author.trim().split(/\s+/);
                            if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
                            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                          })();

                          return (
                            <div key={item.id} className="relative group">
                              {/* Marcador na linha do tempo com bullet colorido e anel elegante */}
                              <div className="absolute -left-[37px] top-3.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-card border-2 border-border shadow-xs z-10">
                                <div className={`h-2 w-2 rounded-full ${bulletColor}`} />
                              </div>

                              <div className="crm-timeline-item rounded-sm border border-border/80 bg-card/85 backdrop-blur-xs p-4 shadow-xs hover:border-primary/40 hover:bg-card transition-all">
                                {/* Cabeçalho do Card */}
                                <div className="flex items-center justify-between gap-3 text-xs">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    {/* Foto do operador ou iniciais */}
                                    {item.authorAvatar ? (
                                      <img
                                        src={item.authorAvatar}
                                        alt={item.author}
                                        className="h-7 w-7 shrink-0 rounded-full object-cover border border-border"
                                      />
                                    ) : (
                                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-bold text-[10px] ${
                                        item.isNote
                                          ? "bg-primary/10 text-primary border border-primary/20"
                                          : "bg-muted text-muted-foreground border border-border"
                                      }`}>
                                        {authorInitials}
                                      </div>
                                    )}

                                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                                      <span className="font-bold text-foreground text-xs">
                                        {item.author}
                                      </span>
                                      <span className="text-muted-foreground text-xs">
                                        {item.isNote
                                          ? "adicionou uma anotação:"
                                          : item.category === "activity"
                                          ? "criou a tarefa:"
                                          : item.title}
                                      </span>
                                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide uppercase ${item.badgeColor}`}>
                                        {item.category === "event"
                                          ? "Auditoria"
                                          : item.category === "activity"
                                          ? item.isNote
                                            ? "Anotação"
                                            : "Tarefa"
                                          : item.category === "proposal"
                                          ? "Proposta"
                                          : item.category === "evidence"
                                          ? "Evidência"
                                          : item.category === "file"
                                          ? "Arquivo"
                                          : item.category === "email"
                                          ? "E-mail"
                                          : item.category === "questionnaire"
                                          ? "Questionário"
                                          : "Atividade"}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Data / Hora alinhada */}
                                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80 font-medium shrink-0">
                                    <Clock className="h-3 w-3 opacity-60" />
                                    <span>
                                      {item.date.toLocaleDateString("pt-BR", {
                                        day: "2-digit",
                                        month: "2-digit",
                                        year: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </span>
                                  </div>
                                </div>

                                {/* Corpo do balão / Descrição */}
                                {item.description && (
                                  item.isNote ? (
                                    <div className="mt-3 rounded-sm border border-primary/20 bg-primary/[0.03] p-3.5 text-xs text-foreground leading-relaxed font-normal break-words shadow-2xs">
                                      {renderMarkdownContent(item.description)}
                                    </div>
                                  ) : (
                                    <p className="mt-2 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap pl-9 break-words">
                                      {item.description}
                                    </p>
                                  )
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-center py-10 text-xs text-muted-foreground/60 italic">
                        Nenhum registro histórico acumulado para este card ainda.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {deal?.accountId && (
        <AccountDetailModal
          accountId={deal.accountId}
          isOpen={isAccountDetailOpen}
          onClose={() => setIsAccountDetailOpen(false)}
          onAccountUpdated={() => loadDealDetail()}
          onOpenChat={(convId) => {
            setIsAccountDetailOpen(false);
            onOpenConversation(convId);
          }}
        />
      )}

      {/* Visualizador Universal de Arquivos e Documentos */}
      <DealFilePreviewModal
        file={previewFile}
        isOpen={isPreviewOpen}
        onClose={() => {
          setIsPreviewOpen(false);
          setPreviewFile(null);
        }}
        onDelete={handleDeleteFile}
      />

      {/* Modal Criar Tarefa Idêntico ao RD Station */}
      <CreateTaskModal
        isOpen={isCreateTaskModalOpen}
        onClose={() => setIsCreateTaskModalOpen(false)}
        dealId={deal?.id}
        dealTitle={deal?.title}
        accountId={deal?.accountId || deal?.account?.id}
        accountName={deal?.account?.name}
        operators={Array.from(operatorsMap.entries()).map(([id, name]) => ({ id, name }))}
        onTaskCreated={() => {
          loadDealDetail();
        }}
      />

      {/* Drawer Lateral de Adicionar/Vincular Contato ao Negócio */}
      {deal && (
        <DealAddContactDrawer
          isOpen={isAddContactDrawerOpen}
          onClose={() => setIsAddContactDrawerOpen(false)}
          dealId={deal.id}
          accountId={deal.accountId}
          onContactLinked={() => loadDealDetail()}
        />
      )}
    </div>
  );
}
