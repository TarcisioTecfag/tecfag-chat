import React, { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  X,
  Calendar as CalendarIcon,
  Clock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  Users,
  CheckSquare,
  Utensils,
  MapPin,
  Search,
  Loader2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

// Ícone SVG idêntico do WhatsApp
function WhatsAppIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.05 20.15C10.57 20.15 9.12 19.76 7.85 19.01L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.81 13.47 3.81 11.91C3.81 7.37 7.5 3.68 12.05 3.68C14.25 3.68 16.31 4.54 17.87 6.1C19.42 7.66 20.28 9.72 20.28 11.92C20.28 16.46 16.59 20.15 12.05 20.15ZM16.56 14.33C16.31 14.21 15.09 13.61 14.86 13.52C14.63 13.44 14.47 13.4 14.31 13.64C14.15 13.88 13.68 14.43 13.54 14.59C13.4 14.75 13.26 14.77 13.01 14.65C12.76 14.53 11.96 14.27 11.02 13.43C10.28 12.77 9.78 11.96 9.64 11.72C9.5 11.48 9.62 11.35 9.75 11.23C9.86 11.12 10 10.95 10.12 10.81C10.24 10.67 10.28 10.57 10.36 10.41C10.44 10.25 10.4 10.11 10.34 9.99C10.28 9.87 9.8 8.68 9.6 8.19C9.4 7.71 9.2 7.77 9.05 7.76H8.58C8.42 7.76 8.16 7.82 7.94 8.06C7.72 8.3 7.1 8.88 7.1 10.06C7.1 11.24 7.96 12.38 8.08 12.54C8.2 12.7 9.77 15.12 12.18 16.16C12.75 16.41 13.2 16.56 13.54 16.67C14.12 16.85 14.65 16.82 15.07 16.76C15.54 16.69 16.51 16.17 16.71 15.6C16.91 15.03 16.91 14.54 16.85 14.44C16.79 14.34 16.63 14.28 16.56 14.33Z" />
    </svg>
  );
}

export type CrmTaskType = "call" | "email" | "meeting" | "task" | "lunch" | "visit" | "whatsapp";

export const CRM_TASK_TYPES: Array<{
  id: CrmTaskType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "call", label: "Ligar", icon: Phone },
  { id: "email", label: "Email", icon: Mail },
  { id: "meeting", label: "Reunião", icon: Users },
  { id: "task", label: "Tarefa", icon: CheckSquare },
  { id: "lunch", label: "Almoço", icon: Utensils },
  { id: "visit", label: "Visita", icon: MapPin },
  { id: "whatsapp", label: "WhatsApp", icon: WhatsAppIcon },
];

const MONTH_NAMES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const WEEKDAY_NAMES_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

interface DealOption {
  id: string;
  title: string;
  accountId?: string | null;
  account?: { id: string; name: string } | null;
}

interface AccountOption {
  id: string;
  name: string;
}

export interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskCreated?: (task?: any) => void;
  dealId?: string | null;
  dealTitle?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  operators: Array<{ id: string; name: string }>;
  currentOperatorId?: string | null;
}

