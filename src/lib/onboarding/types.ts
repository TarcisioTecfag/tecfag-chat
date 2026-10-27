import type { ChannelId, GroupPermissions, ViewId } from "@/lib/rbac";

export const OPERATOR_TOUR_KEY = "operator-first-login" as const;
export const ONBOARDING_TOUR_KEY = OPERATOR_TOUR_KEY;
export type OperatorTourKey = typeof OPERATOR_TOUR_KEY;

export const ONBOARDING_CONTENT_VERSION = 1 as const;
export const OPERATOR_TOUR_CONTENT_VERSION = ONBOARDING_CONTENT_VERSION;
export const ONBOARDING_TOUR_VERSION = ONBOARDING_CONTENT_VERSION;

export type OperatorTourView =
  | "commercialHome"
  | "chat"
  | "crm"
  | "tasks"
  | "contacts"
  | "wallet";

export const PRIMARY_OPERATOR_VIEWS: readonly OperatorTourView[] = [
  "commercialHome",
  "chat",
  "crm",
  "tasks",
  "contacts",
  "wallet",
] as const;

export type ForbiddenSecondaryView = Exclude<ViewId, OperatorTourView>;

export const FORBIDDEN_SECONDARY_VIEWS: readonly ForbiddenSecondaryView[] = [
  "commercialManagement",
  "commercialBi",
  "valentina",
  "ligacoes",
  "monitor",
  "analytics",
  "groups",
  "settings",
] as const;

export const EXCLUDED_DEV_FEATURES = [
  "commercial_proposals",
  "technical_questionnaires",
  "emails",
] as const;

export const EXCLUDED_TOUR_FEATURES = [
  "proposals",
  "questionnaires",
  "emails",
] as const;

export type ExcludedDevFeature = (typeof EXCLUDED_DEV_FEATURES)[number];

export type TourChapterId =
  | "welcome"
  | "home"
  | "chat"
  | "crm"
  | "tasks"
  | "contacts"
  | "wallet"
  | "profile";

/**
 * O = Observar interface sem mutação
 * D = Abrir automaticamente estado demonstrativo
 * I = Convidar a interagir exclusivamente com fixture em memória
 * X = Explicar limite sem acionar controle
 */
export type TourStepMode =
  | "O"
  | "D"
  | "I"
  | "X"
  | "observe"
  | "simulated"
  | "interactive_demo"
  | "informational_boundary";

export type OnboardingRunStatus =
  | "not_started"
  | "in_progress"
  | "active"
  | "paused"
  | "deferred"
  | "completed";

export type OnboardingStatus = OnboardingRunStatus;

export type StepOutcome =
  | "seen"
  | "demonstrated"
  | "unavailable_permission"
  | "unavailable_capability"
  | "postponed"
  | "failed_target";

export type UnavailableReason =
  | "permission_denied"
  | "not_commercial_consultant"
  | "channel_not_allowed"
  | "queue_not_allowed"
  | "capability_disabled"
  | "surface_not_available"
  | "mobile_only"
  | "desktop_only"
  | "target_missing";

export type TourSurfaceId =
  | "welcome.modal"
  | "welcomeDialog"
  | "shell.desktop"
  | "shell.mobile"
  | "home.main"
  | "home.agenda-dialog"
  | "home.evidence-dialog"
  | "chat.main"
  | "chatList"
  | "chatWindow"
  | "chat.assistant"
  | "assistantModal"
  | "chat.personal-whatsapp"
  | "personalWhatsappModal"
  | "personalWhatsappDialog"
  | "chat.transfer-dialog"
  | "chat.finish-dialog"
  | "chat.evidence-dialog"
  | "chat.source-popover"
  | "chat.emoji-picker"
  | "chat.quick-responses"
  | "chat.inline-assistant"
  | "chat.catalog-picker"
  | "chat.meta-info"
  | "chat.meta-templates"
  | "chat.details-panel"
  | "chat.journey-modal"
  | "crm.board"
  | "crm.list"
  | "crm.search-dialog"
  | "crm.filters-dialog"
  | "crm.create-deal"
  | "crm.quick-create"
  | "crm.terminal-dialog"
  | "crm.bulk-suite"
  | "crm.deal-detail"
  | "crm.deal-participants"
  | "crm.deal-account"
  | "crm.file-preview"
  | "crm.mini-chat"
  | "tasks.main"
  | "tasks.all-dialog"
  | "tasks.create-modal"
  | "contacts.main"
  | "contacts.create-drawer"
  | "contacts.edit-drawer"
  | "contacts.deal-picker"
  | "contacts.conversation-search"
  | "contacts.companies"
  | "contacts.company-create"
  | "contacts.account-detail"
  | "wallet.main"
  | "wallet.remove-dialog"
  | "wallet.templates"
  | "wallet.template-editor"
  | "wallet.template-delete"
  | "profile.modal"
  | "profileModal"
  | "profile.status-wizard"
  | "profile.notifications"
  | "finish.modal"
  | "completionDialog";

