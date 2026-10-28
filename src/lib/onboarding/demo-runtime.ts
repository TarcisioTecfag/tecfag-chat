import { createOnboardingDemoFixtures, type KnowledgeSourceStatusDemo } from "./fixtures";
import type { TourCommand } from "./types";
import { SUPPORTED_TOUR_COMMANDS } from "./command-names";

export function isDemoIdentifier(value: unknown): boolean {
  return typeof value === "string" && value.trim().startsWith("demo:");
}

export interface OnboardingDemoRuntimeState {
  tenantId: string;
  operatorName: string;
  lastFeedback: string | null;
  lastSimulatedNote: string;
  interactionLog: string[];
  activeFagnerTechnicalState: KnowledgeSourceStatusDemo;
  fagnerDirectivePinned: boolean;
  profileSavedBanner: boolean;
  personalWhatsappStatus: "connected" | "qr_ready" | "pairing_code_ready" | "disconnected";
  personalWhatsappPhone: string;
  personalWhatsappConnection: {
    status: "connected" | "qr_ready" | "pairing_code_ready" | "disconnected";
    qrPreview: string | null;
    pairingCodePreview: string | null;
    phone: string;
  };

  home: {
    activeFilter: "Todas" | "Atrasadas" | "Alta" | "Hoje" | "Concluídas";
    goalConfigured: boolean;
    agendaModalOpen: boolean;
    evidenceDialogOpen: boolean;
    evidenceChannel: "call" | "whatsapp";
    evidenceStep: 1 | 2;
    outcomeType: "continue" | "won" | "lost";
    selectedCalendarDay: number;
    callReportDraft: string;
  };

  chat: {
    mobilePane: "list" | "thread" | "details";
    searchQuery: string;
    channelFilter: "all" | "whatsapp" | "instagram" | "messenger" | "livechat";
    activeQueue: "meus" | "todos" | "fila" | "automacao" | "finalizados";
    rowMenuOpenForId: string | null;
    selectedConversationId: string;
    ownershipMode: "self" | "colleague" | "none";
    senderPickerOpen: boolean;
    showUnifiedHistory: boolean;
    personalWhatsappOpen: boolean;
    personalWhatsappView: "connected" | "policy" | "qr_demo";
    rightDetailsOpen: boolean;
    rightDetailsTab: "details" | "files" | "events";
    contactEditorOpen: boolean;
    cnpjRegistrationOpen: boolean;
    journeyModalOpen: boolean;
    journeyActiveTab: "info" | "pages" | "journey";
    detailsTaskCreatorOpen: boolean;
    linkedDealEditorId: string | null;
    linkedDealsPickerOpen: boolean;
    linkedDealCreateOpen: boolean;
    showSystemAnnotations: boolean;
    expandedSystemEventId: string | null;
    threadSearchOpen: boolean;
    threadSearchQuery: string;
    transferDialogOpen: boolean;
    dealContextRequirementOpen: boolean;
    finishDialogOpen: boolean;
    replyingToMessageId: string | null;
    reactionPickerMessageId: string | null;
    markEvidenceModalOpen: boolean;
    sourceInspectorOpen: boolean;
    sourceInspectorState: KnowledgeSourceStatusDemo;
    mediaPreviewOpen: boolean;
    audioPlayerReady: boolean;
    attachmentsReady: boolean;
    audioRecorderState: "idle" | "recording" | "preview";
    emojiPickerOpen: boolean;
    quickResponsesOpen: boolean;
    quickResponsesTab: "all" | "global" | "mine";
    quickPersonalEditorOpen: boolean;
    internalNoteMode: boolean;
    inlineAssistantOpen: boolean;
    inlineAssistantTab: "best_response" | "grammar_fix" | "lead_summary" | "result";
    catalogPickerOpen: boolean;
    catalogHasSelection: boolean;
    metaWindowState: "open" | "closed" | "checking";
    meta24hHelpOpen: boolean;
    metaTemplatesOpen: boolean;
    metaTemplatePreviewOpen: boolean;
    assistantShowPreviousHistory: boolean;
    assistantCycleReset: boolean;
    composerDraft: string;
  };