export function CreateTaskModal({
  isOpen,
  onClose,
  onTaskCreated,
  dealId: initialDealId,
  dealTitle: initialDealTitle,
  accountId: initialAccountId,
  accountName: initialAccountName,
  operators: initialOperators,
  currentOperatorId,
}: CreateTaskModalProps) {
  // Lista de operadores (pode ser incrementada ao convidar novo usuário)
  const [operatorsList, setOperatorsList] = useState(initialOperators);

  useEffect(() => {
    setOperatorsList(initialOperators);
  }, [initialOperators]);

  // Negociação e Empresa selecionadas
  const [selectedDealId, setSelectedDealId] = useState<string | null>(initialDealId || null);
  const [selectedDealTitle, setSelectedDealTitle] = useState<string>(initialDealTitle || "");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(initialAccountId || null);
  const [selectedAccountName, setSelectedAccountName] = useState<string>(initialAccountName || "");

  // Campos do formulário
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<string[]>([]);
  const [taskType, setTaskType] = useState<CrmTaskType>("task");
  const [scheduledDate, setScheduledDate] = useState<Date>(new Date());
  const [scheduledTime, setScheduledTime] = useState("10:00");
  const [markAsCompleted, setMarkAsCompleted] = useState(false);

  // Estados de controle de popovers
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isDealOpen, setIsDealOpen] = useState(false);
  const [isOperatorOpen, setIsOperatorOpen] = useState(false);
  const [isTypeOpen, setIsTypeOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  // Busca de Deals e Empresas
  const [dealQuery, setDealQuery] = useState("");
  const [dealOptions, setDealOptions] = useState<DealOption[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);

  const [accountQuery, setAccountQuery] = useState("");
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const [operatorSearch, setOperatorSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // Modal para convidar novo operador
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  // Calendário customizado: mês e ano em exibição
  const [calendarMonth, setCalendarMonth] = useState<number>(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState<number>(new Date().getFullYear());

  // Reset e inicialização ao abrir o modal
  useEffect(() => {
    if (!isOpen) return;

    setSelectedDealId(initialDealId || null);
    setSelectedDealTitle(initialDealTitle || "");
    setSelectedAccountId(initialAccountId || null);
    setSelectedAccountName(initialAccountName || "");

    setSubject("");
    setDescription("");
    setTaskType("task");
    setMarkAsCompleted(false);

    // Inicializa data atual
    const now = new Date();
    setScheduledDate(now);
    setCalendarMonth(now.getMonth());
    setCalendarYear(now.getFullYear());

    // Hora atual formatada HH:mm (ou arredondada)
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    setScheduledTime(`${hours}:${minutes}`);

    // Responsável padrão
    if (currentOperatorId) {
      setSelectedOperatorIds([currentOperatorId]);
    } else if (initialOperators.length > 0) {
      setSelectedOperatorIds([initialOperators[0].id]);
    } else {
      setSelectedOperatorIds([]);
    }

    setDealQuery("");
    setAccountQuery("");
    setOperatorSearch("");
  }, [isOpen, initialDealId, initialDealTitle, initialAccountId, initialAccountName, currentOperatorId, initialOperators]);

  // Busca de negociações quando o popover de deal abre ou busca muda
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoadingDeals(true);
      try {
        const params = new URLSearchParams({ limit: "30", status: "open" });
        if (dealQuery.trim()) params.set("search", dealQuery.trim());
        const res = await fetch(`/api/crm/deals?${params}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          setDealOptions(data.deals || []);
        }
      } catch (err: any) {
        if (!controller.signal.aborted) {
          console.error("Erro ao buscar negociações:", err);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingDeals(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [isOpen, dealQuery]);

  // Busca de empresas quando o popover de contas abre
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoadingAccounts(true);
      try {
        const params = new URLSearchParams({ limit: "30", type: "company" });
        if (accountQuery.trim()) params.set("search", accountQuery.trim());
        const res = await fetch(`/api/crm/accounts?${params}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          setAccountOptions(data.accounts || []);
        }
      } catch (err: any) {
        if (!controller.signal.aborted) {
          console.error("Erro ao buscar empresas:", err);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingAccounts(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [isOpen, accountQuery]);

  // Ao selecionar um deal da lista
  const handleSelectDeal = (deal: DealOption) => {
    setSelectedDealId(deal.id);
    setSelectedDealTitle(deal.title);
    if (deal.account) {
      setSelectedAccountId(deal.account.id);
      setSelectedAccountName(deal.account.name);
    } else if (deal.accountId) {
      setSelectedAccountId(deal.accountId);
    }
    setIsDealOpen(false);
  };

  // Ao selecionar uma empresa da lista
  const handleSelectAccount = (acc: AccountOption | null) => {
    if (!acc) {
      setSelectedAccountId(null);
      setSelectedAccountName("");
    } else {
      setSelectedAccountId(acc.id);
      setSelectedAccountName(acc.name);
    }
    setIsAccountOpen(false);
  };

  // Toggle responsável (multi-seleção com checkboxes)
  const toggleOperator = (opId: string) => {
    setSelectedOperatorIds((prev) =>
      prev.includes(opId) ? prev.filter((id) => id !== opId) : [...prev, opId]
    );
  };

  const removeOperator = (opId: string) => {
    setSelectedOperatorIds((prev) => prev.filter((id) => id !== opId));
  };

  const clearAllOperators = () => {
    setSelectedOperatorIds([]);
  };

  // Operadores selecionados para exibir como chips
  const selectedOperators = operatorsList.filter((op) => selectedOperatorIds.includes(op.id));

  // Operadores filtrados pela busca
  const filteredOperators = operatorsList.filter((op) =>
    op.name.toLowerCase().includes(operatorSearch.toLowerCase())
  );

  // Tipo de tarefa ativo
  const currentTaskTypeObj = CRM_TASK_TYPES.find((t) => t.id === taskType) || CRM_TASK_TYPES[3];
  const CurrentTaskIcon = currentTaskTypeObj.icon;

  // Formatação de data no padrão BR: DD/MM/YYYY
  const formattedDate = `${String(scheduledDate.getDate()).padStart(2, "0")}/${String(
    scheduledDate.getMonth() + 1
  ).padStart(2, "0")}/${scheduledDate.getFullYear()}`;

  // Funções do calendário customizado (Imagem 5)
  const prevMonth = () => {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear((y) => y - 1);
    } else {
      setCalendarMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
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

    const newDate = new Date(targetYear, targetMonth, day);
    setScheduledDate(newDate);
    setIsCalendarOpen(false);
  };

  // Matriz de dias para renderizar o calendário idêntico ao print
  const renderCalendarDays = () => {
    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay(); // 0 = Domingo
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
          className="h-8 w-8 text-xs text-muted-foreground/45 hover:bg-muted/50 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          {dayNum}
        </button>
      );
    }

    // Dias do mês atual
    for (let day = 1; day <= daysInCurrentMonth; day++) {
      const isSelected =
        scheduledDate.getDate() === day &&
        scheduledDate.getMonth() === calendarMonth &&
        scheduledDate.getFullYear() === calendarYear;

      cells.push(
        <button
          key={`cur-${day}`}
          type="button"
          onClick={() => handleSelectDay(day, 0)}
          className={`h-8 w-8 text-xs font-semibold rounded-lg flex items-center justify-center transition-all cursor-pointer ${
            isSelected
              ? "bg-[#00c5ff] text-white font-bold shadow-xs hover:bg-[#00b0e6]"
              : "text-foreground hover:bg-muted"
          }`}
        >
          {day}
        </button>
      );
    }

    // Dias do próximo mês para completar grade
    const totalFilled = cells.length;
    const remaining = (7 - (totalFilled % 7)) % 7;
    for (let day = 1; day <= remaining; day++) {
      cells.push(
        <button
          key={`next-${day}`}
          type="button"
          onClick={() => handleSelectDay(day, 1)}
          className="h-8 w-8 text-xs text-muted-foreground/45 hover:bg-muted/50 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          {day}
        </button>
      );
    }

    return cells;
  };

  // Submissão do formulário
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDealId) {
      toast.error("Por favor, selecione uma Negociação.");
      return;
    }
    if (!subject.trim()) {
      toast.error("Por favor, preencha o assunto da tarefa.");
      return;
    }

    setSaving(true);
    try {
      // Monta data e hora
      const [hoursStr, minsStr] = (scheduledTime || "10:00").split(":");
      const hours = parseInt(hoursStr || "10", 10);
      const minutes = parseInt(minsStr || "0", 10);

      const dueDateTime = new Date(
        scheduledDate.getFullYear(),
        scheduledDate.getMonth(),
        scheduledDate.getDate(),
        hours,
        minutes
      );

      const payload = {
        type: taskType,
        title: subject.trim(),
        description: description.trim() || undefined,
        dueDate: dueDateTime.toISOString(),
        assignedToOperatorId: selectedOperatorIds[0] || currentOperatorId || undefined,
        status: markAsCompleted ? "completed" : "pending",
        completed: markAsCompleted,
      };

      const res = await fetch(`/api/crm/deals/${selectedDealId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Não foi possível criar a tarefa.");
      }

      const data = await res.json();
      toast.success(markAsCompleted ? "Tarefa criada e concluída!" : "Tarefa agendada com sucesso!");
      onTaskCreated?.(data.activity);
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar tarefa.");
    } finally {
      setSaving(false);
    }
  };

  // Convidar novo usuário
  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim()) {
      toast.error("Nome e E-mail são obrigatórios.");
      return;
    }
    setInviting(true);
    try {
      const generatedId = `op-${Date.now()}`;
      const res = await fetch("/api/operators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: generatedId,
          name: inviteName.trim(),
          email: inviteEmail.trim().toLowerCase(),
          role: "atendente",
          status: "online",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Não foi possível convidar o usuário.");
      }

      const newOp = { id: generatedId, name: inviteName.trim() };
      setOperatorsList((prev) => [...prev, newOp]);
      setSelectedOperatorIds((prev) => [...prev, newOp.id]);
      toast.success(`Usuário ${newOp.name} convidado e atribuído!`);
      setShowInviteModal(false);
      setInviteName("");
      setInviteEmail("");
    } catch (err: any) {
      toast.error(err.message || "Falha ao convidar usuário.");
    } finally {
      setInviting(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-[480px] w-full p-0 gap-0 overflow-visible rounded-2xl bg-card border border-border shadow-2xl">
          {/* Cabeçalho Limpo idêntico ao RD Station */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/80">
            <DialogTitle className="text-base font-bold text-foreground">
              Criar Tarefa
            </DialogTitle>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Corpo do Formulário */}
            <div className="max-h-[75vh] overflow-y-auto px-6 py-4 space-y-4 text-xs">
              {/* 1. Empresa da negociação */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Empresa da negociação
                </Label>
                <Popover open={isAccountOpen} onOpenChange={setIsAccountOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-xs transition-colors hover:bg-muted/40 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <span className={selectedAccountName ? "text-foreground font-medium truncate" : "text-muted-foreground truncate"}>
                        {selectedAccountName || "Selecionar"}
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 opacity-70" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[380px] p-2" align="start">
                    <div className="relative mb-2">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={accountQuery}
                        onChange={(e) => setAccountQuery(e.target.value)}
                        placeholder="Buscar empresa..."
                        className="h-8 pl-8 text-xs"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {selectedAccountId && (
                        <button
                          type="button"
                          onClick={() => handleSelectAccount(null)}
                          className="w-full text-left px-2.5 py-1.5 text-xs text-rose-500 hover:bg-rose-500/10 rounded-md transition-colors"
                        >
                          Remover vínculo com empresa
                        </button>
                      )}
                      {loadingAccounts ? (
                        <div className="flex items-center justify-center p-3 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Carregando...
                        </div>
                      ) : accountOptions.length > 0 ? (
                        accountOptions.map((acc) => (
                          <button
                            type="button"
                            key={acc.id}
                            onClick={() => handleSelectAccount(acc)}
                            className={`w-full text-left px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                              acc.id === selectedAccountId
                                ? "bg-primary/10 text-primary font-bold"
                                : "text-foreground hover:bg-muted"
                            }`}
                          >
                            {acc.name}
                          </button>
                        ))
                      ) : (
                        <p className="p-2 text-center text-muted-foreground text-xs">
                          Nenhuma empresa encontrada.
                        </p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* 2. Negociação * */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Negociação <span className="text-rose-500">*</span>
                </Label>
                <Popover open={isDealOpen} onOpenChange={setIsDealOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-xs transition-colors hover:bg-muted/40 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <span className={selectedDealTitle ? "text-foreground font-semibold truncate" : "text-muted-foreground truncate"}>
                        {selectedDealTitle || "Selecionar negociação"}
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 opacity-70" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[380px] p-2" align="start">
                    <div className="relative mb-2">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={dealQuery}
                        onChange={(e) => setDealQuery(e.target.value)}
                        placeholder="Buscar negociação..."
                        className="h-8 pl-8 text-xs"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {loadingDeals ? (
                        <div className="flex items-center justify-center p-3 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Buscando...
                        </div>
                      ) : dealOptions.length > 0 ? (
                        dealOptions.map((deal) => (
                          <button
                            type="button"
                            key={deal.id}
                            onClick={() => handleSelectDeal(deal)}
                            className={`w-full text-left px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                              deal.id === selectedDealId
                                ? "bg-primary/10 text-primary font-bold"
                                : "text-foreground hover:bg-muted"
                            }`}
                          >
                            <span className="block font-semibold">{deal.title}</span>
                            {deal.account?.name && (
                              <span className="block text-[11px] text-muted-foreground">
                                {deal.account.name}
                              </span>
                            )}
                          </button>
                        ))
                      ) : (
                        <p className="p-2 text-center text-muted-foreground text-xs">
                          Nenhuma negociação encontrada.
                        </p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* 3. Assunto da tarefa * */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Assunto da tarefa <span className="text-rose-500">*</span>
                </Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Assunto da tarefa"
                  className="h-10 text-xs rounded-lg border-input"
                  required
                />
              </div>

              {/* 4. Descrição da tarefa */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Descrição da tarefa
                </Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descrição da tarefa"
                  rows={3}
                  className="text-xs rounded-lg border-input resize-y"
                />
              </div>

              {/* 5. Responsável * (Multi-seleção com tags & checkboxes, Imagens 2 e 3) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Responsável <span className="text-rose-500">*</span>
                </Label>
                <Popover open={isOperatorOpen} onOpenChange={setIsOperatorOpen}>
                  <PopoverTrigger asChild>
                    <div
                      className="min-h-[40px] w-full rounded-lg border border-input bg-background p-1.5 flex items-center justify-between cursor-pointer hover:border-border transition-colors focus-within:ring-1 focus-within:ring-primary"
                    >
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                        {selectedOperators.length > 0 ? (
                          selectedOperators.map((op) => (
                            <span
                              key={op.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#e2e8f0] dark:bg-muted text-foreground text-xs font-medium"
                            >
                              <span>{op.name}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeOperator(op.id);
                                }}
                                className="hover:text-rose-500 transition-colors"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground px-1.5">
                            Selecionar responsável
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {selectedOperators.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              clearAllOperators();
                            }}
                            className="p-1 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <ChevronDown className="h-4 w-4 text-muted-foreground opacity-70" />
                      </div>
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-[340px] p-2" align="start">
                    {operatorsList.length > 6 && (
                      <div className="relative mb-2">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          value={operatorSearch}
                          onChange={(e) => setOperatorSearch(e.target.value)}
                          placeholder="Buscar colaborador..."
                          className="h-8 pl-8 text-xs"
                        />
                      </div>
                    )}
                    <div className="max-h-56 overflow-y-auto space-y-1">
                      {filteredOperators.map((op) => {
                        const isChecked = selectedOperatorIds.includes(op.id);
                        return (
                          <div
                            key={op.id}
                            onClick={() => toggleOperator(op.id)}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-muted/80 cursor-pointer transition-colors"
                          >
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleOperator(op.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="data-[state=checked]:bg-[#00c5ff] data-[state=checked]:border-[#00c5ff]"
                            />
                            <span className="text-xs font-medium text-foreground">
                              {op.name}
                            </span>
                          </div>
                        );
                      })}
                      {filteredOperators.length === 0 && (
                        <p className="p-3 text-center text-xs text-muted-foreground">
                          Nenhum colaborador encontrado.
                        </p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Botão Convidar Usuário em Ciano Claro (Imagem 2) */}
                <button
                  type="button"
                  onClick={() => setShowInviteModal(true)}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-[#b2f1ff] hover:bg-[#8ee8fc] dark:bg-cyan-950/60 dark:hover:bg-cyan-900 text-[#00708f] dark:text-cyan-300 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>Convidar usuário</span>
                </button>
              </div>

              {/* 6. Tipo de tarefa * (Dropdown com Ícones, Imagens 2 e 4) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Tipo de tarefa <span className="text-rose-500">*</span>
                </Label>
                <Popover open={isTypeOpen} onOpenChange={setIsTypeOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-xs transition-colors hover:bg-muted/40 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <div className="flex items-center gap-2">
                        <CurrentTaskIcon className="h-4 w-4 text-foreground/80 shrink-0" />
                        <span className="font-semibold text-foreground">{currentTaskTypeObj.label}</span>
                      </div>
                      <ChevronDown className="h-4 w-4 text-muted-foreground opacity-70" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[240px] p-1.5 rounded-xl shadow-lg border border-border" align="start">
                    <div className="space-y-0.5">
                      {CRM_TASK_TYPES.map((t) => {
                        const Icon = t.icon;
                        const isSelected = t.id === taskType;
                        return (
                          <button
                            type="button"
                            key={t.id}
                            onClick={() => {
                              setTaskType(t.id);
                              setIsTypeOpen(false);
                            }}
                            className={`flex w-full items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                              isSelected
                                ? "bg-cyan-50 dark:bg-cyan-950/40 text-[#00a8cc] dark:text-[#00c5ff] font-bold"
                                : "text-foreground hover:bg-muted"
                            }`}
                          >
                            <Icon className={`h-4 w-4 shrink-0 ${isSelected ? "text-[#00a8cc] dark:text-[#00c5ff]" : "text-foreground/75"}`} />
                            <span>{t.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* 7. Data do agendamento * (Input + Popover Calendário Imagem 5) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Data do agendamento <span className="text-rose-500">*</span>
                </Label>
                <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                  <PopoverTrigger asChild>
                    <div className="relative flex h-10 w-full items-center rounded-lg border border-input bg-background px-3 cursor-pointer hover:border-border transition-colors">
                      <CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0 mr-2.5" />
                      <span className="text-xs font-semibold text-foreground">{formattedDate}</span>
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-3 rounded-2xl border border-border shadow-xl bg-card" align="start">
                    {/* Header do Mês e Navegação */}
                    <div className="flex items-center justify-between mb-3 px-1">
                      <button
                        type="button"
                        onClick={prevMonth}
                        className="h-7 w-7 flex items-center justify-center rounded-lg text-[#00c5ff] hover:bg-muted transition-colors cursor-pointer"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="text-xs font-bold text-foreground">
                        {MONTH_NAMES_PT[calendarMonth]} {calendarYear}
                      </span>
                      <button
                        type="button"
                        onClick={nextMonth}
                        className="h-7 w-7 flex items-center justify-center rounded-lg text-[#00c5ff] hover:bg-muted transition-colors cursor-pointer"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Linha dos dias da semana */}
                    <div className="grid grid-cols-7 gap-1 mb-1 text-center">
                      {WEEKDAY_NAMES_PT.map((w) => (
                        <span key={w} className="text-[10px] font-bold text-muted-foreground">
                          {w}
                        </span>
                      ))}
                    </div>

                    {/* Grade dos dias do mês */}
                    <div className="grid grid-cols-7 gap-1 text-center">
                      {renderCalendarDays()}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* 8. Horário da tarefa * */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Horário da tarefa <span className="text-rose-500">*</span>
                </Label>
                <div className="relative flex h-10 w-full items-center rounded-lg border border-input bg-background px-3 focus-within:ring-1 focus-within:ring-primary">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0 mr-2.5" />
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-none"
                    required
                  />
                </div>
              </div>

              {/* 9. Checkbox: Marcar como concluída ao criar */}
              <div className="flex items-center gap-2.5 pt-1">
                <Checkbox
                  id="mark-task-completed"
                  checked={markAsCompleted}
                  onCheckedChange={(val) => setMarkAsCompleted(!!val)}
                  className="data-[state=checked]:bg-[#00c5ff] data-[state=checked]:border-[#00c5ff]"
                >
                  Marcar como concluída ao criar
                </Checkbox>
                <Label
                  htmlFor="mark-task-completed"
                  className="text-xs font-normal text-muted-foreground cursor-pointer select-none"
                >
                  Marcar como concluída ao criar
                </Label>
              </div>
            </div>

            {/* Rodapé com botões de ação */}
            <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-border/80 bg-muted/20">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-xs font-medium"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving || !subject.trim() || !selectedDealId}
                className="bg-[#00c5ff] hover:bg-[#00b0e6] text-white font-semibold text-xs px-5 shadow-xs cursor-pointer"
              >
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Criar tarefa
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Mini-modal para convidar usuário */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent className="max-w-md p-6 rounded-2xl bg-card border border-border">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-foreground">
              Convidar Novo Usuário
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleInviteUser} className="space-y-3.5 mt-2 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Nome Completo *</Label>
              <Input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Ex: Amanda Alves"
                className="h-9 text-xs"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">E-mail Corporativo *</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Ex: amanda@tecfag.com.br"
                className="h-9 text-xs"
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowInviteModal(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={inviting || !inviteName.trim() || !inviteEmail.trim()}
                className="bg-[#00c5ff] hover:bg-[#00b0e6] text-white font-semibold"
              >
                {inviting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Confirmar e Adicionar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