export type TourCommandName =
  | "openWelcomeModal"
  | "focusPrimaryShell"
  | "setHomeFilter"
  | "toggleHomeGoalState"
  | "openHomeAgendaModal"
  | "openHomeEvidenceDialog"
  | "setHomeEvidenceChannel"
  | "advanceHomeEvidenceStep"
  | "setHomeOutcomeType"
  | "selectHomeCalendarDay"
  | "setChatViewState"
  | "setDemoQueue"
  | "setDemoChannelFilter"
  | "openDemoRowMenu"
  | "selectDemoAssistant"
  | "setAssistantHistoryFilter"
  | "resetDemoAssistantCycle"
  | "openDemoConversation"
  | "openWhatsappSenderPicker"
  | "openPersonalConnections"
  | "setPersonalWhatsappDemoState"
  | "toggleRightDetailsPanel"
  | "toggleSystemAnnotations"
  | "expandSystemAnnotation"
  | "openThreadSearch"
  | "setDemoAttendanceOwnership"
  | "openTransferDialog"
  | "openDealContextRequirement"
  | "openFinishAttendanceDialog"
  | "setMessageReplyDemo"
  | "openMessageReactionDemo"
  | "openMarkEvidenceModal"
  | "openMessageSourceInspector"
  | "cycleMessageSourceState"
  | "openMediaPreviewDemo"
  | "prepareAudioPlayerDemo"
  | "prepareAttachmentsDemo"
  | "prepareAudioRecorderDemo"
  | "openEmojiPickerDemo"
  | "openQuickResponsesDemo"
  | "openQuickResponsePersonalEditor"
  | "setInternalNoteMode"
  | "openInlineAssistantDemo"
  | "setInlineAssistantTab"
  | "openCatalogPickerDemo"
  | "setMetaWindowState"
  | "openMeta24hHelpDemo"
  | "openMetaTemplatesModal"
  | "openMetaTemplatePreview"
  | "openDetailsTab"
  | "openContactEditorInDetails"
  | "openCnpjRegistrationInDetails"
  | "openJourneyModal"
  | "openJourneyTab"
  | "openDetailsTaskCreator"
  | "openLinkedDealsEditor"
  | "openLinkedDealsPicker"
  | "openLinkedDealCreate"
  | "setCrmView"
  | "openCrmGlobalSearch"
  | "openCrmStatusFilter"
  | "openCrmOwnerFilter"
  | "openCrmSortMenu"
  | "openCrmAdvancedFilters"
  | "setCrmAdvancedFilterSection"
  | "applyCrmFilterChipsDemo"
  | "openCrmCreateMenu"
  | "openCreateDealDialog"
  | "setCreateDealSection"
  | "openCrmQuickCreate"
  | "openDealCardMenu"
  | "openTerminalStageDialog"
  | "setDealListSelectionDemo"
  | "openBulkActionDialog"
  | "openDemoDealDetail"
  | "openDemoDealTab"
  | "openDealParticipantsDrawer"
  | "openDealAccountDrawer"
  | "openDealFilePreview"
  | "openMiniChatDock"
  | "setMiniChatState"
  | "setTasksViewMode"
  | "openTasksAllModal"
  | "openCreateTaskModal"
  | "setContactsTab"
  | "openContactCreateDrawer"
  | "setContactDuplicateState"
  | "openContactDealResolution"
  | "openContactEditDrawer"
  | "openContactsConversationSearch"
  | "openCompanyCreateDrawer"
  | "openAccountDetailModal"
  | "setAccountDetailTab"
  | "setWalletTab"
  | "setWalletInactivityDemo"
  | "openWalletRemoveDialog"
  | "openWalletTemplateEditor"
  | "openWalletTemplateDelete"
  | "openProfileSurface"
  | "setProfileTab"
  | "openProfileAvatarPicker"
  | "openStatusHelpWizard"
  | "openNotificationsPromptDemo"
  | "openCompletionModal";

export interface TourCommand {
  name?: TourCommandName | string;
  command?: string;
  type?: string;
  surface?: TourSurfaceId | string;
  params?: Record<string, any>;
  payload?: Record<string, any>;
}