  crm: {
    activeView: "kanban" | "list";
    selectedPipelineId: string;
    searchQuery: string;
    globalSearchOpen: boolean;
    statusFilterOpen: boolean;
    ownerFilterOpen: boolean;
    sortMenuOpen: boolean;
    advancedFiltersOpen: boolean;
    advancedFilterSection: "stages" | "work" | "fields" | "relations" | "dates";
    hasActiveFilterChips: boolean;
    createMenuOpen: boolean;
    createDealDialogOpen: boolean;
    createDealSection: "core" | "account" | "contact" | "extra";
    quickCreateKind: "company" | "contact" | null;
    cardMenuDealId: string | null;
    terminalDialogOpen: boolean;
    terminalDialogKind: "won" | "lost";
    listSelectionMode: "none" | "page" | "allFiltered";
    bulkDialogKind:
      "transfer" | "status" | "fields" | "create" | "move" | "export" | "delete" | null;
    dealDetailOpen: boolean;
    dealDetailId: string;
    dealDetailTab: "tasks" | "history" | "conversations" | "evidence" | "products" | "files";
    dealNoteEditorOpen: boolean;
    dealHistoryFilter: "all" | "rd_marketing";
    dealParticipantsDrawerOpen: boolean;
    dealAccountDrawerOpen: boolean;
    filePreviewOpen: boolean;
    miniChatOpen: boolean;
    miniChatView: "list" | "thread";
    miniChatAudioDemo: boolean;
    miniChatMetaClosed: boolean;
    miniChatContextMenuOpen: boolean;
  };

  tasks: {
    viewMode: "month" | "week" | "day";
    selectedDateISO: string;
    dayFilter: "Todas" | "Pendentes" | "Atrasadas" | "Concluídas";
    allModalOpen: boolean;
    createModalOpen: boolean;
  };

  contacts: {
    activeTab: "all" | "whatsapp" | "instagram" | "messenger" | "livechat" | "companies";
    searchQuery: string;
    createDrawerOpen: boolean;
    hasDuplicateWarning: boolean;
    dealResolutionOpen: boolean;
    editDrawerOpen: boolean;
    conversationSearchOpen: boolean;
    companyCreateDrawerOpen: boolean;
    accountDetailOpen: boolean;
    accountDetailTab: "details" | "contacts" | "deals" | "conversations" | "history";
    accountShowCnpj: boolean;
  };

  wallet: {
    activeTab: "wallet" | "templates";
    hasInactivityRisk: boolean;
    searchQuery: string;
    removeDialogOpen: boolean;
    templateEditorOpen: boolean;
    templateDeleteOpen: boolean;
  };

  profile: {
    surfaceOpen: boolean;
    activeTab: "perfil" | "aparencia";
    avatarPickerOpen: boolean;
    statusHelpOpen: boolean;
    statusHelpPage: 0 | 1 | 2;
    notificationsPromptOpen: boolean;
    previewTheme: "light" | "dark" | "voice" | "system";
    previewDensity: "auto" | "75" | "85" | "100";
    completionModalOpen: boolean;
    completionStage: "review" | "confirm" | "epilogue";
  };
}

