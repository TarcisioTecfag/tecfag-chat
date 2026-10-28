import type { TourStep } from "./types";

export type LessonKind =
  "read" | "search" | "select" | "form" | "action" | "table" | "source" | "media";
export type LessonEntity =
  "deal" | "contact" | "account" | "task" | "template" | "profile" | "message" | "evidence";
export interface LessonSpec {
  kind: LessonKind;
  entity: LessonEntity;
  selector: string;
  stepId: string;
  label: string;
  choices: readonly string[];
}
const families: Array<[LessonKind, string]> = [
  [
    "search",
    "chat.search chat.search-thread crm.search crm.global-search contacts.search contacts.conversation-search wallet.search chat.meta-search",
  ],
  [
    "form",
    "home.evidence-call home.evidence-whatsapp home.evidence-advance home.outcome-next chat.composer chat.quick-personal chat.internal-note chat.contact-edit chat.task-create chat.linked-deal-edit crm.new-deal-core crm.new-deal-account crm.new-deal-contact crm.new-deal-extra crm.new-deal-save crm.quick-company crm.quick-contact crm.detail-edit crm.custom-fields crm.next-task crm.note crm.bulk-fields crm.bulk-create tasks.new-context tasks.new-fields tasks.new-save contacts.new contacts.company-link contacts.save contacts.edit contacts.company-new wallet.template-edit wallet.template-vars profile.identity",
  ],
  [
    "select",
    "home.filters chat.channels chat.sender chat.sender-history chat.info-toggle chat.system-toggle chat.assistant-history chat.inline-entry chat.inline-grammar chat.inline-result chat.details chat.journey-client chat.journey-pages chat.journey-timeline chat.shared-files chat.events crm.pipeline crm.views crm.status crm.owner crm.sort crm.advanced-stage crm.advanced-work crm.advanced-fields crm.advanced-relations crm.advanced-dates crm.filter-chips crm.columns crm.move crm.detail-stages crm.task-tabs crm.history crm.marketing-history crm.conversations crm.evidence crm.products crm.files crm.mini-list crm.mini-controls tasks.views tasks.period tasks.month tasks.day-filters tasks.week tasks.day contacts.tabs contacts.channels contacts.companies contacts.account-details contacts.account-registry contacts.account-contacts contacts.account-deals contacts.account-chats wallet.tabs wallet.templates profile.tabs profile.status profile.theme profile.density",
  ],
  [
    "action",
    "welcome.controls home.refresh home.directive-actions chat.assistant-entry chat.assistant-cards chat.row-menu chat.system-details chat.capture chat.transfer chat.deal-context chat.finish chat.message-reply chat.message-react chat.message-evidence chat.quick-entry chat.quick-insert chat.emoji chat.catalog-attach crm.card-menu crm.move-terminal crm.card-task crm.card-chats crm.bulk-transfer crm.bulk-status crm.bulk-move crm.detail-outcomes crm.task-actions crm.mini-open crm.mini-thread crm.mini-menu tasks.chat contacts.deal-resolution contacts.attend contacts.journey wallet.chat wallet.remove wallet.template-delete profile.entry profile.avatar profile.status-help profile.replay finish.complete",
  ],
  [
    "table",
    "home.calendar chat.linked-deals chat.linked-deal-link chat.catalog chat.meta-preview crm.list-columns crm.list-pages crm.selection crm.participants crm.account tasks.item tasks.all contacts.rows contacts.duplicate",
  ],
  ["source", "chat.message-source"],
  [
    "media",
    "chat.message-media chat.message-audio chat.attachments chat.record crm.file-preview crm.mini-audio crm.mini-meta",
  ],
];
const kinds = new Map<string, LessonKind>();
for (const [kind, ids] of families)
  for (const id of ids.split(" ")) {
    if (kinds.has(id)) throw Error(`Exercício duplicado: ${id}`);
    kinds.set(id, kind);
  }
