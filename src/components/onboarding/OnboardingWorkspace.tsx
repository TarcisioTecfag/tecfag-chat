import React from "react";
import {
  Bot,
  Briefcase,
  Building2,
  CheckSquare,
  FileText,
  Home,
  MessageSquare,
  Phone,
  Play,
  QrCode,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import { useOnboarding } from "@/hooks/useOnboarding";
import {
  DEMO_ACCOUNTS,
  DEMO_CONTACTS,
  DEMO_CONVERSATIONS,
  DEMO_DEALS,
  DEMO_DIRECTIVES,
  DEMO_PERSONAL_TEMPLATES,
  DEMO_TASKS,
  FAGNER_DEMO_SOURCE_RESPONSES,
} from "@/lib/onboarding/fixtures";
import { OnboardingDemoBoundary } from "./OnboardingDemoBoundary";

const SOURCE_STATE_LABELS: Record<
  keyof typeof FAGNER_DEMO_SOURCE_RESPONSES,
  { badge: string; color: string }
> = {
  verified: {
    badge: "Ficha Técnica Verificada",
    color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  },
  catalog_only: {
    badge: "Apenas Catálogo Comercial",
    color: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  },
  honest_unknown: {
    badge: "Desconhecimento Honesto",
    color: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  },
  unverified_technical: {
    badge: "Alerta: Dado Não Homologado",
    color: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  },
  operational_or_chat: {
    badge: "Contexto Operacional / Atendimento",
    color: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  },
};

export function OnboardingWorkspace() {
  const {
    isRunnerActive,
    currentStep,
    demoState,
    personaName,
    dispatchCommand,
    satisfyCurrentInteractiveStep,
    nextStep,
  } = useOnboarding();

  if (!isRunnerActive || !currentStep) return null;

  // Welcome & Finish dialogs have their own dedicated modals
  if (
    currentStep.surface === "welcome.modal" ||
    currentStep.surface === "welcomeDialog" ||
    currentStep.surface === "finish.modal" ||
    currentStep.surface === "completionDialog"
  ) {
    return null;
  }

  const activeConversation =
    DEMO_CONVERSATIONS.find(
      (c) => c.id === demoState.chat.selectedConversationId,
    ) ?? DEMO_CONVERSATIONS[0];

  const activeDeal =
    DEMO_DEALS.find((d) => d.id === demoState.crm.dealDetailId) ??
    DEMO_DEALS[0];

  const activeContact = DEMO_CONTACTS[0];
  const activeAccount = DEMO_ACCOUNTS[0];

  const sourceStateKey =
    demoState.activeFagnerTechnicalState ?? demoState.chat.sourceInspectorState;
  const sourceMeta = SOURCE_STATE_LABELS[sourceStateKey];
  const sourceEntry = FAGNER_DEMO_SOURCE_RESPONSES[sourceStateKey];
  const rawSelectorValue = currentStep.target.selector;
  const isInteractiveMode =
    currentStep.mode === "I" || currentStep.mode === "interactive_demo";

  const handleInteractiveTrigger = async () => {
    if (currentStep.completion.demoAction) {
      await dispatchCommand({
        surface: currentStep.surface,
        name: currentStep.completion.demoAction,
        command: currentStep.completion.demoAction,
        params: currentStep.completion.demoPayload ?? { stepId: currentStep.id },
      });
    }
    satisfyCurrentInteractiveStep();
    if (isInteractiveMode) {
      await nextStep();
    }
  };

  return (
    <div
      data-tour-fallback-stage="true"
      className="pointer-events-auto fixed bottom-4 left-20 z-[10085] w-[min(680px,calc(100vw-6rem))] rounded-2xl border border-slate-700/90 bg-slate-900/95 p-3.5 text-slate-100 shadow-2xl backdrop-blur-xl"
    >
      <OnboardingDemoBoundary active={true}>
        <div className="flex flex-col gap-2.5">
          {/* Active Target Sandbox Anchor: always exposes the exact currentStep.target.selector in the demo stage */}
          <div
            data-tour={rawSelectorValue}
            onClick={() => void handleInteractiveTrigger()}
            className="group cursor-pointer rounded-xl border border-primary/50 bg-slate-950/90 p-3 transition hover:border-primary"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
                  {currentStep.view === "commercialHome" && (
                    <Home className="h-4 w-4" />
                  )}
                  {currentStep.view === "chat" && (
                    <MessageSquare className="h-4 w-4" />
                  )}
                  {currentStep.view === "crm" && (
                    <Briefcase className="h-4 w-4" />
                  )}
                  {currentStep.view === "tasks" && (
                    <CheckSquare className="h-4 w-4" />
                  )}
                  {currentStep.view === "contacts" && (
                    <Users className="h-4 w-4" />
                  )}
                  {currentStep.view === "wallet" && (
                    <Wallet className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-bold text-white">
                      {currentStep.title}
                    </span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                      {currentStep.targetSelector}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-slate-400">
                    Superfície: {currentStep.surface} • Dados demonstrativos isolados em memória
                  </p>
                </div>
              </div>

              {isInteractiveMode && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-500/20 px-2.5 py-1 text-[11px] font-bold text-amber-300 group-hover:bg-amber-500/30">
                  <Play className="h-3 w-3 fill-current" />
                  Clique para testar
                </span>
              )}
            </div>

            {/* Contextual Live Preview of the In-Memory Demo State */}
            <div className="mt-2.5 grid grid-cols-1 gap-2 border-t border-slate-800/90 pt-2.5 text-xs sm:grid-cols-2">
              {currentStep.view === "commercialHome" && (
                <>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="text-[10px] font-semibold uppercase text-slate-400">
                      Filtro & Diretiva Demo
                    </div>
                    <div className="mt-0.5 font-bold text-slate-100">
                      Filtro: {demoState.home.activeFilter.toUpperCase()} • {DEMO_DIRECTIVES[0]?.dealTitle}
                    </div>
                    <div className="mt-0.5 text-[11px] text-emerald-400">
                      Status: {DEMO_DIRECTIVES[0]?.status} • Prioridade {DEMO_DIRECTIVES[0]?.priority}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="text-[10px] font-semibold uppercase text-slate-400">
                      Resumo Operacional Demo
                    </div>
                    <div className="mt-0.5 font-bold text-slate-100">
                      {DEMO_CONVERSATIONS.length} Conversas • {DEMO_DEALS.length} Negócios • {DEMO_TASKS.length} Tarefas
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {personaName} pronto para consulta técnica e comercial
                    </div>
                  </div>
                </>
              )}

              {currentStep.view === "chat" &&
                (currentStep.chapterId === "profile" ? (
                  <>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-slate-400">
                        <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Perfil & Status Operacional (Demo)</span>
                      </div>
                      <div className="mt-0.5 font-bold text-slate-100">
                        {demoState.operatorName} (consultor.demo@tecfag.exemplo.br)
                      </div>
                      <div className="mt-0.5 text-[11px] text-emerald-400">
                        Aba: {demoState.profile.activeTab.toUpperCase()} • Tema: {demoState.profile.previewTheme}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-slate-400">
                        <FileText className="h-3.5 w-3.5 text-sky-400" />
                        <span>Templates Pessoais ({DEMO_PERSONAL_TEMPLATES.length})</span>
                      </div>
                      <div className="mt-0.5 truncate font-bold text-slate-100">
                        {DEMO_PERSONAL_TEMPLATES[0]?.title}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        Notificações Web Push: {demoState.profile.notificationsPromptOpen ? "Em Demonstração" : "Configuráveis"}
                      </div>
                    </div>
                  </>
                ) : currentStep.id.startsWith("chat.fagner") ||
                  currentStep.surface === "chat.assistant" ||
                  currentStep.surface === "assistantModal" ||
                  currentStep.surface === "chat.source-popover" ? (
                  <div className="col-span-2 rounded-lg border border-slate-800 bg-slate-900/90 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                        <Bot className="h-4 w-4 text-primary" />
                        <span>{personaName} — Consulta Técnica & Comercial</span>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${sourceMeta.color}`}
                      >
                        {sourceMeta.badge}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] font-medium text-sky-300">
                      Fonte: {sourceEntry.sourceRef}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[11px] text-slate-300">
                      {sourceEntry.answer}
                    </p>
                  </div>
                ) : currentStep.id.startsWith("chat.personal-whatsapp") ||
                  currentStep.surface === "chat.personal-whatsapp" ||
                  currentStep.surface === "personalWhatsappModal" ? (
                  <>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-slate-400">
                        <Phone className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Meu WhatsApp (Baileys Individual)</span>
                      </div>
                      <div className="mt-0.5 font-bold text-slate-100">
                        Status: {demoState.personalWhatsappStatus.toUpperCase()}
                      </div>
                      <div className="mt-0.5 text-[11px] text-emerald-400">
                        Número: {demoState.personalWhatsappPhone}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                      <QrCode className="h-8 w-8 shrink-0 text-primary" />
                      <div className="text-[11px] text-slate-300">
                        Pareamento QR simulado sem desconectar nenhuma sessão real.
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                      <div className="text-[10px] font-semibold uppercase text-slate-400">
                        Conversa Demo Selecionada ({demoState.chat.activeQueue})
                      </div>
                      <div className="mt-0.5 font-bold text-slate-100">
                        {activeConversation?.contactName} ({activeConversation?.companyName})
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-400">
                        {activeConversation?.lastMessagePreview}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                      <div className="text-[10px] font-semibold uppercase text-slate-400">
                        Negócio Vinculado & Composer
                      </div>
                      <div className="mt-0.5 font-bold text-emerald-400">
                        {activeDeal?.title} (R$ {activeDeal?.value.toLocaleString("pt-BR")})
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-300">
                        Rascunho: {demoState.chat.composerDraft || "Pronto para resposta ou nota interna"}
                      </div>
                    </div>
                  </>
                ))}

              {currentStep.view === "crm" && (
                <>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="text-[10px] font-semibold uppercase text-slate-400">
                      Negócio em Foco ({demoState.crm.activeView.toUpperCase()})
                    </div>
                    <div className="mt-0.5 font-bold text-slate-100">
                      {activeDeal?.title}
                    </div>
                    <div className="mt-0.5 text-[11px] text-emerald-400">
                      Etapa: {activeDeal?.stageName} • R$ {activeDeal?.value.toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="text-[10px] font-semibold uppercase text-slate-400">
                      Aba da Ficha & Mini Chat
                    </div>
                    <div className="mt-0.5 font-bold text-slate-100">
                      Aba ativa: {demoState.crm.dealDetailTab}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      Mini Chat: {demoState.crm.miniChatOpen ? "Aberto" : "Pronto"}
                    </div>
                  </div>
                </>
              )}

              {currentStep.view === "tasks" && (
                <>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="text-[10px] font-semibold uppercase text-slate-400">
                      Visualização Ativa: {demoState.tasks.viewMode.toUpperCase()}
                    </div>
                    <div className="mt-0.5 font-bold text-slate-100">
                      {DEMO_TASKS[0]?.subject}
                    </div>
                    <div className="mt-0.5 text-[11px] text-amber-300">
                      Tipo: {DEMO_TASKS[0]?.type} • Status: {DEMO_TASKS[0]?.status}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="text-[10px] font-semibold uppercase text-slate-400">
                      Totais da Agenda Demo
                    </div>
                    <div className="mt-0.5 font-bold text-slate-100">
                      {DEMO_TASKS.filter((t) => t.status === "pending").length} Pendentes •{" "}
                      {DEMO_TASKS.filter((t) => t.status === "completed").length} Concluídas
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      Apenas tipos operacionais (Tarefa, Ligação, Reunião, Almoço / Visita)
                    </div>
                  </div>
                </>
              )}

              {currentStep.view === "contacts" && (
                <>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="text-[10px] font-semibold uppercase text-slate-400">
                      Aba de Contatos: {demoState.contacts.activeTab.toUpperCase()}
                    </div>
                    <div className="mt-0.5 font-bold text-slate-100">
                      {activeContact?.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {activeContact?.phone} • {activeContact?.accountName}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-slate-400">
                      <Building2 className="h-3.5 w-3.5 text-primary" />
                      <span>Empresa Vinculada (CNPJ)</span>
                    </div>
                    <div className="mt-0.5 font-bold text-slate-100">
                      {activeAccount?.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-emerald-400">
                      {activeAccount?.cnpj} • {activeAccount?.city}/{activeAccount?.state}
                    </div>
                  </div>
                </>
              )}

              {currentStep.view === "wallet" && (
                <>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="text-[10px] font-semibold uppercase text-slate-400">
                      Minha Carteira ({demoState.wallet.activeTab.toUpperCase()})
                    </div>
                    <div className="mt-0.5 font-bold text-slate-100">
                      {DEMO_CONTACTS.length} Clientes Fidelizados
                    </div>
                    <div className="mt-0.5 text-[11px] text-emerald-400">
                      Atendimento prioritário vinculado à sua carteira
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                    <div className="text-[10px] font-semibold uppercase text-slate-400">
                      Cliente Destacado
                    </div>
                    <div className="mt-0.5 font-bold text-slate-100">
                      {activeContact?.name} ({activeContact?.accountName})
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      Ação rápida: Abrir Conversa ou Remover Vínculo (Demo)
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </OnboardingDemoBoundary>
    </div>
  );
}