export function createInitialDemoRuntimeState(
  tenantId?: string | null | undefined,
  operatorName?: string,
): OnboardingDemoRuntimeState {
  const fixtures = createOnboardingDemoFixtures(tenantId || "tecfag", operatorName);
  return {
    tenantId: tenantId || "tecfag",
    operatorName: fixtures.operatorName,
    lastFeedback: null,
    lastSimulatedNote: "Ambiente de demonstração inicializado.",
    interactionLog: [],
    activeFagnerTechnicalState: "verified",
    fagnerDirectivePinned: false,
    profileSavedBanner: false,
    personalWhatsappStatus: "connected",
    personalWhatsappPhone: "+55 11 98888-0199",
    personalWhatsappConnection: {
      status: "connected",
      qrPreview: null,
      pairingCodePreview: null,
      phone: "+55 11 98888-0199",
    },

    home: {
      activeFilter: "Todas",
      goalConfigured: true,
      agendaModalOpen: false,
      evidenceDialogOpen: false,
      evidenceChannel: "call",
      evidenceStep: 1,
      outcomeType: "continue",
      selectedCalendarDay: 15,
      callReportDraft:
        "Contato realizado com o gerente industrial; confirmada rede 220V bifásica e interesse na VSF.",
    },

    chat: {
      mobilePane: "list",
      searchQuery: "",
      channelFilter: "all",
      activeQueue: "meus",
      rowMenuOpenForId: null,
      selectedConversationId: "demo:conv-1",
      ownershipMode: "self",
      senderPickerOpen: false,
      showUnifiedHistory: false,
      personalWhatsappOpen: false,
      personalWhatsappView: "connected",
      rightDetailsOpen: true,
      rightDetailsTab: "details",
      contactEditorOpen: false,
      cnpjRegistrationOpen: false,
      journeyModalOpen: false,
      journeyActiveTab: "info",
      detailsTaskCreatorOpen: false,
      linkedDealEditorId: null,
      linkedDealsPickerOpen: false,
      linkedDealCreateOpen: false,
      showSystemAnnotations: false,
      expandedSystemEventId: null,
      threadSearchOpen: false,
      threadSearchQuery: "",
      transferDialogOpen: false,
      dealContextRequirementOpen: false,
      finishDialogOpen: false,
      replyingToMessageId: null,
      reactionPickerMessageId: null,
      markEvidenceModalOpen: false,
      sourceInspectorOpen: false,
      sourceInspectorState: "verified",
      mediaPreviewOpen: false,
      audioPlayerReady: false,
      attachmentsReady: false,
      audioRecorderState: "idle",
      emojiPickerOpen: false,
      quickResponsesOpen: false,
      quickResponsesTab: "all",
      quickPersonalEditorOpen: false,
      internalNoteMode: false,
      inlineAssistantOpen: false,
      inlineAssistantTab: "best_response",
      catalogPickerOpen: false,
      catalogHasSelection: false,
      metaWindowState: "open",
      meta24hHelpOpen: false,
      metaTemplatesOpen: false,
      metaTemplatePreviewOpen: false,
      assistantShowPreviousHistory: false,
      assistantCycleReset: false,
      composerDraft: "Olá Carlos! Confirmo que a Envasadora VSF atende pacotes de 500g a 1kg.",
    },

    crm: {
      activeView: "kanban",
      selectedPipelineId: "demo:pipeline-1",
      searchQuery: "",
      globalSearchOpen: false,
      statusFilterOpen: false,
      ownerFilterOpen: false,
      sortMenuOpen: false,
      advancedFiltersOpen: false,
      advancedFilterSection: "stages",
      hasActiveFilterChips: false,
      createMenuOpen: false,
      createDealDialogOpen: false,
      createDealSection: "core",
      quickCreateKind: null,
      cardMenuDealId: null,
      terminalDialogOpen: false,
      terminalDialogKind: "won",
      listSelectionMode: "none",
      bulkDialogKind: null,
      dealDetailOpen: false,
      dealDetailId: "demo:deal-1",
      dealDetailTab: "tasks",
      dealNoteEditorOpen: false,
      dealHistoryFilter: "all",
      dealParticipantsDrawerOpen: false,
      dealAccountDrawerOpen: false,
      filePreviewOpen: false,
      miniChatOpen: false,
      miniChatView: "list",
      miniChatAudioDemo: false,
      miniChatMetaClosed: false,
      miniChatContextMenuOpen: false,
    },

    tasks: {
      viewMode: "month",
      selectedDateISO: "2026-10-27",
      dayFilter: "Todas",
      allModalOpen: false,
      createModalOpen: false,
    },

    contacts: {
      activeTab: "all",
      searchQuery: "",
      createDrawerOpen: false,
      hasDuplicateWarning: false,
      dealResolutionOpen: false,
      editDrawerOpen: false,
      conversationSearchOpen: false,
      companyCreateDrawerOpen: false,
      accountDetailOpen: false,
      accountDetailTab: "details",
      accountShowCnpj: false,
    },

    wallet: {
      activeTab: "wallet",
      hasInactivityRisk: true,
      searchQuery: "",
      removeDialogOpen: false,
      templateEditorOpen: false,
      templateDeleteOpen: false,
    },

    profile: {
      surfaceOpen: false,
      activeTab: "perfil",
      avatarPickerOpen: false,
      statusHelpOpen: false,
      statusHelpPage: 0,
      notificationsPromptOpen: false,
      previewTheme: "dark",
      previewDensity: "auto",
      completionModalOpen: false,
      completionStage: "review",
    },
  };
}