function entityFor(id: string): LessonEntity {
  if (/evidence|outcome|directive-actions/.test(id)) return "evidence";
  if (/template|quick-personal|quick-insert|meta-/.test(id)) return "template";
  if (/company|account|registration/.test(id)) return "account";
  if (/task|next-task|card-task/.test(id)) return "task";
  if (/profile\.|welcome\./.test(id)) return "profile";
  if (/contact|new-deal-contact/.test(id)) return "contact";
  if (id.startsWith("chat.") || /mini-|conversation|wallet.chat/.test(id)) return "message";
  return "deal";
}
export function getLessonSpec(step: TourStep, allowedChannels?: readonly string[]): LessonSpec {
  const interactive = step.mode === "I" || step.mode === "interactive_demo";
  const kind = interactive ? kinds.get(step.id) : "read";
  if (!kind) throw Error(`Etapa sem exercício implementado: ${step.id}`);
  let choices: readonly string[] = ["Resumo", "Detalhes do registro"];
  if (step.id === "crm.views") choices = ["Quadro", "Lista"];
  else if (step.id === "crm.status") choices = ["Em aberto", "Ganhas", "Perdidas"];
  else if (/transfer|owner/.test(step.id))
    choices = ["Equipe de demonstração A", "Equipe de demonstração B"];
  else if (/bulk-status|outcomes|terminal/.test(step.id)) choices = ["Ganho", "Perdido"];
  else if (/sender/.test(step.id))
    choices = ["Conexão de demonstração A", "Conexão de demonstração B"];
  else if (/channels/.test(step.id))
    choices = ["whatsapp", "instagram", "messenger", "livechat"].filter(
      (channel) => allowedChannels === undefined || allowedChannels.includes(channel),
    );
  else if (/info-toggle|system-toggle/.test(step.id)) choices = ["Mostrar", "Ocultar"];
  else if (/inline-grammar/.test(step.id))
    choices = ["Corrigir ortografia", "Melhorar clareza", "Resumir"];
  else if (/inline-entry/.test(step.id))
    choices = ["Assistente da mensagem", "Histórico de sugestões"];
  else if (/inline-result/.test(step.id))
    choices = ["Usar sugestão fictícia", "Editar sugestão fictícia"];
  else if (step.id === "crm.sort") choices = ["Mais recentes", "Maior valor", "Próximo contato"];
  else if (/columns/.test(step.id))
    choices = ["Título, valor e responsável", "Título e próximo contato"];
  else if (/advanced-dates|tasks.period/.test(step.id))
    choices = ["Hoje", "Próximos 7 dias", "Este mês"];
  else if (/advanced-work/.test(step.id))
    choices = ["Com tarefa pendente", "Sem próximo contato", "Com tarefa atrasada"];
  else if (/advanced-relations/.test(step.id))
    choices = ["Com contato vinculado", "Com empresa vinculada"];
  else if (/advanced-fields/.test(step.id))
    choices = ["Com valor preenchido", "Sem valor preenchido"];
  else if (/crm.products/.test(step.id)) choices = ["Seladora VSF", "Embaladora de demonstração"];
  else if (/theme/.test(step.id)) choices = ["Claro", "Escuro", "Sistema"];
  else if (/density/.test(step.id)) choices = ["75%", "85%", "100%"];
  else if (step.id === "tasks.day-filters")
    choices = ["Todas", "Pendentes", "Atrasadas", "Concluídas"];
  else if (/profile.status/.test(step.id)) choices = ["Disponível", "Em pausa", "Desconectado"];
  else if (/views|tasks.month|tasks.week|tasks.day$/.test(step.id))
    choices = ["Mês", "Semana", "Dia"];
  else if (/filters|filter-chips/.test(step.id))
    choices = ["Todas", "Atrasadas", "Hoje", "Concluídas"];
  else if (/pipeline|stages|move/.test(step.id))
    choices = ["Qualificação", "Negociação", "Fechamento"];
  else if (/journey|details|history|files|events|conversations|account-/.test(step.id))
    choices = ["Informações", "Histórico", "Negócios", "Arquivos"];
  else if (step.id === "crm.task-tabs") choices = ["Pendentes", "Concluídas"];
  else if (step.id === "profile.tabs") choices = ["Identidade", "Preferências", "Atalhos"];
  else if (step.id === "wallet.tabs") choices = ["Minha carteira", "Templates"];
  else if (/templates/.test(step.id))
    choices = ["Saudação", "Retorno de orçamento", "Acompanhamento"];
  else if (/tabs|companies/.test(step.id)) choices = ["Clientes", "Empresas"];
  return {
    kind,
    entity: entityFor(step.id),
    selector: step.target.selector,
    stepId: step.id,
    label: step.title,
    choices,
  };
}