export type TourCapabilityKey =
  | "view:commercialHome"
  | "view:chat"
  | "view:crm"
  | "view:tasks"
  | "view:contacts"
  | "view:wallet"
  | "consultant:commercialHome"
  | "chat:queueMine"
  | "chat:queueAll"
  | "chat:queueWaiting"
  | "chat:queueBot"
  | "chat:queueClosed"
  | "chat:capture"
  | "chat:transfer"
  | "chat:finish"
  | "chat:override"
  | "chat:internalNotes"
  | "chat:editClientInfo"
  | "chat:manageTags"
  | "chat:manageRdCrm"
  | "chat:inlineAssistant"
  | "chat:globalTemplates"
  | "whatsapp:personalConnection"
  | "whatsapp:personalPair"
  | "crm:createDeals"
  | "crm:editDeals"
  | "crm:moveStages"
  | "crm:closeDeals"
  | "crm:exportDeals"
  | "crm:deleteDeals"
  | "contacts:create"
  | "contacts:edit"
  | "device:mobile"
  | "device:desktop";

export type TourPlacement = "top" | "bottom" | "left" | "right" | "center" | "auto";

export interface TourTarget {
  scope?: TourSurfaceId;
  /** Exact value of data-tour="VALUE" */
  selector: string;
  /** Optional deterministic fixture item identifier (data-tour-item="demo:...") */
  demoItemId?: string;
}

export interface TourCompletionRule {
  type: "next_click" | "demo_interaction_or_next" | "chapter_review" | "final_confirm";
  interactionEvent?: string;
}

export interface TourStepCompletionSpec {
  type: "manual" | "demo_interaction" | "next_click" | "demo_interaction_or_next" | "final_confirm";
  demoAction?: string;
  demoPayload?: Record<string, any>;
}

export interface TourMobileVariant {
  surface?: TourSurfaceId;
  targetSelector?: string;
  prepareCommand?: TourCommand;
  note?: string;
}

export interface TourStep {
  id: string;
  chapterId: TourChapterId;
  orderIndex: number;
  order: number;
  featureIds: readonly string[];
  functionalIds: readonly string[];
  view: OperatorTourView;
  routePath: string;
  surface: TourSurfaceId;
  target: TourTarget;
  targetSelector: string;
  fallbackSelectors?: string[];
  title: string;
  body: string;
  ctaLabel: string;
  mode: TourStepMode;
  requiredCapabilities: readonly TourCapabilityKey[];
  scenarioId: string;
  prepareCommand?: TourCommand;
  demoCommand?: TourCommand;
  enterCommands?: TourCommand[];
  completionRule: TourCompletionRule;
  completion: TourStepCompletionSpec;
  placement: TourPlacement;
  mobileVariant?: TourMobileVariant;
  fallbackExplanation: string;
  isControlStep?: boolean;
  contentVersion: number;
}

export interface TourChapter {
  id: TourChapterId;
  orderIndex: number;
  order: number;
  title: string;
  shortTitle: string;
  subtitle: string;
  description: string;
  primaryView: OperatorTourView;
  stepIds: readonly string[];
}

export interface UnavailableStepRecord {
  stepId: string;
  reason: UnavailableReason | string;
  recordedAt: string;
}

export type OnboardingUnavailableStepRecord = UnavailableStepRecord;

export interface OnboardingEligibilityContext {
  tenantId: string;
  operatorId: string;
  operatorName?: string;
  operatorRole?: string;
  role?: string;
  isCommercialConsultant?: boolean;
  permissions: GroupPermissions;
  allowedChannels?: readonly ChannelId[];
  hasPersonalWhatsappConnection?: boolean;
  hasPersonalWhatsappConnections?: boolean;
  canPairPersonalWhatsapp?: boolean;
  isMobile?: boolean;
}

export interface OnboardingProgressDTO {
  enabled: boolean;
  tenantId: string;
  operatorId: string;
  tourKey: OperatorTourKey;
  contentVersion: number;
  runId: string | null;
  status: OnboardingRunStatus;
  currentStepId: string | null;
  visitedStepIds: string[];
  completedStepIds: string[];
  completedChapterIds: TourChapterId[];
  unavailableSteps: UnavailableStepRecord[];
  startedAt: string | null;
  pausedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  lastCompletedVersion: number | null;
  lastCompletedAt: string | null;
  deferredUntil: string | null;
  revision: number;
  eligibleViews: OperatorTourView[];
  eligibleStepIds: string[];
  completionPct: number;
}

export type OnboardingActionType =
  | "start"
  | "checkpoint"
  | "pause"
  | "defer"
  | "resume"
  | "restart"
  | "complete";

export type OnboardingAction = OnboardingActionType;

export interface OnboardingPatchInput {
  action: OnboardingActionType;
  contentVersion?: number;
  runId?: string | null;
  revision?: number;
  expectedRevision?: number;
  currentStepId?: string | null;
  stepId?: string | null;
  visitedStepIds?: string[];
  completedStepIds?: string[];
  unavailableSteps?: UnavailableStepRecord[];
  deferMinutes?: number;
  deferHours?: number;
}
