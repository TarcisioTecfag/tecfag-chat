/** Targets belong to the actual application. Missing controls remain missing; no proxy DOM is created. */
export interface TrainingTarget { css?: string; text?: string; label?: string; event?: "input" | "change" | "click" | "save"; open?: string[] }
export const TRAINING_TARGETS: Record<string, TrainingTarget> = {};
function add(ids: string, target: TrainingTarget) { for (const id of ids.split(" ")) { if (TRAINING_TARGETS[id]) throw Error(`Alvo duplicado: ${id}`); TRAINING_TARGETS[id] = target; } }
const button = (text: string): TrainingTarget => ({ text, css: "button,[role=button]", event: "click" });
const field = (placeholder: string): TrainingTarget => ({ css: `input[placeholder="${placeholder}"],textarea[placeholder="${placeholder}"]`, event: "input" });
const source = (key: string, event: TrainingTarget["event"] = "click"): TrainingTarget => ({ css: `[data-tour~="${key}"]`, event });

add("welcome.map", { css: "aside nav,aside" });
add("welcome.context", { css: "aside button:has(img[alt=Logo])" });
add("chat.layout", { css: "[data-tour~=\"chat.conversation-list\"]" });
add("chat.search", source("chat.search", "input"));
add("chat.channels", source("chat.channel-whatsapp"));
add("chat.queue-mine", source("chat.queue-mine")); add("chat.queue-all", source("chat.queue-all"));
add("chat.queue-waiting", source("chat.queue-waiting")); add("chat.queue-bot", source("chat.queue-bot")); add("chat.queue-closed", source("chat.queue-finished"));
add("chat.row", { css: "[data-tour~=\"chat.conversation-list\"] button:not([data-tour])" });
add("chat.row-menu", source("chat.row-menu"));
add("chat.assistant-entry", source("chat.fagner-assistant-row"));
add("chat.assistant-thread", { css: "[data-tour~=\"chat.message-list\"]" });
add("chat.assistant-history", button("Ver anteriores"));
add("chat.assistant-reset", { css: "button:has(svg.lucide-rotate-ccw)" });
add("chat.assistant-cards", { css: "[data-tour~=\"chat.assistant-suggestions\"] button", event: "click" });
add("chat.header", source("chat.header"));
add("chat.sender chat.sender-history", { css: "[data-tour~=\"chat.sender\"]", event: "change" });
add("chat.info-toggle", source("chat.info-toggle")); add("chat.system-toggle", source("chat.system-toggle"));
add("chat.system-details", source("message.system-details"));
add("chat.search-thread", { ...field("Buscar mensagem..."), open: ["chat.thread-search-button"] });
add("chat.capture", button("Assumir atendimento"));
add("chat.other-owner", { text: "Atendimento com", css: "[data-tour~=\"chat.owner-lock\"]" });
add("chat.transfer", source("chat.transfer"));
add("chat.deal-context", source("chat.deal-context"));
add("chat.finish", source("chat.finish-confirm"));
add("chat.reopen", button("Reabrir atendimento"));
add("chat.call-shortcut", source("chat.call-shortcut"));
add("chat.message-status", source("message.status"));
add("chat.message-reply", source("message.reply")); add("chat.message-react", source("message.react"));
add("chat.message-evidence", source("message.evidence"));
add("chat.message-source", source("message.source")); add("chat.message-source-states", source("message.source-panel"));
add("chat.message-media", source("message.media")); add("chat.message-audio", source("message.audio"));
add("chat.composer", source("composer.text", "input")); add("chat.attachments", source("composer.attachments"));
add("chat.record", source("composer.record")); add("chat.emoji", source("composer.emoji"));
add("chat.quick-entry", source("quick.open")); add("chat.quick-insert", source("quick.insert")); add("chat.quick-personal", source("quick.personal-editor", "save")); add("chat.quick-global", source("quick.global"));
add("chat.internal-note", button("Nota Interna"));
add("chat.inline-entry", source("inline.open")); add("chat.inline-response", source("inline.best_response")); add("chat.inline-grammar", source("inline.grammar_fix")); add("chat.inline-summary", source("inline.lead_summary")); add("chat.inline-result", source("inline.result", "input"));
add("chat.catalog", button("Catálogo")); add("chat.catalog-attach", source("catalog.attach"));
add("chat.meta-window", source("meta.window")); add("chat.meta-help", source("meta.info")); add("chat.meta-search", source("meta.templates", "input")); add("chat.meta-preview", source("meta.template-preview")); add("chat.meta-send", source("meta.template-send"));
add("chat.details", source("details.tabs")); add("chat.contact-edit", source("details.contact-editor", "save")); add("chat.registration", source("details.registration")); add("chat.context-site", source("details.site-context"));
add("chat.journey-open contacts.journey", source("journey.dialog")); add("chat.journey-client", source("journey.info")); add("chat.journey-pages", source("journey.pages")); add("chat.journey-timeline", source("journey.timeline"));
add("chat.task-create", source("details.task-create", "save")); add("chat.task-tag", source("details.task-tags"));
add("chat.linked-deals", source("linked-deals.list")); add("chat.linked-deal-edit", source("linked-deals.editor", "save")); add("chat.linked-deal-link", source("linked-deals.link")); add("chat.linked-deal-new", source("linked-deals.create"));
add("chat.shared-files", source("details.files")); add("chat.events", source("details.events")); add("chat.external-crm", source("details.external-crm"));