export interface LessonDocument {
  rows: Record<LessonEntity, Array<{ id: string; name: string; detail: string; status: string }>>;
  filters: Record<string, string>;
  selection: string[];
  receipts: Array<{ stepId: string; action: LessonKind; result: string }>;
  drafts: Record<string, Record<string, string>>;
  openedPanels: Record<string, string>;
}
export function createLessonDocument(): LessonDocument {
  const rows = Object.fromEntries(
    (
      [
        "deal",
        "contact",
        "account",
        "task",
        "template",
        "profile",
        "message",
        "evidence",
      ] as LessonEntity[]
    ).map((entity) => [
      entity,
      [1, 2, 3].map((index) => ({
        id: `demo:${entity}-${index}`,
        name:
          {
            deal: "Orçamento de seladora",
            contact: "Cliente fictício",
            account: "Empresa de demonstração",
            task: "Retornar orçamento",
            template: "Saudação {{nome}}",
            profile: "Operador de teste",
            message: "Preciso de um orçamento",
            evidence: "Confirmação do orçamento",
          }[entity] + ` ${index}`,
        detail: index === 1 ? "Seladora VSF • WhatsApp • Qualificação" : "Catálogo • Negociação",
        status: "Pendente",
      })),
    ]),
  );
  return {
    rows: rows as LessonDocument["rows"],
    filters: {},
    selection: [],
    drafts: {},
    receipts: [],
    openedPanels: {},
  };
}
export function validateLessonInput(
  spec: LessonSpec,
  values: Record<string, string>,
  document: LessonDocument,
): string | null {
  if (spec.kind === "form") {
    if (!(values.name || "").trim() || (values.name || "").trim().length < 3)
      return "Preencha o campo principal com pelo menos 3 caracteres.";
    if (
      spec.entity === "task" &&
      (!document.rows.deal.some((row) => row.id === values.dealId) ||
        !Number.isFinite(Date.parse(values.due)) ||
        Date.parse(values.due) <= Date.now())
    )
      return "Escolha uma negociação e uma data futura.";
    if (
      spec.entity === "deal" &&
      (!["Qualificação", "Negociação", "Fechamento"].includes(values.stage) ||
        !Number.isFinite(Number(values.amount)) ||
        Number(values.amount) <= 0)
    )
      return "Escolha uma etapa e um valor maior que zero.";
    if (spec.entity === "contact" && (values.phone || "").replace(/\D/g, "").length < 10)
      return "Informe um telefone de demonstração com DDD.";
    if (spec.entity === "profile" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email || ""))
      return "Informe um e-mail de demonstração válido.";
    if (
      ["template", "message", "evidence"].includes(spec.entity) &&
      (values.content || "").trim().length < 4
    )
      return "Preencha o texto antes de salvar.";
  } else if (spec.kind === "search") {
    const query = (values.query || "").trim().toLowerCase();
    if (
      query.length < 2 ||
      !document.rows[spec.entity].some((row) =>
        `${row.name} ${row.detail}`.toLowerCase().includes(query),
      )
    )
      return "Busque um termo presente nos dados de demonstração.";
  } else if (spec.kind === "select" && !spec.choices.includes(values.choice))
    return "Escolha uma opção disponível.";
  else if (spec.kind === "table" && !document.rows[spec.entity].some((row) => row.id === values.id))
    return "Selecione um registro da demonstração.";
  else if (
    spec.kind === "action" &&
    (values.confirm !== "yes" || !document.rows[spec.entity].some((row) => row.id === values.id))
  )
    return "Confira o registro e confirme a ação.";
  else if (
    spec.kind === "action" &&
    /message-reply/.test(spec.stepId) &&
    (values.content || "").trim().length < 4
  )
    return "Escreva a resposta de demonstração com citação.";
  else if (
    spec.kind === "action" &&
    /transfer|bulk-status|bulk-move|move-terminal|detail-outcomes/.test(spec.stepId) &&
    !spec.choices.includes(values.choice)
  )
    return "Escolha o destino ou resultado antes de confirmar.";
  else if (spec.kind === "media" && values.mediaReady !== "yes")
    return "Abra o arquivo ou reproduza a amostra antes de continuar.";
  else if (spec.kind === "source" && values.sourceOpened !== "yes")
    return "Abra a indicação de fonte da resposta.";
  return null;
}
export function performLessonAction(
  document: LessonDocument,
  spec: LessonSpec,
  values: Record<string, string>,
) {
  if (spec.kind === "read") throw Error("Etapa explicativa não produz comprovante de exercício.");
  const error = validateLessonInput(spec, values, document);
  if (error) throw Error(error);
  const next = structuredClone(document);
  let result = "";
  if (spec.kind === "form") {
    const row = {
      id: `demo:${spec.entity}-saved-${document.receipts.length}`,
      name: values.name.trim(),
      detail:
        values.content || values.phone || values.email || values.stage || "Dados salvos em memória",
      status: "Salvo",
    };
    next.rows[spec.entity].unshift(row);
    next.drafts[spec.entity] = { ...values };
    result = `Salvo: ${row.name}`;
  } else if (spec.kind === "search") {
    next.filters[spec.entity] = values.query;
    result = `Busca aplicada: ${values.query}`;
  } else if (spec.kind === "select") {
    next.filters[spec.stepId] = values.choice;
    result = `Selecionado: ${values.choice}`;
  } else if (spec.kind === "table") {
    next.selection = [values.id];
    result = `Registro selecionado: ${values.id}`;
  } else if (spec.kind === "action") {
    const rows = next.rows[spec.entity],
      row = rows.find((candidate) => candidate.id === values.id)!;
    if (/delete|remove/.test(spec.stepId))
      next.rows[spec.entity] = rows.filter((candidate) => candidate.id !== row.id);
    else if (/capture/.test(spec.stepId)) row.status = "Meus • Operador de teste";
    else if (/finish/.test(spec.stepId)) row.status = "Finalizado";
    else if (/transfer/.test(spec.stepId)) row.status = `Transferido: ${values.choice}`;
    else if (/react/.test(spec.stepId)) row.status = "Reação 👍";
    else if (/bulk-status|move-terminal|detail-outcomes|bulk-move/.test(spec.stepId))
      row.status = values.choice;
    else if (/message-reply/.test(spec.stepId)) {
      next.rows.message.unshift({
        id: `demo:reply-${next.receipts.length}`,
        name: values.content,
        detail: `Em resposta a: ${row.name}`,
        status: "Mensagem fictícia",
      });
    }
    // Opening a menu, profile, chat or detail pane must not pretend to mutate a business record.
    next.openedPanels[spec.stepId] = row.id;
    result = `${spec.label}: ${row.name}${values.content ? ` • ${values.content}` : ""}${values.choice ? ` • ${values.choice}` : ""}`;
  } else
    result = spec.kind === "source" ? "Fonte consultada" : "Arquivo de demonstração consultado";
  next.receipts.push({ stepId: spec.stepId, action: spec.kind, result });
  return { document: next, receipt: { stepId: spec.stepId, action: spec.kind, result } };
}