export function applyTourCommandToDemoState(
  prev: OnboardingDemoRuntimeState,
  command?: TourCommand,
): OnboardingDemoRuntimeState {
  if (!command) return prev;
  const cmdName = command.name ?? command.type ?? command.command ?? "noop";
  if (!SUPPORTED_TOUR_COMMANDS.has(cmdName))
    throw Error(`Comando de demonstração não implementado: ${cmdName}`);
  const params = (command.params ?? command.payload ?? {}) as Record<string, any>;
  const next: OnboardingDemoRuntimeState = structuredClone(prev);
  next.lastSimulatedNote = `Comando simulado: ${cmdName}`;

  switch (cmdName) {
    case "openWelcomeModal":
    case "focusPrimaryShell":
      break;

    case "setHomeFilter":
      if (typeof params.filter === "string") {
        next.home.activeFilter =
          params.filter as OnboardingDemoRuntimeState["home"]["activeFilter"];
      }
      break;

    case "toggleHomeGoalState":
      next.home.goalConfigured = Boolean(params.configured ?? true);
      break;

    case "openHomeAgendaModal":
      next.home.agendaModalOpen = Boolean(params.open);
      break;

    case "openHomeEvidenceDialog":
      next.home.evidenceDialogOpen = Boolean(params.open);
      break;

    case "setHomeEvidenceChannel":
      next.home.evidenceDialogOpen = Boolean(params.open ?? true);
      next.home.evidenceChannel = params.channel === "whatsapp" ? "whatsapp" : "call";
      next.home.evidenceStep = params.step === 2 ? 2 : 1;
      break;

    case "advanceHomeEvidenceStep":
      next.home.evidenceDialogOpen = true;
      next.home.evidenceStep = params.step === 2 ? 2 : 1;
      break;

    case "setHomeOutcomeType":
      next.home.evidenceDialogOpen = true;
      next.home.evidenceStep = 2;
      next.home.outcomeType =
        params.outcome === "won" ? "won" : params.outcome === "lost" ? "lost" : "continue";
      break;

    case "selectHomeCalendarDay":
      if (params.closeEvidence) next.home.evidenceDialogOpen = false;
      if (typeof params.day === "number") next.home.selectedCalendarDay = params.day;
      break;

    case "setChatViewState":
      if (
        params.mobilePane === "list" ||
        params.mobilePane === "thread" ||
        params.mobilePane === "details"
      ) {
        next.chat.mobilePane = params.mobilePane;
      }
      break;

    case "setDemoQueue":
      if (typeof params.queue === "string") {
        next.chat.activeQueue = params.queue as OnboardingDemoRuntimeState["chat"]["activeQueue"];
      }
      break;

    case "setDemoChannelFilter":
      if (typeof params.channel === "string") {
        next.chat.channelFilter =
          params.channel as OnboardingDemoRuntimeState["chat"]["channelFilter"];
      }
      break;

    case "openDemoRowMenu":
      next.chat.rowMenuOpenForId =
        typeof params.conversationId === "string" ? params.conversationId : "demo:conv-1";
      break;

    case "selectDemoAssistant":
      next.chat.selectedConversationId = "valentina";
      next.chat.rightDetailsOpen = false;
      next.chat.mobilePane = "thread";
      break;

    case "setAssistantHistoryFilter":
      next.chat.selectedConversationId = "valentina";
      next.chat.assistantShowPreviousHistory = Boolean(params.showPrevious);
      break;

    case "resetDemoAssistantCycle":
      next.chat.selectedConversationId = "valentina";
      next.chat.assistantCycleReset = true;
      break;

    case "openDemoConversation":
      next.chat.selectedConversationId =
        typeof params.conversationId === "string" ? params.conversationId : "demo:conv-1";
      next.chat.ownershipMode =
        params.owner === "colleague" ? "colleague" : params.owner === "none" ? "none" : "self";
      next.chat.mobilePane = "thread";
      break;

    case "openWhatsappSenderPicker":
      next.chat.senderPickerOpen = Boolean(params.open);
      next.chat.showUnifiedHistory = Boolean(params.showHistory);
      break;

    case "openPersonalConnections":
      next.chat.personalWhatsappOpen = Boolean(params.open);
      if (params.state === "connected") next.chat.personalWhatsappView = "connected";
      break;

    case "setPersonalWhatsappDemoState":
      next.chat.personalWhatsappOpen = true;
      next.chat.personalWhatsappView =
        params.view === "policy" ? "policy" : params.view === "qr_demo" ? "qr_demo" : "connected";
      break;

    case "toggleRightDetailsPanel":
      next.chat.rightDetailsOpen = Boolean(params.open ?? !next.chat.rightDetailsOpen);
      break;

    case "toggleSystemAnnotations":
      next.chat.showSystemAnnotations = Boolean(params.show ?? true);
      break;

    case "expandSystemAnnotation":
      next.chat.showSystemAnnotations = true;
      next.chat.expandedSystemEventId =
        typeof params.eventId === "string" ? params.eventId : "demo:sys-event-1";
      break;

    case "openThreadSearch":
      next.chat.threadSearchOpen = Boolean(params.open);
      next.chat.threadSearchQuery = typeof params.query === "string" ? params.query : "VSF";
      break;

    case "setDemoAttendanceOwnership":
      next.chat.ownershipMode =
        params.owner === "colleague" ? "colleague" : params.owner === "none" ? "none" : "self";
      if (params.queueState === "fila") next.chat.activeQueue = "fila";
      if (params.queueState === "finalizados") next.chat.activeQueue = "finalizados";
      break;

    case "openTransferDialog":
      next.chat.transferDialogOpen = Boolean(params.open);
      break;

    case "openDealContextRequirement":
      next.chat.transferDialogOpen = false;
      next.chat.dealContextRequirementOpen = Boolean(params.open);
      break;

    case "openFinishAttendanceDialog":
      next.chat.dealContextRequirementOpen = false;
      next.chat.finishDialogOpen = Boolean(params.open);
      break;

    case "setMessageReplyDemo":
      next.chat.finishDialogOpen = false;
      next.chat.replyingToMessageId =
        typeof params.messageId === "string" ? params.messageId : "demo:msg-inbound-1";
      break;

    case "openMessageReactionDemo":
      next.chat.reactionPickerMessageId =
        typeof params.messageId === "string" ? params.messageId : "demo:msg-inbound-1";
      break;

    case "openMarkEvidenceModal":
      next.chat.markEvidenceModalOpen = Boolean(params.open);
      break;

    case "openMessageSourceInspector":
      next.chat.markEvidenceModalOpen = false;
      next.chat.selectedConversationId = "valentina";
      next.chat.sourceInspectorOpen = Boolean(params.open);
      break;

    case "cycleMessageSourceState":
      next.chat.selectedConversationId = "valentina";
      next.chat.sourceInspectorOpen = Boolean(params.open ?? true);
      next.chat.sourceInspectorState = (params.state as KnowledgeSourceStatusDemo) || "verified";
      break;

    case "openMediaPreviewDemo":
      next.chat.sourceInspectorOpen = false;
      next.chat.selectedConversationId = "demo:conv-1";
      next.chat.mediaPreviewOpen = true;
      break;

    case "prepareAudioPlayerDemo":
      next.chat.mediaPreviewOpen = false;
      next.chat.audioPlayerReady = true;
      break;

    case "prepareAttachmentsDemo":
      next.chat.attachmentsReady = Boolean(params.hasFiles ?? true);
      break;

    case "prepareAudioRecorderDemo":
      next.chat.audioRecorderState =
        params.state === "recording"
          ? "recording"
          : params.state === "preview"
            ? "preview"
            : "idle";
      break;

    case "openEmojiPickerDemo":
      next.chat.emojiPickerOpen = Boolean(params.open);
      break;

    case "openQuickResponsesDemo":
      next.chat.emojiPickerOpen = false;
      next.chat.quickResponsesOpen = Boolean(params.open);
      next.chat.quickPersonalEditorOpen = false;
      next.chat.quickResponsesTab =
        params.tab === "global" ? "global" : params.tab === "mine" ? "mine" : "all";
      break;

    case "openQuickResponsePersonalEditor":
      next.chat.quickResponsesOpen = true;
      next.chat.quickPersonalEditorOpen = Boolean(params.open);
      break;

    case "setInternalNoteMode":
      next.chat.quickResponsesOpen = false;
      next.chat.internalNoteMode = Boolean(params.enabled);
      break;

    case "openInlineAssistantDemo":
      next.chat.inlineAssistantOpen = Boolean(params.open);
      break;

    case "setInlineAssistantTab":
      next.chat.inlineAssistantOpen = true;
      next.chat.inlineAssistantTab =
        params.action === "grammar_fix"
          ? "grammar_fix"
          : params.action === "lead_summary"
            ? "lead_summary"
            : params.action === "result"
              ? "result"
              : "best_response";
      break;

    case "openCatalogPickerDemo":
      next.chat.inlineAssistantOpen = false;
      next.chat.catalogPickerOpen = Boolean(params.open);
      next.chat.catalogHasSelection = Boolean(params.hasSelection);
      break;

    case "setMetaWindowState":
      next.chat.catalogPickerOpen = false;
      next.chat.metaWindowState =
        params.state === "closed" ? "closed" : params.state === "checking" ? "checking" : "open";
      break;

    case "openMeta24hHelpDemo":
      next.chat.meta24hHelpOpen = Boolean(params.open);
      break;

    case "openMetaTemplatesModal":
      next.chat.meta24hHelpOpen = false;
      next.chat.metaTemplatesOpen = Boolean(params.open);
      next.chat.metaTemplatePreviewOpen = false;
      break;

    case "openMetaTemplatePreview":
      next.chat.metaTemplatesOpen = true;
      next.chat.metaTemplatePreviewOpen = Boolean(params.open);
      break;

    case "openDetailsTab":
      next.chat.metaTemplatesOpen = false;
      next.chat.journeyModalOpen = false;
      next.chat.selectedConversationId = "demo:conv-1";
      next.chat.rightDetailsOpen = Boolean(params.open ?? true);
      next.chat.mobilePane = "details";
      next.chat.rightDetailsTab =
        params.tab === "files" ? "files" : params.tab === "events" ? "events" : "details";
      break;

    case "openContactEditorInDetails":
      next.chat.rightDetailsOpen = true;
      next.chat.rightDetailsTab = "details";
      next.chat.contactEditorOpen = Boolean(params.editing);
      break;

    case "openCnpjRegistrationInDetails":
      next.chat.rightDetailsOpen = true;
      next.chat.contactEditorOpen = false;
      next.chat.cnpjRegistrationOpen = Boolean(params.open);
      break;

    case "openJourneyModal":
      next.chat.journeyModalOpen = Boolean(params.open);
      next.chat.journeyActiveTab = "info";
      break;

    case "openJourneyTab":
      next.chat.journeyModalOpen = true;
      next.chat.journeyActiveTab =
        params.tab === "pages" ? "pages" : params.tab === "journey" ? "journey" : "info";
      break;

    case "openDetailsTaskCreator":
      next.chat.journeyModalOpen = false;
      next.chat.rightDetailsOpen = true;
      next.chat.detailsTaskCreatorOpen = Boolean(params.open);
      break;

    case "openLinkedDealsEditor":
      next.chat.rightDetailsOpen = true;
      next.chat.linkedDealEditorId =
        typeof params.dealId === "string" ? params.dealId : "demo:deal-1";
      break;

    case "openLinkedDealsPicker":
      next.chat.linkedDealEditorId = null;
      next.chat.linkedDealsPickerOpen = Boolean(params.open);
      break;

    case "openLinkedDealCreate":
      next.chat.linkedDealsPickerOpen = false;
      next.chat.linkedDealCreateOpen = Boolean(params.open);
      break;

    case "setCrmView":
      next.crm.dealDetailOpen = false;
      next.crm.activeView = params.view === "list" ? "list" : "kanban";
      break;

    case "openCrmGlobalSearch":
      next.crm.globalSearchOpen = Boolean(params.open);
      break;

    case "openCrmStatusFilter":
      next.crm.globalSearchOpen = false;
      next.crm.statusFilterOpen = Boolean(params.open);
      break;

    case "openCrmOwnerFilter":
      next.crm.statusFilterOpen = false;
      next.crm.ownerFilterOpen = Boolean(params.open);
      break;

    case "openCrmSortMenu":
      next.crm.ownerFilterOpen = false;
      next.crm.sortMenuOpen = Boolean(params.open);
      break;

    case "openCrmAdvancedFilters":
      next.crm.sortMenuOpen = false;
      next.crm.advancedFiltersOpen = Boolean(params.open);
      break;

    case "setCrmAdvancedFilterSection":
      next.crm.advancedFiltersOpen = true;
      next.crm.advancedFilterSection =
        (params.section as OnboardingDemoRuntimeState["crm"]["advancedFilterSection"]) || "stages";
      break;

    case "applyCrmFilterChipsDemo":
      next.crm.advancedFiltersOpen = false;
      next.crm.hasActiveFilterChips = Boolean(params.hasChips);
      break;

    case "openCrmCreateMenu":
      next.crm.createMenuOpen = Boolean(params.open);
      break;

    case "openCreateDealDialog":
      next.crm.createMenuOpen = false;
      next.crm.createDealDialogOpen = Boolean(params.open);
      next.crm.createDealSection = "core";
      break;

    case "setCreateDealSection":
      next.crm.createDealDialogOpen = true;
      next.crm.createDealSection =
        (params.section as OnboardingDemoRuntimeState["crm"]["createDealSection"]) || "core";
      break;

    case "openCrmQuickCreate":
      next.crm.createDealDialogOpen = false;
      next.crm.quickCreateKind =
        params.kind === "company" ? "company" : params.kind === "contact" ? "contact" : null;
      break;

    case "openDealCardMenu":
      next.crm.quickCreateKind = null;
      next.crm.cardMenuDealId = typeof params.dealId === "string" ? params.dealId : "demo:deal-1";
      break;

    case "openTerminalStageDialog":
      next.crm.cardMenuDealId = null;
      next.crm.terminalDialogOpen = Boolean(params.open);
      next.crm.terminalDialogKind = params.kind === "lost" ? "lost" : "won";
      break;

    case "setDealListSelectionDemo":
      next.crm.activeView = "list";
      next.crm.listSelectionMode =
        params.mode === "allFiltered" ? "allFiltered" : params.mode === "page" ? "page" : "none";
      break;

    case "openBulkActionDialog":
      next.crm.activeView = "list";
      next.crm.listSelectionMode = "page";
      next.crm.bulkDialogKind =
        (params.kind as OnboardingDemoRuntimeState["crm"]["bulkDialogKind"]) || null;
      break;

    case "openDemoDealDetail":
      next.crm.bulkDialogKind = null;
      next.crm.dealDetailOpen = true;
      next.crm.dealDetailId = typeof params.dealId === "string" ? params.dealId : "demo:deal-1";
      next.crm.dealDetailTab =
        (params.tab as OnboardingDemoRuntimeState["crm"]["dealDetailTab"]) || "tasks";
      break;

    case "openDemoDealTab":
      next.crm.dealDetailOpen = true;
      next.crm.dealParticipantsDrawerOpen = false;
      next.crm.dealAccountDrawerOpen = false;
      next.crm.dealDetailTab =
        (params.tab as OnboardingDemoRuntimeState["crm"]["dealDetailTab"]) || "tasks";
      next.crm.dealNoteEditorOpen = Boolean(params.openNoteEditor);
      next.crm.dealHistoryFilter = params.historyFilter === "rd_marketing" ? "rd_marketing" : "all";
      break;

    case "openDealParticipantsDrawer":
      next.crm.dealDetailOpen = true;
      next.crm.dealParticipantsDrawerOpen = Boolean(params.open);
      break;

    case "openDealAccountDrawer":
      next.crm.dealDetailOpen = true;
      next.crm.dealParticipantsDrawerOpen = false;
      next.crm.dealAccountDrawerOpen = Boolean(params.open);
      break;

    case "openDealFilePreview":
      next.crm.dealDetailOpen = true;
      next.crm.filePreviewOpen = Boolean(params.open);
      break;

    case "openMiniChatDock":
      next.crm.filePreviewOpen = false;
      next.crm.miniChatOpen = Boolean(params.open);
      next.crm.miniChatView = params.view === "thread" ? "thread" : "list";
      break;

    case "setMiniChatState":
      next.crm.miniChatOpen = true;
      next.crm.miniChatView = params.view === "thread" ? "thread" : "list";
      next.crm.miniChatAudioDemo = Boolean(params.audioDemo);
      next.crm.miniChatMetaClosed = Boolean(params.metaWindowClosed);
      next.crm.miniChatContextMenuOpen = Boolean(params.contextMenuOpen);
      break;

    case "setTasksViewMode":
      next.tasks.allModalOpen = false;
      next.tasks.createModalOpen = false;
      next.tasks.viewMode =
        params.mode === "week" ? "week" : params.mode === "day" ? "day" : "month";
      break;

    case "openTasksAllModal":
      next.tasks.allModalOpen = Boolean(params.open);
      break;

    case "openCreateTaskModal":
      next.tasks.allModalOpen = false;
      next.tasks.createModalOpen = Boolean(params.open);
      break;

    case "setContactsTab":
      next.contacts.createDrawerOpen = false;
      next.contacts.editDrawerOpen = false;
      next.contacts.conversationSearchOpen = false;
      next.contacts.accountDetailOpen = false;
      next.contacts.activeTab =
        (params.tab as OnboardingDemoRuntimeState["contacts"]["activeTab"]) || "all";
      break;

    case "openContactCreateDrawer":
      next.contacts.createDrawerOpen = Boolean(params.open);
      next.contacts.hasDuplicateWarning = false;
      next.contacts.dealResolutionOpen = false;
      break;

    case "setContactDuplicateState":
      next.contacts.createDrawerOpen = true;
      next.contacts.hasDuplicateWarning = Boolean(params.hasDuplicate);
      break;

    case "openContactDealResolution":
      next.contacts.createDrawerOpen = true;
      next.contacts.dealResolutionOpen = Boolean(params.open);
      break;

    case "openContactEditDrawer":
      next.contacts.createDrawerOpen = false;
      next.contacts.dealResolutionOpen = false;
      next.contacts.editDrawerOpen = Boolean(params.open);
      break;

    case "openContactsConversationSearch":
      next.contacts.editDrawerOpen = false;
      next.contacts.conversationSearchOpen = Boolean(params.open);
      break;

    case "openCompanyCreateDrawer":
      next.contacts.activeTab = "companies";
      next.contacts.companyCreateDrawerOpen = Boolean(params.open);
      break;

    case "openAccountDetailModal":
      next.contacts.activeTab = "companies";
      next.contacts.companyCreateDrawerOpen = false;
      next.contacts.accountDetailOpen = Boolean(params.open);
      next.contacts.accountDetailTab = "details";
      next.contacts.accountShowCnpj = false;
      break;

    case "setAccountDetailTab":
      next.contacts.accountDetailOpen = true;
      next.contacts.accountDetailTab =
        (params.tab as OnboardingDemoRuntimeState["contacts"]["accountDetailTab"]) || "details";
      next.contacts.accountShowCnpj = Boolean(params.showCnpj);
      break;

    case "setWalletTab":
      next.wallet.removeDialogOpen = false;
      next.wallet.templateEditorOpen = false;
      next.wallet.templateDeleteOpen = false;
      next.wallet.activeTab = params.tab === "templates" ? "templates" : "wallet";
      break;

    case "setWalletInactivityDemo":
      next.wallet.hasInactivityRisk = Boolean(params.hasRisk);
      break;

    case "openWalletRemoveDialog":
      next.wallet.removeDialogOpen = Boolean(params.open);
      break;

    case "openWalletTemplateEditor":
      next.wallet.activeTab = "templates";
      next.wallet.templateEditorOpen = Boolean(params.open);
      next.wallet.templateDeleteOpen = false;
      break;

    case "openWalletTemplateDelete":
      next.wallet.activeTab = "templates";
      next.wallet.templateEditorOpen = false;
      next.wallet.templateDeleteOpen = Boolean(params.open);
      break;

    case "openProfileSurface":
      next.profile.statusHelpOpen = false;
      next.profile.notificationsPromptOpen = false;
      next.profile.surfaceOpen = Boolean(params.open);
      if (params.tab === "aparencia") next.profile.activeTab = "aparencia";
      else next.profile.activeTab = "perfil";
      break;

    case "setProfileTab":
      next.profile.surfaceOpen = true;
      next.profile.activeTab = params.tab === "aparencia" ? "aparencia" : "perfil";
      break;

    case "openProfileAvatarPicker":
      next.profile.surfaceOpen = true;
      next.profile.avatarPickerOpen = Boolean(params.open);
      break;

    case "openStatusHelpWizard":
      next.profile.surfaceOpen = false;
      next.profile.statusHelpOpen = Boolean(params.open);
      next.profile.statusHelpPage = params.page === 1 ? 1 : params.page === 2 ? 2 : 0;
      break;

    case "openNotificationsPromptDemo":
      next.profile.surfaceOpen = false;
      next.profile.statusHelpOpen = false;
      next.profile.notificationsPromptOpen = Boolean(params.open);
      break;

    case "openCompletionModal":
      next.profile.surfaceOpen = false;
      next.profile.notificationsPromptOpen = false;
      next.profile.completionModalOpen = Boolean(params.open);
      next.fagnerDirectivePinned = true;
      next.profileSavedBanner = true;
      next.profile.completionStage =
        params.stage === "confirm"
          ? "confirm"
          : params.stage === "epilogue"
            ? "epilogue"
            : "review";
      break;

    case "simulateFagnerTechnicalSource": {
      const st = (params.sourceState ?? params.state ?? "verified") as KnowledgeSourceStatusDemo;
      next.activeFagnerTechnicalState = st;
      next.chat.sourceInspectorState = st;
      break;
    }

    case "simulateWhatsappPair": {
      if (params.mode === "code") {
        next.personalWhatsappStatus = "pairing_code_ready";
        next.personalWhatsappConnection.status = "pairing_code_ready";
        next.personalWhatsappConnection.pairingCodePreview = "TFG9-4821";
      } else {
        next.personalWhatsappStatus = "qr_ready";
        next.personalWhatsappConnection.status = "qr_ready";
        next.personalWhatsappConnection.qrPreview = "demo:qr:baileys-session";
      }
      break;
    }

    case "simulateWhatsappStatus": {
      const status = (params.status ??
        "connected") as OnboardingDemoRuntimeState["personalWhatsappStatus"];
      next.personalWhatsappStatus = status;
      next.personalWhatsappConnection.status = status;
      break;
    }
  }

  if (cmdName === "cycleMessageSourceState") {
    next.activeFagnerTechnicalState = next.chat.sourceInspectorState;
  }

  return next;
}