add("crm.pipeline", source("crm.pipeline-select", "change")); add("crm.views", source("crm.view-list"));
add("crm.search", source("crm.search-trigger", "input")); add("crm.global-search", source("crm.search-dialog", "input"));
add("crm.status", source("crm.status")); add("crm.owner", source("crm.owner")); add("crm.sort", source("crm.sort"));
add("crm.advanced-entry", source("crm.filters-dialog"));
add("crm.advanced-stage", source("crm.filter-stages", "change")); add("crm.advanced-work", source("crm.filter-work", "change")); add("crm.advanced-fields", source("crm.filter-fields", "change")); add("crm.advanced-relations", source("crm.filter-relations", "change")); add("crm.advanced-dates", source("crm.filter-dates", "change"));
add("crm.filter-chips", source("crm.filter-chips"));
// Teach the visible new-deal button before opening its real drawer.
add("crm.create-menu", source("crm.new-deal"));
add("crm.new-deal-core", { ...field("Digite o nome da negociação"), event: "input" });
add("crm.new-deal-account", source("deal-create.account", "change"));
add("crm.new-deal-contact", field("Buscar contato por nome, telefone ou e-mail"));
add("crm.new-deal-extra", { css: "textarea[placeholder^='Descreva detalhes preliminares']", event: "input" });
add("crm.new-deal-save", source("deal-create.save", "save"));
add("crm.quick-company", source("crm.quick-company", "save")); add("crm.quick-contact", source("crm.quick-contact", "save"));
add("crm.columns", source("crm.stage-summary")); add("crm.stage-create", source("crm.stage-create")); add("crm.card", source("crm.deal-card")); add("crm.card-menu", { css: "button[aria-label^='Ações da negociação']", event: "click" });
add("crm.move", source("crm.deal-card", "change")); add("crm.move-terminal", source("crm.terminal-dialog", "save"));
add("crm.card-task", source("crm.card-task")); add("crm.card-chats", { css: "button[aria-label='Abrir no Mini Chat']", event: "click" });
add("crm.list-columns", { css: "table tbody tr", event: "click" }); add("crm.list-pages", source("crm.pagination")); add("crm.selection", { css: "table tbody input[type=checkbox],table tbody [role=checkbox]", event: "change" });
add("crm.bulk-transfer", source("bulk.transfer", "save")); add("crm.bulk-status", source("bulk.status", "save")); add("crm.bulk-fields", source("bulk.fields", "save")); add("crm.bulk-create", source("bulk.create", "save")); add("crm.bulk-move", source("bulk.move", "save")); add("crm.bulk-export", source("bulk.export")); add("crm.bulk-delete", source("bulk.delete"));
add("crm.detail-header", source("deal.header")); add("crm.detail-edit", source("deal.core", "input")); add("crm.detail-priority", source("deal.priority")); add("crm.detail-stages", source("deal.stages", "change")); add("crm.detail-outcomes", source("deal.outcomes", "save"));
add("crm.participants", source("deal.participants", "save")); add("crm.participant-chats", source("deal.participant-chats")); add("crm.account", source("deal.account", "change")); add("crm.custom-fields", source("deal.custom-fields", "input")); add("crm.next-task", source("task-create.form", "save")); add("crm.task-tabs", source("deal.task-tabs")); add("crm.task-actions tasks.reschedule", source("deal.task-actions"));
add("crm.history", source("deal.history")); add("crm.note", source("deal.note-editor", "save")); add("crm.marketing-history", source("deal.marketing-history")); add("crm.conversations", source("deal.conversations")); add("crm.evidence", source("deal.evidence")); add("crm.products", source("deal.products-items", "save")); add("crm.files", source("deal.files", "save")); add("crm.file-preview", source("deal.file-preview"));
add("crm.mini-open", { css: "button[aria-label='Abrir conversas']", event: "click" }); add("crm.mini-list", source("mini.list")); add("crm.mini-thread", source("mini.thread", "input")); add("crm.mini-audio", source("mini.audio")); add("crm.mini-meta", source("mini.templates")); add("crm.mini-menu", source("mini.context-menu")); add("crm.mini-controls", source("mini.controls"));

