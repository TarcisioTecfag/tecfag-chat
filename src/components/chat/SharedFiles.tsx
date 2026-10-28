import { AttendanceEvents } from "./AttendanceEvents";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, SystemTooltip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import React, { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { fetchCnpjInfo, CnpjFullDetails, validateCnpj } from "@/lib/valentina/cnpj-service";
import {
  extractCnpjDetailsFromAccount,
  buildAccountUpdatePayloadFromCnpjDetails,
  buildAccountAddressFromCnpjDetails,
} from "@/lib/crm/cnpj-account-mapper";
import { useChat } from "@/hooks/useChatState";
import { RdCrmCard } from "./RdCrmCard";
import { ConversationDealsPanel } from "@/components/crm/ConversationDealsPanel";
import { useConversationDealContext } from "@/components/crm/ConversationDealContext";
import { AccountPicker } from "@/components/crm/AccountPicker";
import type { CrmAccountDTO } from "@/lib/crm/crm-types";
import { WhatsappLogo, InstagramLogo, MessengerLogo, SiteLogo } from "./ChatList";
import { CustomerJourneyModal } from "./CustomerJourneyModal";
import { formatPhoneNumber, formatCPF, formatCNPJ, maskCPF, maskCNPJ } from "@/lib/utils";
import { formatSystemAnnotation } from "@/lib/triage/format-system-annotation";
import { motion } from "framer-motion";
import { usePermissions } from "@/hooks/usePermissions";
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
  ChevronLeft,
  ChevronRight,
  Pencil,
  CheckCircle2,
  XCircle,
  PhoneCall,
  Save,
  Search,
  Check,
  CalendarDays,
  Clock,
  ListTodo,
  PhoneIncoming,
  Users,
  AtSign,
  UtensilsCrossed,
  CheckSquare,
  ChevronDown,
  Database,
  Paperclip,
  MousePointerClick,
  ExternalLink,
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
    setSelectedChatId,
  } = useChat();

  const { canEditClientInfo, canManageTags, canManageRdCrm, canChangeWalletOperator } = usePermissions();

  const [activeTab, setActiveTab] = useState<"details" | "files" | "events">("details");
  const [showJourneyModal, setShowJourneyModal] = useState(false);
  const [contactSiteVisitorId, setContactSiteVisitorId] = useState<string | null>(null);
  const [newTag, setNewTag] = useState(""); // mantido internamente para compatibilidade com updateTags

  // ── Estados do formulário de Tarefas ─────────────────────────────────────
  const [taskSubject, setTaskSubject] = useState("");
  const [taskType, setTaskType] = useState("task");

  // Helpers para cálculo rápido de data no formato YYYY-MM-DD
  const formatYMD = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const getRelativeDateYMD = (daysOffset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    return formatYMD(d);
  };

  const [taskDueDate, setTaskDueDate] = useState<string>(() => getRelativeDateYMD(1));
  const [taskDueTime, setTaskDueTime] = useState<string>("09:00");
  const taskDate = taskDueDate;
  const taskTime = taskDueTime;
  const [taskCreating, setTaskCreating] = useState(false);
  const [taskTypeOpen, setTaskTypeOpen] = useState(false);

  // Estados e controle do Calendário e Horário Customizados (Design System sem corte de ano)
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isTimeOpen, setIsTimeOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<number>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.getMonth();
  });
  const [calendarYear, setCalendarYear] = useState<number>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.getFullYear();
  });

  useEffect(() => {
    if (taskDueDate) {
      const [y, m] = taskDueDate.split("-");
      if (y && m) {
        setCalendarYear(parseInt(y, 10));
        setCalendarMonth(parseInt(m, 10) - 1);
      }
    }
  }, [taskDueDate]);

  const formattedDateBR = useMemo(() => {
    if (!taskDueDate) return "Selecione data";
    const [y, m, d] = taskDueDate.split("-");
    if (y && m && d) return `${d}/${m}/${y}`;
    return taskDueDate;
  }, [taskDueDate]);

  const [currentHour, currentMin] = (taskDueTime || "09:00").split(":");
  const selectedHour = currentHour || "09";
  const selectedMin = currentMin || "00";

  const prevMonth = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear((y) => y - 1);
    } else {
      setCalendarMonth((m) => m - 1);
    }
  };

  const nextMonth = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear((y) => y + 1);
    } else {
      setCalendarMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (day: number, monthOffset: number = 0) => {
    let targetMonth = calendarMonth + monthOffset;
    let targetYear = calendarYear;

    if (targetMonth < 0) {
      targetMonth = 11;
      targetYear -= 1;
    } else if (targetMonth > 11) {
      targetMonth = 0;
      targetYear += 1;
    }

    const yStr = String(targetYear);
    const mStr = String(targetMonth + 1).padStart(2, "0");
    const dStr = String(day).padStart(2, "0");
    setTaskDueDate(`${yStr}-${mStr}-${dStr}`);
    setIsCalendarOpen(false);
  };

  const MONTH_NAMES_PT = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const WEEKDAY_NAMES_PT = ["D", "S", "T", "Q", "Q", "S", "S"];
  const HOURS_LIST = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const MINUTES_LIST = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

  const renderCalendarDays = () => {
    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInCurrentMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calendarYear, calendarMonth, 0).getDate();

    const cells: React.ReactNode[] = [];

    // Dias do mês anterior
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      cells.push(
        <button
          key={`prev-${dayNum}`}
          type="button"
          onClick={() => handleSelectDay(dayNum, -1)}
          className="h-7 w-7 text-[11px] text-muted-foreground/35 hover:bg-muted/40 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          {dayNum}
        </button>
      );
    }

    // Dias do mês atual
    for (let day = 1; day <= daysInCurrentMonth; day++) {
      const dayYMD = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const isSelected = taskDueDate === dayYMD;
      const formattedDayTooltip = `${String(day).padStart(2, "0")}/${String(calendarMonth + 1).padStart(2, "0")}/${calendarYear}`;

      cells.push(
        <SystemTooltip key={`cur-${day}`} content={formattedDayTooltip}>
          <button
            type="button"
            onClick={() => handleSelectDay(day, 0)}
            className={`h-7 w-7 text-xs font-semibold rounded-lg flex items-center justify-center transition-all cursor-pointer ${
              isSelected
                ? "bg-primary text-primary-foreground font-bold shadow-xs hover:bg-primary/90"
                : "text-foreground hover:bg-muted hover:text-primary"
            }`}
          >
            {day}
          </button>
        </SystemTooltip>
      );
    }

    // Dias do próximo mês
    const totalFilled = cells.length;
    const remaining = (7 - (totalFilled % 7)) % 7;
    for (let day = 1; day <= remaining; day++) {
      cells.push(
        <button
          key={`next-${day}`}
          type="button"
          onClick={() => handleSelectDay(day, 1)}
          className="h-7 w-7 text-[11px] text-muted-foreground/35 hover:bg-muted/40 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          {day}
        </button>
      );
    }

    return cells;
  };

  const taskDealContext = useConversationDealContext(activeChat?.id);

  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [linkedAccount, setLinkedAccount] = useState<CrmAccountDTO | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<CrmAccountDTO | null>(null);
  const [savingInfo, setSavingInfo] = useState(false);
  useTrainingSurface("chat.details-panel", (step) => {
    if (!activeChat) return false;
    setActiveTab(step.id === "chat.shared-files" ? "files" : step.id === "chat.events" ? "events" : "details");
    setIsEditingInfo(step.id === "chat.contact-edit");
    setShowJourneyModal(step.surface === "chat.journey-modal");
    return true;
  });
  useTrainingSurface("chat.journey-modal", (step) => { setShowJourneyModal(true); return Boolean(activeChat); });

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [editForm, setEditForm] = React.useState({
    name: "",
    phone: "",
    email: "",
  });

  const [cnpjDetails, setCnpjDetails] = useState<CnpjFullDetails>({});
  const [isSearchingCnpj, setIsSearchingCnpj] = useState(false);
  const [isSavingCnpj, setIsSavingCnpj] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"saved" | "saving" | "idle">("idle");
  const isFirstCnpjRender = React.useRef(true);

  useEffect(() => {
    const contactId = activeChat?.contactId;
    setLinkedAccount(null);
    setSelectedAccount(null);
    setContactSiteVisitorId(null);
    setIsEditingInfo(false);
    isFirstCnpjRender.current = true;
    setCnpjDetails({});
    setAutoSaveStatus("idle");
    if (!contactId) return;
    const controller = new AbortController();
    fetch(`/api/contacts/${encodeURIComponent(contactId)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((contact) => {
        if (!controller.signal.aborted) {
          const acc: CrmAccountDTO | null = contact?.account || null;
          setLinkedAccount(acc);
          setSelectedAccount(acc);
          const cf = contact?.customFields && typeof contact.customFields === "object" ? contact.customFields : {};
          const svId =
            typeof cf.siteVisitorId === "string" && cf.siteVisitorId.trim()
              ? cf.siteVisitorId.trim()
              : typeof contact?.id === "string" && contact.id.startsWith("cont-lc-")
                ? contact.id.slice("cont-lc-".length)
                : null;
          setContactSiteVisitorId(svId);
          isFirstCnpjRender.current = true;
          setCnpjDetails(
            extractCnpjDetailsFromAccount(
              acc,
              contact?.cnpjDetails || (activeChat as any)?.cnpjDetails || null,
            ),
          );
          setAutoSaveStatus("idle");
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [activeChat?.contactId]);

  const persistCnpjDetailsToLinkedAccount = React.useCallback(
    async (detailsToSave: CnpjFullDetails): Promise<CrmAccountDTO | null> => {
      if (!activeChat) return null;
      const contactId = activeChat.contactId || activeChat.id;
      let targetAccount = linkedAccount;

      // Caso 1: Contato já possui empresa vinculada -> atualiza diretamente essa empresa em crm_accounts
      if (targetAccount?.id) {
        const accountPatch = buildAccountUpdatePayloadFromCnpjDetails(detailsToSave, targetAccount);
        const res = await fetch(`${BACKEND_URL}/api/crm/accounts/${encodeURIComponent(targetAccount.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(accountPatch),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Não foi possível salvar os dados na empresa vinculada.");
        }
        const data = await res.json();
        const updatedAcc: CrmAccountDTO = data.account || { ...targetAccount, ...accountPatch };
        setLinkedAccount(updatedAcc);
        setSelectedAccount(updatedAcc);

        // Mantém sincronia secundária no contato para leitores legados
        fetch(`${BACKEND_URL}/api/contacts/${encodeURIComponent(contactId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Attendance-Conversation": activeChat.id },
          body: JSON.stringify({
            cnpjDetails: detailsToSave,
            ...(detailsToSave.cleanCnpj ? { cnpj: detailsToSave.cleanCnpj } : {}),
          }),
        }).catch(() => {});

        (activeChat as any).cnpjDetails = detailsToSave;
        return updatedAcc;
      }

      // Caso 2: Contato ainda não possui empresa vinculada, mas foi informado um CNPJ válido
      const cleanDoc = (detailsToSave.cleanCnpj || detailsToSave.cnpjFormatted || "").replace(/\D/g, "");
      if (cleanDoc.length === 14 && validateCnpj(cleanDoc)) {
        // Verifica se já existe empresa com esse CNPJ no tenant
        const lookupRes = await fetch(
          `${BACKEND_URL}/api/contacts/account-options?search=${encodeURIComponent(cleanDoc)}`,
        );
        const lookupData = lookupRes.ok ? await lookupRes.json().catch(() => ({ accounts: [] })) : { accounts: [] };
        const existingAcc: CrmAccountDTO | undefined = (lookupData.accounts || []).find(
          (a: CrmAccountDTO) => (a.document || "").replace(/\D/g, "") === cleanDoc,
        );

        if (existingAcc) {
          const accountPatch = buildAccountUpdatePayloadFromCnpjDetails(detailsToSave, existingAcc);
          const patchRes = await fetch(`${BACKEND_URL}/api/crm/accounts/${encodeURIComponent(existingAcc.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(accountPatch),
          });
          if (patchRes.ok) {
            const patchedData = await patchRes.json();
            targetAccount = patchedData.account || { ...existingAcc, ...accountPatch };
          } else {
            targetAccount = existingAcc;
          }
        } else {
          const companyName = (
            detailsToSave.razaoSocial ||
            detailsToSave.nomeFantasia ||
            activeChat.name ||
            `Empresa ${cleanDoc}`
          ).trim();
          const createPayload = {
            type: "company" as const,
            name: companyName,
            tradeName: detailsToSave.nomeFantasia?.trim() || null,
            document: cleanDoc,
            phone: detailsToSave.telefone ? detailsToSave.telefone.replace(/\D/g, "") || null : null,
            email: detailsToSave.email?.trim().toLowerCase() || null,
            address: buildAccountAddressFromCnpjDetails(detailsToSave),
          };
          const createRes = await fetch(`${BACKEND_URL}/api/crm/accounts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(createPayload),
          });
          if (!createRes.ok) {
            const errData = await createRes.json().catch(() => ({}));
            throw new Error(errData.error || "Não foi possível criar a empresa com os dados da Receita.");
          }
          const createdData = await createRes.json();
          targetAccount = createdData.account || null;
        }

        if (targetAccount?.id) {
          await fetch(`${BACKEND_URL}/api/contacts/${encodeURIComponent(contactId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-Attendance-Conversation": activeChat.id },
            body: JSON.stringify({
              accountId: targetAccount.id,
              accountChangeReason: "Empresa vinculada automaticamente via consulta na Receita Federal",
              cnpjDetails: detailsToSave,
              cnpj: cleanDoc,
            }),
          });
          setLinkedAccount(targetAccount);
          setSelectedAccount(targetAccount);
          (activeChat as any).cnpjDetails = detailsToSave;
          return targetAccount;
        }
      }

      return null;
    },
    [activeChat, linkedAccount],
  );

  const handleSaveCnpjDetails = async () => {
    if (!activeChat) return;
    if (!linkedAccount && !(cnpjDetails.cleanCnpj || cnpjDetails.cnpjFormatted)) {
      toast.error("Vincule uma empresa ao contato ou informe um CNPJ válido antes de salvar.");
      return;
    }
    setIsSavingCnpj(true);
    try {
      await persistCnpjDetailsToLinkedAccount(cnpjDetails);
      setAutoSaveStatus("saved");
      toast.success("Dados da Receita salvos na empresa vinculada!");
    } catch (e: any) {
      console.error("Erro ao salvar detalhes do CNPJ na empresa:", e);
      toast.error(e?.message || "Erro ao salvar dados da Receita na empresa.");
    } finally {
      setIsSavingCnpj(false);
    }
  };

  // Auto-Save silencioso na empresa vinculada: salva sozinho no banco 600ms após digitar
  useEffect(() => {
    if (isFirstCnpjRender.current) {
      isFirstCnpjRender.current = false;
      return;
    }
    if (!activeChat) return;
    if (!linkedAccount?.id) return;

    setAutoSaveStatus("saving");
    const timer = setTimeout(async () => {
      try {
        await persistCnpjDetailsToLinkedAccount(cnpjDetails);
        setAutoSaveStatus("saved");
      } catch (err) {
        console.error("Erro no auto-save de cnpjDetails na empresa vinculada:", err);
        setAutoSaveStatus("idle");
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [cnpjDetails]);

  const handleQueryCnpjLive = async () => {
    const cnpjToQuery = (
      cnpjDetails.cnpjFormatted ||
      cnpjDetails.cleanCnpj ||
      linkedAccount?.document ||
      ""
    ).trim();
    if (!cnpjToQuery) {
      toast.error(
        linkedAccount
          ? `A empresa vinculada (${linkedAccount.name}) não possui CNPJ cadastrado. Informe o CNPJ abaixo para consultar.`
          : "Vincule uma empresa ao contato ou informe um CNPJ válido para consultar na Receita Federal.",
      );
      return;
    }
    setIsSearchingCnpj(true);
    setAutoSaveStatus("saving");
    try {
      const res = await fetchCnpjInfo(cnpjToQuery);
      if (!res.valid) {
        setAutoSaveStatus("idle");
        toast.error(res.erro || "CNPJ inválido nos dígitos verificadores.");
      } else if (res.details) {
        isFirstCnpjRender.current = true;
        setCnpjDetails(res.details);
        const savedAcc = await persistCnpjDetailsToLinkedAccount(res.details);
        setAutoSaveStatus("saved");
        toast.success(
          savedAcc
            ? `Dados da Receita Federal salvos na empresa "${savedAcc.name}"!`
            : "Ficha Cadastral da Receita Federal carregada!",
        );
      } else {
        setAutoSaveStatus("idle");
        toast.error("Não foi possível retornar dados para este CNPJ.");
      }
    } catch (err: any) {
      setAutoSaveStatus("idle");
      toast.error(err?.message || "Erro ao consultar Receita Federal.");
    } finally {
      setIsSearchingCnpj(false);
    }
  };

  if (!activeChat) {
    return (
      <aside className="flex h-full w-full flex-col rounded-3xl bg-card px-5 py-6 shadow-soft border border-border text-center justify-center text-muted-foreground select-none">
        <User className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-xs">Selecione uma conversa para ver os detalhes do cliente.</p>
      </aside>
    );
  }

  // ── Criar Tarefa (nova versão com campos completos) ──────────────────────
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskSubject.trim()) return;

    if (!taskDealContext.data?.hasCurrentDeal) {
      toast.error("Selecione a negociação deste atendimento antes de criar a tarefa.");
      return;
    }

    setTaskCreating(true);
    const label = taskSubject.trim();

    try {
      const response = await fetch(`/api/chats/tag-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeChat.id,
          tagName: label,
          expectedContextVersion: taskDealContext.data.version,
          taskType,
          dueDate: taskDate,
          dueTime: taskTime,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível criar a tarefa.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a tarefa.");
      setTaskCreating(false);
      void taskDealContext.refresh();
      return;
    }
    if (!activeChat.tags.includes(label)) updateTags(activeChat.id, [...activeChat.tags, label]);
    window.dispatchEvent(new Event("crm-deals-changed"));

    // Reset form
    setTaskSubject("");
    setTaskType("task");
    setTaskDueDate(getRelativeDateYMD(1));
    setTaskDueTime("09:00");
    setTaskCreating(false);
    toast.success("Tarefa criada com sucesso!");
  };

  // Mantido para remover task/tag individualmente
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
    });
    setSelectedAccount(linkedAccount);
    setIsEditingInfo(true);
  };

  const handleSaveInfo = async () => {
    setSavingInfo(true);
    try {
      await updateClientInfo(activeChat.id, { ...editForm, accountId: selectedAccount?.id || null });
      let hydratedAccount = selectedAccount;
      if (selectedAccount?.id && selectedAccount.address === undefined) {
        const accRes = await fetch(`/api/contacts/account-options?id=${encodeURIComponent(selectedAccount.id)}`).catch(() => null);
        if (accRes?.ok) {
          const accData = await accRes.json().catch(() => null);
          if (accData?.account) hydratedAccount = accData.account;
        }
      }
      setLinkedAccount(hydratedAccount);
      setSelectedAccount(hydratedAccount);
      isFirstCnpjRender.current = true;
      setCnpjDetails(
        extractCnpjDetailsFromAccount(hydratedAccount, (activeChat as any)?.cnpjDetails || null),
      );
      setAutoSaveStatus("idle");
      setIsEditingInfo(false);
      toast.success("Contato atualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o contato.");
    } finally {
      setSavingInfo(false);
    }
  };

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  // Scan all messages of this client/chat to extract media files and links
  const parsedMediaFiles = activeChat.messages
    .flatMap((m) => {
      const results: Array<{
        id: string;
        messageId: string;
        type: string;
        name: string;
        time: string;
        author: string;
        url: string;
      }> = [];

      // Extrai mídias Baileys/Meta [MEDIA:type]messageId:filename
      const baileysMatch = m.text.match(
        /\[MEDIA:(image|video|audio|document|sticker)\]([^:\n]+)(?::([^\n]+))?/,
      );
      if (baileysMatch) {
        const [, type, messageId, extra] = baileysMatch;
        let displayName = "Arquivo";
        if (type === "image") displayName = "Imagem";
        else if (type === "sticker") displayName = "Figurinha";
        else if (type === "video") displayName = "Vídeo";
        else if (type === "audio") displayName = "Mensagem de voz";
        else if (type === "document") displayName = extra || "Documento";

        results.push({
          id: `${m.id}-baileys`,
          messageId,
          type,
          name: displayName,
          time: m.time,
          author: m.author,
          url: `${BACKEND_URL}/api/baileys/media?messageId=${messageId}`,
        });
      }

      // Extrai mídias locais [LOCAL_MEDIA:type:url:filename]
      const localMatches = Array.from(m.text.matchAll(/\[LOCAL_MEDIA:([^:]+):(.+?):([^\]\n]+)\]/g));
      for (const localMatch of localMatches) {
        const [, type, fileUrl, fileName] = localMatch;
        let displayName = fileName || "Arquivo";
        if (type === "image" && (!fileName || fileName === "image.png")) displayName = "Imagem";
        else if (type === "sticker") displayName = "Figurinha";
        else if (type === "video") displayName = "Vídeo";
        else if (type === "audio") displayName = "Áudio";

        results.push({
          id: `${m.id}-local-${results.length}`,
          messageId: m.id,
          type,
          name: displayName,
          time: m.time,
          author: m.author,
          url: fileUrl,
        });
      }

      return results;
    });

  // Extract shared URLs/Links (excluindo tags de mídia e arquivos locais/internos)
  const linkRegex = /(?:https?:\/\/|www\.)[^\s<>"'()]+|\b[a-zA-Z0-9][-a-zA-Z0-9]*\.(?:com\.br|ind\.br|eco\.br|net\.br|org\.br|gov\.br|edu\.br|com|net|org|io|dev|app|ai|me|cc|co|info|biz)\b(?:\/[^\s<>"'()]*)?/gi;

  const parsedLinks = activeChat.messages.flatMap((m) => {
    // Remove tags de mídia antes de buscar links
    const textWithoutMedia = m.text
      .replace(/\[LOCAL_MEDIA:[^\]]+\]/g, "")
      .replace(/\[MEDIA:[^\]]+\]/g, "")
      .trim();

    if (!textWithoutMedia) return [];

    const matches = textWithoutMedia.match(linkRegex);
    if (!matches) return [];

    return matches
      .map((rawUrl) => {
        const clean = rawUrl.replace(/[.,?!;:)]+$/, "");
        if (clean.includes("/api/baileys/media") || clean.startsWith("blob:")) return null;
        return clean;
      })
      .filter((u): u is string => !!u)
      .map((url, idx) => ({
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
    <aside className="flex h-full w-full flex-col rounded-3xl bg-card px-4.5 py-5 shadow-soft border border-border select-none overflow-hidden">
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
      <div data-tour="details.tabs" className="flex rounded-xl bg-muted p-1 relative">
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
          <span className="flex items-center justify-center gap-1">
            <Database className="h-3 w-3" />
            Dados
          </span>
        </button>
        <button
          data-tour="details.files" onClick={() => handleTabChange("files")}
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
          <span className="flex items-center justify-center gap-1">
            <Paperclip className="h-3 w-3" />
            Arquivos
          </span>
        </button>
        <button
          data-tour="details.events" onClick={() => handleTabChange("events")}
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
          <span className="flex items-center justify-center gap-1">
            <Clock className="h-3 w-3" />
            Eventos
          </span>
        </button>
      </div>


      <div className="my-4 h-px bg-line" />

      {activeTab === "details" ? (
        /* TAB 1: DADOS DO CLIENTE */
        <div className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden pr-1 space-y-5 [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar-thumb]:invisible scrollbar-none">

          {/* Contact Fields */}
          <div data-tour="details.registration" className="space-y-3 bg-muted/40 p-3 rounded-2xl border border-line">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase">
                Informações
              </span>
              {canEditClientInfo && (
                <button
                  data-tour="details.contact-editor" data-training-save="true" onClick={isEditingInfo ? handleSaveInfo : startEditing}
                  disabled={savingInfo}
                  className="text-[10px] font-bold text-primary hover:underline cursor-pointer"
                >
                  {isEditingInfo ? "Salvar" : "Editar"}
                </button>
              )}
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
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-muted-foreground">Empresa / cliente vinculado</label>
                  <AccountPicker value={selectedAccount?.id || null} selectedAccount={selectedAccount} onSelectAccount={setSelectedAccount} lookupUrl="/api/contacts/account-options" placeholder="Buscar empresa por nome ou CNPJ..." />
                  <p className="text-[10px] text-muted-foreground">O CNPJ ou CPF é cadastrado na ficha da empresa ou cliente PF.</p>
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
                <div className="flex items-start gap-2">
                  <Building className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                  <div className="text-xs text-foreground font-medium">
                    {linkedAccount ? linkedAccount.name : "Sem empresa / cliente vinculado"}
                    {linkedAccount?.document && (
                      <div className="text-[10px] text-muted-foreground font-normal">
                        {linkedAccount.type === "company" ? formatCNPJ(linkedAccount.document) : formatCPF(linkedAccount.document)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Contexto & Jornada do Cliente no Site ───────────────────── */}
          {(activeChat.channel === "livechat" ||
            activeChat.hasSiteJourney ||
            Boolean(activeChat.siteVisitorId) ||
            Boolean(contactSiteVisitorId) ||
            Boolean(activeChat.siteContext) ||
            Boolean(activeChat.siteContinuityCode)) && (
            <div data-tour="details.site-context" className="space-y-2.5 rounded-2xl border border-primary/25 bg-primary/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                    <SiteLogo className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <span className="block text-[10px] font-extrabold uppercase tracking-wider text-foreground">
                      Jornada no Site
                    </span>
                    <span className="block text-[9px] text-muted-foreground truncate">
                      {activeChat.channel === "livechat"
                        ? "Atendimento direto pelo Widget do Site"
                        : activeChat.siteContinuityCode
                          ? `Vinculado do Site (Cód. #${activeChat.siteContinuityCode})`
                          : "Visitante identificado no Site"}
                    </span>
                  </div>
                </div>
              </div>

              {activeChat.siteContext && (
                <div className="space-y-1.5 rounded-xl border border-border/60 bg-card/80 p-2.5 text-[11px]">
                  {activeChat.siteContext.inquiredProduct?.name && (
                    <div>
                      <span className="text-[9px] font-bold uppercase text-primary block">
                        Produto Consultado
                      </span>
                      <span className="font-bold text-foreground block truncate">
                        {activeChat.siteContext.inquiredProduct.name}
                      </span>
                      {activeChat.siteContext.inquiredProduct.category && (
                        <span className="text-[10px] text-muted-foreground block truncate">
                          {activeChat.siteContext.inquiredProduct.category}
                        </span>
                      )}
                    </div>
                  )}
                  {(activeChat.siteContext.currentPageTitle || activeChat.siteContext.currentPageUrl) && (
                    <div>
                      <span className="text-[9px] font-bold uppercase text-muted-foreground block">
                        Página no Site
                      </span>
                      <span className="font-semibold text-foreground block truncate">
                        {activeChat.siteContext.currentPageTitle || activeChat.siteContext.currentPageUrl}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowJourneyModal(true)}
                className="w-full h-8 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-[11px] font-bold text-primary-foreground shadow-soft hover:opacity-90 transition cursor-pointer"
              >
                <MousePointerClick className="h-3.5 w-3.5" />
                Ver Jornada Completa e Cliques
              </button>
            </div>
          )}

          {/* ── Tarefas ────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <ListTodo className="h-3.5 w-3.5 text-primary" />
              Tarefas
            </h4>

            {/* Tarefas existentes */}
            <div className="flex flex-wrap gap-1.5">
              {activeChat.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary/8 px-2 py-0.5 text-[10px] font-bold text-primary border border-primary/15"
                >
                  <CheckSquare className="h-2.5 w-2.5 shrink-0" />
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="text-primary/60 hover:text-red-500 cursor-pointer ml-0.5 transition-colors"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              {activeChat.tags.length === 0 && (
                <span className="text-[10px] text-muted-foreground italic">
                  Nenhuma tarefa criada
                </span>
              )}
            </div>

            {/* Formulário de nova tarefa */}
            <form data-tour="details.task-create" onSubmit={handleCreateTask} className="space-y-2">
              {/* Nome da tarefa */}
              <input
                type="text"
                placeholder="Nome da tarefa..."
                value={taskSubject}
                onChange={(e) => setTaskSubject(e.target.value)}
                className="w-full h-8 rounded-lg bg-muted px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-primary/30 transition"
              />

              {/* Tipo da tarefa — dropdown customizado com ícones */}
              {(() => {
                const TASK_TYPES = [
                  { value: "task",    label: "Tarefa",          Icon: CheckSquare    },
                  { value: "call",    label: "Ligação",         Icon: PhoneCall      },
                  { value: "meeting", label: "Reunião",         Icon: Users          },
                  { value: "email",   label: "E-mail",          Icon: AtSign         },
                  { value: "lunch",   label: "Almoço / Visita", Icon: UtensilsCrossed},
                ] as const;
                const selected = TASK_TYPES.find((t) => t.value === taskType) ?? TASK_TYPES[0];
                return (
                  <div className="relative w-full">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setTaskTypeOpen((o) => !o)}
                            className="w-full h-8 flex items-center gap-2 rounded-lg bg-muted px-2.5 text-xs text-foreground border border-transparent hover:border-primary/20 focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all cursor-pointer"
                          >
                            <selected.Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="flex-1 text-left font-medium">{selected.label}</span>
                            <ChevronDown className={`h-3 w-3 text-primary/60 transition-transform duration-200 ${taskTypeOpen ? "rotate-180" : ""}`} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="bg-primary text-white text-[10px] font-semibold">
                          Tipo da atividade no RD CRM
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    {taskTypeOpen && (
                      <div className="absolute z-50 top-[calc(100%+4px)] left-0 right-0 rounded-xl bg-card border border-border/60 shadow-xl overflow-hidden">
                        {TASK_TYPES.map(({ value, label, Icon }) => {
                          const isActive = taskType === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => { setTaskType(value); setTaskTypeOpen(false); }}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-all cursor-pointer outline-none
                                ${isActive
                                  ? "bg-primary/10 text-primary font-semibold"
                                  : "text-foreground hover:bg-muted hover:text-foreground"
                                }`}
                            >
                              <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                              <span className="flex-1 text-left">{label}</span>
                              {isActive && <Check className="h-3 w-3 text-primary shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Seletor Rápido de Data & Horário ───────────────────── */}
              <div className="space-y-2">
                {/* Atalhos Rápidos de Data */}
                <div className="flex items-center gap-1">
                  {[
                    { label: "Hoje", offset: 0 },
                    { label: "Amanhã", offset: 1 },
                    { label: "+2 dias", offset: 2 },
                    { label: "Próx. sem.", offset: 7 },
                  ].map(({ label, offset }) => {
                    const targetYMD = getRelativeDateYMD(offset);
                    const isSelected = taskDueDate === targetYMD;
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setTaskDueDate(targetYMD)}
                        className={`flex-1 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer text-center ${
                          isSelected
                            ? "bg-primary text-primary-foreground shadow-xs"
                            : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground border border-border/40"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Inputs de Data e Hora com Popovers Customizados & Tooltips */}
                <div className="grid grid-cols-2 gap-1.5">
                  {/* Seletor Customizado de Data */}
                  <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                    <SystemTooltip content="Selecione a data de vencimento da tarefa no calendário">
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="w-full h-8 px-2.5 rounded-lg bg-muted text-[11px] font-semibold text-foreground border border-border/40 hover:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary flex items-center justify-between transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <CalendarDays className="h-3.5 w-3.5 text-primary shrink-0 group-hover:scale-105 transition-transform" />
                            <span className="truncate tracking-tight font-semibold">{formattedDateBR}</span>
                          </div>
                          <ChevronDown className="h-3 w-3 text-muted-foreground opacity-60 shrink-0" />
                        </button>
                      </PopoverTrigger>
                    </SystemTooltip>
                    <PopoverContent className="w-[260px] p-2.5 rounded-2xl border border-border shadow-xl bg-card z-50" align="start">
                      {/* Header do Mês e Navegação */}
                      <div className="flex items-center justify-between mb-2 px-1">
                        <button
                          type="button"
                          onClick={prevMonth}
                          className="h-6 w-6 flex items-center justify-center rounded-lg text-primary hover:bg-muted transition-colors cursor-pointer"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <span className="text-xs font-bold text-foreground">
                          {MONTH_NAMES_PT[calendarMonth]} de {calendarYear}
                        </span>
                        <button
                          type="button"
                          onClick={nextMonth}
                          className="h-6 w-6 flex items-center justify-center rounded-lg text-primary hover:bg-muted transition-colors cursor-pointer"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Linha dos dias da semana */}
                      <div className="grid grid-cols-7 gap-1 mb-1 text-center">
                        {WEEKDAY_NAMES_PT.map((w, idx) => (
                          <span key={idx} className="text-[10px] font-bold text-muted-foreground">
                            {w}
                          </span>
                        ))}
                      </div>

                      {/* Grade dos dias do mês */}
                      <div className="grid grid-cols-7 gap-1 text-center">
                        {renderCalendarDays()}
                      </div>

                      {/* Ações Rápidas no Rodapé do Calendário */}
                      <div className="flex items-center justify-between pt-2 mt-2 border-t border-border/50 text-[10px]">
                        <button
                          type="button"
                          onClick={() => {
                            setTaskDueDate(getRelativeDateYMD(0));
                            setIsCalendarOpen(false);
                          }}
                          className="font-semibold text-primary hover:underline cursor-pointer"
                        >
                          Hoje
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTaskDueDate(getRelativeDateYMD(1));
                            setIsCalendarOpen(false);
                          }}
                          className="font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          Amanhã
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>

                  {/* Seletor Customizado de Hora */}
                  <Popover open={isTimeOpen} onOpenChange={setIsTimeOpen}>
                    <SystemTooltip content="Selecione o horário de vencimento da tarefa">
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="w-full h-8 px-2.5 rounded-lg bg-muted text-[11px] font-semibold text-foreground border border-border/40 hover:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary flex items-center justify-between transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Clock className="h-3.5 w-3.5 text-primary shrink-0 group-hover:scale-105 transition-transform" />
                            <span className="font-semibold">{taskDueTime || "09:00"}</span>
                          </div>
                          <ChevronDown className="h-3 w-3 text-muted-foreground opacity-60 shrink-0" />
                        </button>
                      </PopoverTrigger>
                    </SystemTooltip>
                    <PopoverContent className="w-[180px] p-2 rounded-xl shadow-xl border border-border bg-card z-50" align="start">
                      <div className="grid grid-cols-2 gap-1.5 text-center text-xs">
                        <div>
                          <div className="text-[10px] font-bold text-muted-foreground uppercase pb-1 border-b border-border/60 mb-1">
                            Hora
                          </div>
                          <div className="h-40 overflow-y-auto space-y-0.5 scrollbar-thin pr-0.5">
                            {HOURS_LIST.map((h) => {
                              const isSelected = selectedHour === h;
                              return (
                                <button
                                  type="button"
                                  key={h}
                                  onClick={() => setTaskDueTime(`${h}:${selectedMin}`)}
                                  className={`w-full py-0.5 rounded text-xs transition-colors cursor-pointer ${
                                    isSelected
                                      ? "bg-primary text-primary-foreground font-bold shadow-xs"
                                      : "text-foreground hover:bg-muted font-medium"
                                  }`}
                                >
                                  {h}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-muted-foreground uppercase pb-1 border-b border-border/60 mb-1">
                            Minuto
                          </div>
                          <div className="h-40 overflow-y-auto space-y-0.5 scrollbar-thin pr-0.5">
                            {MINUTES_LIST.map((m) => {
                              const isSelected = selectedMin === m;
                              return (
                                <button
                                  type="button"
                                  key={m}
                                  onClick={() => {
                                    setTaskDueTime(`${selectedHour}:${m}`);
                                    setIsTimeOpen(false);
                                  }}
                                  className={`w-full py-0.5 rounded text-xs transition-colors cursor-pointer ${
                                    isSelected
                                      ? "bg-primary text-primary-foreground font-bold shadow-xs"
                                      : "text-foreground hover:bg-muted font-medium"
                                  }`}
                                >
                                  {m}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Atalhos Rápidos de Horário */}
                <div className="flex items-center gap-1 justify-between pt-0.5">
                  <span className="text-[9px] text-muted-foreground/80 font-medium uppercase tracking-wider pl-0.5">
                    Horário:
                  </span>
                  <div className="flex items-center gap-1">
                    {["09:00", "11:00", "14:00", "16:00", "18:00"].map((timeStr) => {
                      const isSelected = taskDueTime === timeStr;
                      return (
                        <button
                          key={timeStr}
                          type="button"
                          onClick={() => setTaskDueTime(timeStr)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition cursor-pointer ${
                            isSelected
                              ? "bg-primary/15 text-primary font-bold border border-primary/30"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          }`}
                        >
                          {timeStr}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Botão criar */}
              <button
                type="submit"
                disabled={!taskSubject.trim() || taskCreating}
                className="w-full h-8 flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                {taskCreating ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {taskCreating ? "Criando..." : "Criar Tarefa"}
              </button>
            </form>
          </div>

          {/* Painel de Negociações CRM Multi-Card */}
          {activeChat.id !== "valentina" && (
            <ConversationDealsPanel
              conversationId={activeChat.id}
              contactId={activeChat.contactId || activeChat.id}
              customerName={activeChat.name}
            />
          )}

          {/* RD Station CRM Card Integration */}
          {canManageRdCrm && activeChat.id !== "valentina" && (
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
                    <div className="flex items-center gap-2 min-w-0">
                      <Building className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div className="min-w-0">
                        <span className="text-[11px] font-bold text-emerald-900 dark:text-emerald-200 block">
                          Dados da Receita Federal
                        </span>
                        <span className="text-[9px] font-semibold text-emerald-700/80 dark:text-emerald-300/80 block truncate">
                          {linkedAccount ? `Empresa: ${linkedAccount.name}` : "Sem empresa vinculada ao contato"}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={handleQueryCnpjLive}
                      disabled={isSearchingCnpj}
                      className="flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold transition disabled:opacity-50 cursor-pointer shadow-sm shrink-0"
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
                          value={cnpjDetails.cnpjFormatted || (linkedAccount?.document ? formatCNPJ(linkedAccount.document) : "")}
                          onChange={(e) => setCnpjDetails({ ...cnpjDetails, cnpjFormatted: maskCNPJ(e.target.value), cleanCnpj: e.target.value.replace(/\D/g, "") })}
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
                          href={link.url.match(/^https?:\/\//i) ? link.url : `https://${link.url}`}
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
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Building className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold text-emerald-900 dark:text-emerald-200 block">
                        Dados da Receita Federal
                      </span>
                      <span className="text-[9px] font-semibold text-emerald-700/80 dark:text-emerald-300/80 block truncate">
                        {linkedAccount ? `Empresa: ${linkedAccount.name}` : "Sem empresa vinculada ao contato"}
                      </span>
                      {autoSaveStatus === "saving" ? (
                        <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 block animate-pulse">
                          Salvando na empresa...
                        </span>
                      ) : autoSaveStatus === "saved" ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                          <Check className="h-2.5 w-2.5" /> Salvo automaticamente
                        </span>
                      ) : null}
                    </div>
                  </div>
                <button
                  onClick={handleQueryCnpjLive}
                  disabled={isSearchingCnpj}
                  className="flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold transition disabled:opacity-50 cursor-pointer shadow-sm shrink-0"
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
                      value={cnpjDetails.cnpjFormatted || (linkedAccount?.document ? formatCNPJ(linkedAccount.document) : "")}
                      onChange={(e) => setCnpjDetails({ ...cnpjDetails, cnpjFormatted: maskCNPJ(e.target.value), cleanCnpj: e.target.value.replace(/\D/g, "") })}
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
              </div>
            </div>
          </div>
        )
      ) : (
        /* TAB 3: EVENTOS */
        <AttendanceEvents key={`${tenant}:${activeChat.id}`} conversationId={activeChat.id} />
      )}

      <CustomerJourneyModal
        open={showJourneyModal}
        contactId={activeChat.contactId || activeChat.id}
        visitorId={activeChat.siteVisitorId || contactSiteVisitorId}
        initialName={activeChat.name}
        onClose={() => setShowJourneyModal(false)}
        onOpenChat={(conversationId) => {
          setShowJourneyModal(false);
          setSelectedChatId(conversationId);
        }}
      />
    </aside>
  );
}
import { useTrainingSurface } from "@/hooks/useTrainingSurface";
