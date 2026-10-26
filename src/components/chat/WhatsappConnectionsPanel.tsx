import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";
import { useWhatsappConnections, whatsappConnectionAction } from "@/hooks/useWhatsappConnections";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Filter,
  Layers,
  Loader2,
  Plus,
  PowerOff,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  User,
  X,
} from "lucide-react";

const base = import.meta.env.VITE_BACKEND_URL || "";

const CAPTURE_POLICY_OPTIONS = [
  {
    value: "selected" as const,
    label: "Somente contatos selecionados para este número",
    shortLabel: "Somente contatos selecionados",
    description:
      "Iniciar uma conversa por este número seleciona o contato para sincronização. Outros contatos não serão armazenados.",
    Icon: Filter,
  },
  {
    value: "all" as const,
    label: "Integrar todas as conversas individuais da conta",
    shortLabel: "Conta integralmente integrada",
    description:
      "Todas as conversas individuais e o histórico disponibilizado pelo WhatsApp poderão ser armazenados e consultados por administradores autorizados.",
    Icon: Layers,
  },
] as const;

export function WhatsappConnectionsPanel({ compact = false }: { compact?: boolean }) {
  const { tenant, operators, currentOperatorId } = useChat();
  const { enabled, canManage, encryptionReady, connections, refresh } =
    useWhatsappConnections(tenant);

  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [capture, setCapture] = useState<"selected" | "all">("selected");
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState<string | null>(null);
  const [qr, setQr] = useState("");
  const [pairError, setPairError] = useState("");

  // Estados dos Menus Suspensos Customizados (Popover)
  const [ownerPopoverOpen, setOwnerPopoverOpen] = useState(false);
  const [ownerSearch, setOwnerSearch] = useState("");
  const [capturePopoverOpen, setCapturePopoverOpen] = useState(false);

  useEffect(() => {
    setPairing(null);
    setQr("");
    setPairError("");
  }, [tenant]);

  useEffect(() => {
    if (!pairing) return;
    const controller = new AbortController();
    let working = false;
    setQr("");
    setPairError("");
    const poll = async () => {
      if (working) return;
      working = true;
      try {
        const response = await fetch(
          `${base}/api/whatsapp/connections?id=${encodeURIComponent(pairing)}`,
          { credentials: "include", signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Conexão indisponível.");
        const image = data.qr ? await QRCode.toDataURL(data.qr, { width: 256, margin: 2 }) : "";
        if (controller.signal.aborted) return;
        setQr(image);
        setPairError(data.error || "");
        if (data.status === "connected") {
          setPairing(null);
          toast.success("WhatsApp conectado.");
          await refresh();
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setQr("");
          setPairError(e instanceof Error ? e.message : "Falha ao consultar QR.");
        }
      } finally {
        working = false;
      }
    };
    void poll();
    const timer = window.setInterval(poll, 2_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [pairing, refresh]);

  const action = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await whatsappConnectionAction(body);
      await refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na conexão.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const sellerConnections = useMemo(
    () => connections.filter((c) => !c.corporate),
    [connections],
  );

  const connectedCount = useMemo(
    () => sellerConnections.filter((c) => c.status === "connected").length,
    [sellerConnections],
  );

  const selectedOwnerId = owner || currentOperatorId || operators[0]?.id || "";
  const selectedOwnerObj = useMemo(
    () => operators.find((o) => o.id === selectedOwnerId),
    [operators, selectedOwnerId],
  );

  const filteredOperators = useMemo(() => {
    const q = ownerSearch.trim().toLowerCase();
    if (!q) return operators;
    return operators.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.email && o.email.toLowerCase().includes(q)),
    );
  }, [operators, ownerSearch]);

  const selectedCaptureOption =
    CAPTURE_POLICY_OPTIONS.find((opt) => opt.value === capture) || CAPTURE_POLICY_OPTIONS[0];

  if (!enabled) return null;

  return (
    <section
      className={
        compact
          ? "rounded-2xl border border-border bg-card p-4 shadow-soft space-y-4"
          : "rounded-2xl border border-border bg-card p-6 shadow-soft space-y-5"
      }
    >
      {/* Cabeçalho do Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/70 pb-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
            <QrCode className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm md:text-base font-extrabold text-foreground">
                WhatsApps dos vendedores
              </h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-[10px] font-bold text-primary">
                {connectedCount}/{sellerConnections.length} conectado(s)
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Cada número funciona junto com o WhatsApp da empresa. O titular conecta a própria
              conta pelo QR.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <SystemTooltip content="Atualizar status das conexões dos vendedores">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-3 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin text-primary" : "text-muted-foreground"}`} />
              <span>Atualizar</span>
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* Lista de Conexões Cadastradas */}
      {sellerConnections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Smartphone className="h-4 w-4" />
          </div>
          <div className="space-y-0.5">
            <p className="font-bold text-foreground">Nenhum WhatsApp de vendedor cadastrado ainda</p>
            <p className="text-[11px] text-muted-foreground">
              {canManage
                ? "Preencha os campos abaixo e clique em \"Adicionar conexão\". Em seguida, o botão \"Conectar / QR\" aparecerá aqui para leitura no celular."
                : "Solicite ao administrador para vincular o seu número de vendedor. Assim que liberado, o botão \"Conectar / QR\" aparecerá aqui."}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {sellerConnections.map((c) => {
            const isConnected = c.status === "connected";
            const isPairingThis = pairing === c.id;
            const ownerOperator = operators.find((o) => o.id === c.ownerOperatorId);

            return (
              <div
                key={c.id}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3.5 text-xs transition-all ${
                  isPairingThis
                    ? "border-primary/50 bg-primary/5 ring-2 ring-primary/15"
                    : isConnected
                      ? "border-emerald-500/25 bg-emerald-500/[0.03]"
                      : "border-border bg-muted/20 hover:bg-muted/35"
                }`}
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border mt-0.5 ${
                      isConnected
                        ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted border-border text-muted-foreground"
                    }`}
                  >
                    <Smartphone className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-xs sm:text-sm font-extrabold text-foreground truncate">
                        {c.name}
                      </strong>

                      <SystemTooltip
                        content={
                          isConnected
                            ? "Sessão WhatsApp Web pareada e operacional"
                            : "Aparelho desconectado — clique em Conectar / QR para parear"
                        }
                      >
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                            isConnected
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                            }`}
                          />
                          {isConnected ? "Conectado" : "Desconectado"}
                        </span>
                      </SystemTooltip>

                      <SystemTooltip
                        content={
                          c.capturePolicy === "all"
                            ? "Todas as conversas individuais desta conta são sincronizadas"
                            : "Apenas contatos selecionados/iniciados por este número são sincronizados"
                        }
                      >
                        <span className="inline-flex items-center gap-1 rounded-lg bg-muted/80 border border-border/70 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {c.capturePolicy === "all" ? (
                            <Layers className="h-3 w-3 text-primary shrink-0" />
                          ) : (
                            <Filter className="h-3 w-3 text-primary shrink-0" />
                          )}
                          {c.capturePolicy === "all"
                            ? "Conta integralmente integrada"
                            : "Somente contatos selecionados"}
                        </span>
                      </SystemTooltip>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="font-mono font-semibold text-foreground/85">
                        {c.phone || "Número ainda não pareado"}
                      </span>
                      {ownerOperator && (
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3 text-primary/80" />
                          <span>Titular: {ownerOperator.name}</span>
                        </span>
                      )}
                    </div>

                    {c.error && (
                      <p
                        role="alert"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 px-2.5 py-1 text-[11px] font-semibold text-red-600 dark:text-red-400 mt-1"
                      >
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>{c.error}</span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Botões de Ação */}
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <SystemTooltip content="Gerar e exibir o QR Code para conectar o WhatsApp pelo celular">
                    <button
                      type="button"
                      className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs ${
                        isConnected
                          ? "border border-border bg-card text-foreground hover:bg-muted"
                          : "bg-primary text-primary-foreground hover:opacity-90 shadow-soft"
                      }`}
                      disabled={busy || !c.enabled}
                      onClick={async () => {
                        if (await action({ action: "connect", connectionId: c.id })) {
                          setPairing(c.id);
                        }
                      }}
                    >
                      <QrCode className="h-3.5 w-3.5 shrink-0" />
                      <span>Conectar / QR</span>
                    </button>
                  </SystemTooltip>

                  <SystemTooltip content="Desconectar sessão e remover o pareamento atual deste número">
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-500/20 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={busy}
                      onClick={async () => {
                        if (await action({ action: "disconnect", connectionId: c.id })) {
                          setPairing(null);
                          setQr("");
                        }
                      }}
                    >
                      <PowerOff className="h-3.5 w-3.5 shrink-0" />
                      <span>Desconectar</span>
                    </button>
                  </SystemTooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Painel de Leitura do QR Code Ativo */}
      {pairing && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <QrCode className="h-4 w-4 text-primary" />
              <span className="text-xs font-extrabold uppercase tracking-wider text-primary">
                Pareamento via QR Code
              </span>
            </div>
            <SystemTooltip content="Fechar painel de leitura do QR Code">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
                onClick={() => {
                  setPairing(null);
                  setQr("");
                }}
              >
                <X className="h-3.5 w-3.5" />
                <span>Fechar QR</span>
              </button>
            </SystemTooltip>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            <div className="flex flex-col items-center justify-center rounded-2xl bg-card/80 border border-border p-5">
              {qr ? (
                <div className="bg-white p-3.5 rounded-2xl shadow-soft border border-border/40">
                  <img
                    className="mx-auto rounded-lg object-contain"
                    src={qr}
                    alt="QR de pareamento do seu WhatsApp"
                    width={220}
                    height={220}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center space-y-2.5">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-xs font-semibold text-foreground">
                    Gerando QR ou restaurando sessão…
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Aguarde alguns instantes enquanto o código seguro é preparado.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3 text-xs">
              <h4 className="text-sm font-extrabold text-foreground">
                Como conectar o celular do vendedor:
              </h4>
              <ol className="list-decimal list-inside space-y-2 text-muted-foreground leading-relaxed">
                <li>
                  No celular, abra o <strong className="text-foreground">WhatsApp</strong>.
                </li>
                <li>
                  Toque em <strong className="text-foreground">Aparelhos conectados</strong> e depois
                  em <strong className="text-foreground">Conectar um aparelho</strong>.
                </li>
                <li>Aponte a câmera do celular para ler este QR Code.</li>
              </ol>
              <p className="rounded-xl bg-card/70 border border-border/70 p-3 text-[11px] text-muted-foreground leading-relaxed">
                No celular, abra Aparelhos conectados e leia este QR. A integração recebe os eventos
                da conta; a política escolhida determina o que será armazenado.
              </p>
              {pairError && (
                <p
                  role="alert"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs font-semibold text-red-600 dark:text-red-400"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{pairError}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Formulário: Adicionar número de vendedor */}
      {canManage && (
        <form
          className="space-y-4 border-t border-border/70 pt-5"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await action({
                action: "create",
                name,
                ownerOperatorId: selectedOwnerId,
                capturePolicy: capture,
              })
            ) {
              setName("");
            }
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="grid h-6 w-6 place-items-center rounded-lg bg-primary/10 text-primary">
                <Plus className="h-3.5 w-3.5" />
              </div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                Adicionar número de vendedor
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              Após adicionar, clique em &quot;Conectar / QR&quot; na conexão criada acima
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* 1. Nome da Conexão */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                Identificação do Número
              </label>
              <SystemTooltip content="Informe um nome fácil de identificar (ex.: WhatsApp do João)">
                <div className="relative">
                  <Smartphone className="h-3.5 w-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    aria-label="Nome da conexão"
                    required
                    maxLength={80}
                    className="h-10 w-full rounded-xl border border-border bg-muted/40 pl-9 pr-3 text-xs font-medium text-foreground placeholder:text-muted-foreground focus:border-primary focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                    placeholder="Ex.: WhatsApp do João"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </SystemTooltip>
            </div>

            {/* 2. Titular da Conexão — Menu Suspenso Customizado (Popover) */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                Funcionário / Vendedor Titular
              </label>
              <Popover open={ownerPopoverOpen} onOpenChange={setOwnerPopoverOpen}>
                <SystemTooltip content="Selecione o vendedor titular que irá conectar o QR Code deste WhatsApp">
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Titular da conexão"
                      className="h-10 w-full flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 hover:bg-muted/70 hover:border-primary/40 px-3 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <User className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="truncate">
                          {selectedOwnerObj?.name || "Selecionar vendedor"}
                        </span>
                      </div>
                      <ChevronDown
                        className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${
                          ownerPopoverOpen ? "rotate-180 text-primary" : ""
                        }`}
                      />
                    </button>
                  </PopoverTrigger>
                </SystemTooltip>

                <PopoverContent
                  align="start"
                  sideOffset={6}
                  className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-2 rounded-2xl border border-border bg-card shadow-2xl z-[220] space-y-2"
                >
                  {operators.length > 5 && (
                    <div className="relative">
                      <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={ownerSearch}
                        onChange={(e) => setOwnerSearch(e.target.value)}
                        placeholder="Buscar funcionário..."
                        className="h-8 w-full rounded-lg border border-border/70 bg-muted/40 pl-8 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  )}

                  <div className="max-h-56 overflow-y-auto space-y-0.5 scrollbar-thin pr-0.5">
                    {filteredOperators.length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">
                        Nenhum funcionário encontrado.
                      </p>
                    ) : (
                      filteredOperators.map((op) => {
                        const isSelected = op.id === selectedOwnerId;
                        return (
                          <button
                            key={op.id}
                            type="button"
                            onClick={() => {
                              setOwner(op.id);
                              setOwnerPopoverOpen(false);
                              setOwnerSearch("");
                            }}
                            className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs transition-all cursor-pointer text-left ${
                              isSelected
                                ? "bg-primary/10 text-primary font-bold"
                                : "text-foreground hover:bg-muted font-medium"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div
                                className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[10px] font-bold ${
                                  isSelected
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {op.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate">{op.name}</div>
                                {op.email && (
                                  <div className="text-[10px] text-muted-foreground truncate font-normal">
                                    {op.email}
                                  </div>
                                )}
                              </div>
                            </div>
                            {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* 3. Política de Captura — Menu Suspenso Customizado (Popover) */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                Conversas Armazenadas
              </label>
              <Popover open={capturePopoverOpen} onOpenChange={setCapturePopoverOpen}>
                <SystemTooltip content="Defina quais conversas deste número serão integradas e salvas no sistema">
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Conversas armazenadas"
                      className="h-10 w-full flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 hover:bg-muted/70 hover:border-primary/40 px-3 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <selectedCaptureOption.Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="truncate">{selectedCaptureOption.label}</span>
                      </div>
                      <ChevronDown
                        className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${
                          capturePopoverOpen ? "rotate-180 text-primary" : ""
                        }`}
                      />
                    </button>
                  </PopoverTrigger>
                </SystemTooltip>

                <PopoverContent
                  align="end"
                  sideOffset={6}
                  className="w-[var(--radix-popover-trigger-width)] min-w-[300px] p-2 rounded-2xl border border-border bg-card shadow-2xl z-[220] space-y-1"
                >
                  {CAPTURE_POLICY_OPTIONS.map((opt) => {
                    const isSelected = capture === opt.value;
                    const Icon = opt.Icon;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setCapture(opt.value);
                          setCapturePopoverOpen(false);
                        }}
                        className={`w-full flex items-start gap-2.5 rounded-xl p-2.5 text-left transition-all cursor-pointer ${
                          isSelected
                            ? "bg-primary/10 border border-primary/25"
                            : "hover:bg-muted border border-transparent"
                        }`}
                      >
                        <div
                          className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg mt-0.5 ${
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div
                            className={`text-xs ${
                              isSelected ? "font-bold text-primary" : "font-semibold text-foreground"
                            }`}
                          >
                            {opt.label}
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-relaxed">
                            {opt.description}
                          </p>
                        </div>
                        {isSelected && <Check className="h-4 w-4 text-primary shrink-0 mt-1" />}
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Rodapé do Formulário: Resumo da Política + Botão Adicionar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-muted/30 border border-border/60 p-3">
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-[11px] leading-relaxed">{selectedCaptureOption.description}</p>
                {!encryptionReady && (
                  <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      A chave de proteção das novas conexões precisa ser configurada no servidor.
                    </span>
                  </p>
                )}
              </div>
            </div>

            <SystemTooltip
              content={
                !encryptionReady
                  ? "Configure a chave de criptografia no servidor antes de criar conexões"
                  : "Cadastrar este número e liberar o botão Conectar / QR"
              }
            >
              <button
                type="submit"
                disabled={busy || !encryptionReady}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-extrabold text-primary-foreground shadow-soft transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                <span>Adicionar conexão</span>
              </button>
            </SystemTooltip>
          </div>
        </form>
      )}
    </section>
  );
}

export function WhatsappConversationConnection({
  contactId,
  connectionId,
  showAll,
  onShowAll,
  onOpen,
}: {
  contactId?: string;
  connectionId?: string | null;
  showAll: boolean;
  onShowAll: (value: boolean) => void;
  onOpen: (id: string) => Promise<void>;
}) {
  const { tenant } = useChat();
  const { enabled, connections } = useWhatsappConnections(tenant);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showConnectPanel, setShowConnectPanel] = useState(false);

  const current = connections.find((c) => c.id === (connectionId || "corporate"));
  const enabledConnections = useMemo(() => connections.filter((c) => c.enabled), [connections]);
  const selectedConnectionObj = useMemo(
    () => enabledConnections.find((c) => c.id === selected) || current || enabledConnections[0],
    [enabledConnections, selected, current],
  );

  useEffect(() => setSelected(connectionId || "corporate"), [connectionId, contactId]);

  if (!enabled) return null;

  return (
    <div className="border-b border-border bg-card/80 backdrop-blur-xs px-4 py-2.5 space-y-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Identificação da Conexão Atual */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1 text-[11px] font-bold text-foreground">
            <Smartphone className="h-3.5 w-3.5 text-primary shrink-0" />
            <strong className="truncate">
              Respondendo por: {current?.name || "Conexão deste atendimento"}
            </strong>
            {current?.phone && (
              <span className="font-mono text-[10px] text-muted-foreground">
                · {current.phone}
              </span>
            )}
          </span>
        </div>

        {/* Botão para o funcionário abrir e conectar o seu próprio QR Code */}
        <SystemTooltip content="Abrir painel para conectar ou gerenciar o QR Code do seu WhatsApp">
          <button
            type="button"
            onClick={() => setShowConnectPanel((prev) => !prev)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-all cursor-pointer ${
              showConnectPanel
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted/40 text-foreground hover:bg-muted hover:border-primary/40"
            }`}
          >
            <QrCode className="h-3.5 w-3.5 text-primary shrink-0" />
            <span>Conectar meu WhatsApp</span>
            <ChevronDown
              className={`h-3 w-3 text-muted-foreground transition-transform duration-200 ${
                showConnectPanel ? "rotate-180 text-primary" : ""
              }`}
            />
          </button>
        </SystemTooltip>
      </div>

      {/* Linha de Controles: Histórico Unificado + Seletor Customizado de Número */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SystemTooltip content="Exibir na conversa o histórico unificado de mensagens de todos os números autorizados para este cliente">
          <label className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-muted/30 hover:bg-muted/60 px-3 py-1.5 cursor-pointer select-none transition-colors">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => onShowAll(e.target.checked)}
              className="sr-only"
            />
            <span
              className={`grid h-4 w-4 place-items-center rounded border transition-colors ${
                showAll
                  ? "bg-primary border-primary text-primary-foreground"
                  : "bg-background border-border"
              }`}
            >
              {showAll && <Check className="h-3 w-3 stroke-[3]" />}
            </span>
            <span className="text-[11px] font-semibold text-foreground">
              Histórico de todos os números autorizados
            </span>
          </label>
        </SystemTooltip>

        <div className="flex flex-wrap items-center gap-2">
          {/* Menu Suspenso Customizado (Popover) substituindo <select> nativo */}
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <SystemTooltip content="Escolher outro número de WhatsApp autorizado para atender este contato">
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Conversar por outro número"
                  className="h-8 min-w-[210px] max-w-full flex items-center justify-between gap-2 rounded-xl border border-border bg-background hover:bg-muted/50 hover:border-primary/40 px-3 text-xs font-semibold text-foreground transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                    <Smartphone className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate">
                      {selectedConnectionObj?.name || "Selecionar número"}
                      {selectedConnectionObj?.phone ? ` · ${selectedConnectionObj.phone}` : ""}
                    </span>
                  </div>
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${
                      pickerOpen ? "rotate-180 text-primary" : ""
                    }`}
                  />
                </button>
              </PopoverTrigger>
            </SystemTooltip>

            <PopoverContent
              align="end"
              sideOffset={6}
              className="w-[290px] p-1.5 rounded-2xl border border-border bg-card shadow-2xl z-[220] space-y-1"
            >
              {enabledConnections.map((c) => {
                const isSelected = c.id === selected;
                const isOnline = c.status === "connected";
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelected(c.id);
                      setPickerOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs transition-all cursor-pointer text-left ${
                      isSelected
                        ? "bg-primary/10 text-primary font-bold"
                        : "text-foreground hover:bg-muted font-medium"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${
                          isOnline ? "bg-emerald-500" : "bg-amber-500"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="truncate">{c.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          {c.phone || (c.corporate ? "Canal oficial da empresa" : "Não pareado")}
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>

          <SystemTooltip content="Abrir ou iniciar a conversa com este cliente usando o número selecionado ao lado">
            <button
              type="button"
              disabled={busy || !contactId || !selected}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground shadow-2xs hover:opacity-90 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={async () => {
                setBusy(true);
                try {
                  const data = await whatsappConnectionAction({
                    action: "start",
                    connectionId: selected,
                    contactId,
                  });
                  await onOpen(data.conversationId);
                } catch (e) {
                  toast.error(
                    e instanceof Error ? e.message : "Não foi possível abrir a conversa.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              <span>Abrir conversa por este número</span>
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* Painel Expansível de Conexão de QR Code do Vendedor */}
      {showConnectPanel && (
        <div className="pt-2">
          <WhatsappConnectionsPanel compact />
        </div>
      )}
    </div>
  );
}