add("tasks.overview tasks.reminders", { css: "h1" }); add("tasks.views", button("Semana")); add("tasks.period", { css: "button:has(svg.lucide-chevron-right)", event: "click" }); add("tasks.month", source("tasks.month-grid")); add("tasks.day-filters", source("tasks.day-filters")); add("tasks.week", source("tasks.week-grid")); add("tasks.day", source("tasks.day-agenda")); add("tasks.item", source("tasks.item")); add("tasks.chat", source("tasks.chat")); add("tasks.all", source("tasks.all-dialog"));
add("tasks.new-context", field("Buscar negociação...")); add("tasks.new-fields", field("Assunto da tarefa")); add("tasks.new-save", source("task-create.save", "save"));
add("contacts.tabs", source("contacts.tab-companies")); add("contacts.channels", source("contacts.tab-whatsapp")); add("contacts.search", source("contacts.search", "input")); add("contacts.rows", { css: "table tbody tr", event: "click" });
add("contacts.new", source("contact-create.core", "input")); add("contacts.duplicate", source("contact-create.duplicate")); add("contacts.company-link", source("contact-create.account", "change")); add("contacts.deal-resolution", source("contact-create.deal")); add("contacts.save", source("contact-create.save", "save")); add("contacts.edit", source("contacts.editor", "save")); add("contacts.attend", source("contacts.attend")); add("contacts.conversation-search", source("contacts.conversation-search", "input"));
add("contacts.companies", source("contacts.tab-companies")); add("contacts.company-new", source("account-create.form", "save")); add("contacts.account-details", source("account.details", "input")); add("contacts.account-registry", source("account.registration")); add("contacts.account-contacts", source("account.contacts")); add("contacts.account-deals", source("account.deals")); add("contacts.account-chats", source("account.conversations")); add("contacts.account-history", source("account.history")); add("contacts.account-archive", source("account.archive"));
add("wallet.tabs", button("Meus Templates")); add("wallet.kpis", source("wallet.summary-total")); add("wallet.inactivity", { text: "Inatividade da Carteira" }); add("wallet.search", field("Buscar cliente por nome, telefone ou CNPJ/CPF...")); add("wallet.rows", { css: "table tbody tr" }); add("wallet.chat", button("Atendimento")); add("wallet.remove", source("wallet.remove-dialog", "save")); add("wallet.templates", source("profile.personal-templates-tab")); add("wallet.template-edit", source("wallet.template-editor", "save")); add("wallet.template-vars", source("wallet.template-variables", "input")); add("wallet.template-delete", source("wallet.template-delete", "save"));
add("profile.entry", source("profile.trigger")); add("profile.tabs", button("Aparência")); add("profile.identity", source("profile.name-input", "input")); add("profile.avatar", source("profile.avatar-presets")); add("profile.status", source("profile.status-pausa")); add("profile.quick-status", source("profile.status-wizard-open")); add("profile.status-help", source("profile.status-help")); add("profile.group", source("profile.group")); add("profile.theme", source("profile.theme-light")); add("profile.density", source("profile.density")); add("profile.actions", source("profile.save")); add("profile.keyboard", source("profile.keyboard-shortcuts")); add("profile.mobile", { css: "button[aria-label='Mais módulos e perfil']" }); add("profile.notifications", source("profile.notifications")); add("profile.replay", source("profile.fagner-tour-restart"));

add("home.identity", { css: "h1" }); add("home.refresh", source("home.refresh")); add("home.pace", source("home.rhythm-card")); add("home.goal", source("home.goal")); add("home.agenda", source("home.today-agenda")); add("home.agenda-modal", source("home.agenda-dialog")); add("home.directives", source("home.directives")); add("home.filters", source("home.directive-filters")); add("home.overdue", source("home.overdue")); add("home.directive-actions", source("home.directive-actions")); add("home.evidence-call", source("home.evidence-call", "input")); add("home.evidence-whatsapp", source("home.evidence-whatsapp", "change")); add("home.evidence-advance", source("home.evidence-next")); add("home.outcome-next", source("home.outcome-next", "input")); add("home.outcome-won", source("home.outcome-won")); add("home.outcome-lost", source("home.outcome-lost")); add("home.calendar", source("home.calendar")); add("home.dossier", source("home.day-dossier")); add("home.crm-link", source("home.open-crm"));

export const PARENT_TRAINING_TARGETS: Record<string, string> = {
  "welcome.start": "[data-tour~=\"welcome.dialog\"]", "welcome.practice": "[data-tour~=\"welcome.practice\"]", "welcome.controls": "[data-tour~=\"tour.controls\"]",
  "finish.review": "[data-tour~=\"finish.review\"]", "finish.complete": "[data-tour~=\"onboarding.complete-tour\"]", "finish.return": "[data-tour~=\"onboarding.return-to-operation\"]",
};

function visible(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height || el.closest("[hidden],[inert],[aria-hidden=true]")) return false;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) { const style = el.ownerDocument.defaultView?.getComputedStyle(node); if (style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") return false; }
  return true;
}
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
export function resolveTrainingTarget(doc: Document, stepId: string): HTMLElement | null {
  const target = TRAINING_TARGETS[stepId]; if (!target) return null;
  if (target.label) {
    const label = Array.from(doc.querySelectorAll<HTMLElement>("label")).find((el) => fold(el.textContent || "") === fold(target.label!) && visible(el));
    const control = label?.getAttribute("for") ? doc.getElementById(label.getAttribute("for")!) : label?.parentElement?.querySelector<HTMLElement>("input,textarea,button,[role=combobox]");
    return control && visible(control) ? control : null;
  }
  const raw = Array.from(doc.querySelectorAll<HTMLElement>(target.css || "h1,h2,h3,label,button,section" ));
  const candidates = raw.filter(visible);
  const matching = target.text ? candidates.filter((e) => fold(e.getAttribute("aria-label") || e.textContent || "") === fold(target.text!)) : candidates;
  return matching.at(-1) || null;
}

