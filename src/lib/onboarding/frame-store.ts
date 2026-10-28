import { createOnboardingDemoFixtures, DEMO_ACCOUNTS } from "./fixtures";
import type { GroupPermissions } from "@/lib/rbac";

type Row = Record<string, any>;
export interface TrainingStore {
  tenantId: string; operatorId: string; operatorName: string; permissions: GroupPermissions;
  role: string; allowedChannels: string[]; isCommercialConsultant: boolean;
  conversations: Row[]; contacts: Row[]; accounts: Row[]; deals: Row[]; tasks: Row[];
  templates: Row[]; quickResponses: Row[]; pipelines: Row[]; operators: Row[]; events: Row[]; directives: Row[];
  requests: Array<{ method: string; path: string; status: number }>;
  sequence: number;
  primaryDealId: string;
}
export function createTrainingStore(config: Pick<TrainingStore, "tenantId" | "operatorId" | "operatorName" | "permissions" | "role" | "allowedChannels" | "isCommercialConsultant">): TrainingStore {
  const primaryViews = new Set(["commercialHome", "chat", "crm", "tasks", "contacts", "wallet"]);
  config = { ...config, permissions: { ...config.permissions, views: Object.fromEntries(Object.entries(config.permissions.views).map(([key,value]) => [key, primaryViews.has(key) && value])) as GroupPermissions["views"] } };
  const f = createOnboardingDemoFixtures(config.tenantId, config.operatorName), now = new Date().toISOString();
  const stages = ["Qualificação Técnica", "Negociação", "Fechamento"].map((name, i) => ({ id: `demo:stage-${i + 1}`, name, order: i, orderIndex: i, position: i, requiredFields: [], isWinStage: i === 2, isLossStage: false, color: ["#6366f1", "#f59e0b", "#10b981"][i] }));
  const accounts = DEMO_ACCOUNTS.map((a) => ({ ...a, tenantId: config.tenantId, type: "company", document: a.cnpj, tradeName: a.name, email: "compras@example.test", phone: "11900000101", address: { city: a.city, state: a.state }, notes: "Cadastro fictício para treinamento", customFields: {}, contactsCount: 1, dealsCount: 1, createdAt: now, updatedAt: now }));
  const contacts = f.contacts.map((c, i) => ({ ...c, tenantId: config.tenantId, name: c.name, avatar: null, mainChannel: c.channel, latestOperatorId: config.operatorId, operatorId: config.operatorId, walletOperatorId: config.operatorId, responsibleName: config.operatorName, latestConversationId: `demo:conv-${i + 1}`, createdAt: now, updatedAt: now }));
  const tasks = f.tasks.map((t, i) => ({ ...t, tenantId: config.tenantId, name: t.subject, title: t.subject, dueDate: new Date(Date.now() + (i - 1) * 86400000).toISOString(), createdAt: now, operatorId: config.operatorId, operatorIdName: config.operatorName, operatorName: config.operatorName, client: { name: contacts[i]?.name || contacts[0].name, phone: "11900000101" }, deal: { id: `demo:deal-${i + 1}`, name: f.deals[i]?.title || f.deals[0].title }, chatContactId: contacts[i]?.id || contacts[0].id, chatConversationId: `demo:conv-${i + 1}`, description: "Próximo contato de demonstração" }));
  const deals = f.deals.map((d, i) => ({ ...d, tenantId: config.tenantId, title: d.title, name: d.title, pipelineId: "demo:pipeline-1", stageId: stages[i % 3].id, stageName: stages[i % 3].name, status: "open", value: String(d.value), currency: "BRL", version: 1, operatorId: config.operatorId, operatorName: config.operatorName, ownerId: config.operatorId, account: accounts[i % accounts.length], accountId: accounts[i % accounts.length].id, contacts: [{ id: `demo:participant-${i}`, contactId: contacts[i]?.id || contacts[0].id, isPrimary: true, role: "Comprador", contact: contacts[i] || contacts[0] }], contactsCount: 1, conversationsCount: 1, nextTask: tasks[i] ? { ...tasks[i], isOverdue: i === 0 } : null, activities: tasks[i] ? [{ ...tasks[i], dealId: d.id, status: "pending", type: tasks[i].type || "task" }] : [], files: [{ id: `demo:file-${i + 1}`, fileName: "proposta-tecnica-vsf.pdf", mimeType: "application/pdf", fileSize: 102400, createdAt: now, uploaderName: config.operatorName }], customFields: {}, createdAt: now, updatedAt: now, lastActivityAt: now }));
  const fallbackChannel = (config.allowedChannels[0] || "whatsapp") as "whatsapp" | "instagram" | "messenger" | "livechat";
  const conversations = f.conversations.map((c, i) => ({ ...c, channel: config.allowedChannels.includes(c.channel) ? c.channel : fallbackChannel, tenantId: config.tenantId, name: c.contactName, phone: c.contactPhone, email: contacts[i]?.email || "cliente@example.test", avatar: "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2748%27 height=%2748%27%3E%3Crect width=%2748%27 height=%2748%27 rx=%2724%27 fill=%27%236366f1%27/%3E%3C/svg%3E", initials: c.contactName.slice(0, 2), tags: c.tags, queue: c.queueState, operatorId: c.ownerMode === "self" ? config.operatorId : c.ownerMode === "colleague" ? "demo:colleague" : null, walletOperatorId: config.operatorId, responsibleName: c.ownerName, whatsappConnectionId: "demo:connection", version: 1, lastMessageAtISO: now, lastClientMessageAtISO: now, cnpj: c.cnpj || "", hasSiteJourney: true, siteVisitorId: "demo:visitor", currentDealId: deals[i % deals.length].id, messages: [
    { id: `demo:message-${i}-in`, conversationId: c.id, author: c.contactName, text: c.lastMessagePreview, side: "in", time: "14:20", date: now, sentAtISO: now, status: "read", provider: "meta" },
    { id: `demo:message-${i}-out`, conversationId: c.id, author: config.operatorName, text: "Vou verificar a aplicação e registrar o próximo passo.", side: "out", time: "14:21", date: now, sentAtISO: now, status: "read", provider: "meta", knowledgeSourceStatus: "verified", knowledgeSources: [{ id: "demo:manual", kind: "manual", title: "Manual de demonstração VSF", code: "VSF", excerptOrDetail: "Exemplo fictício de documentação técnica.", verified: true }] },
    { id: `demo:message-${i}-media`, conversationId: c.id, author: c.contactName, text: "[LOCAL_MEDIA:image:data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27120%27 height=%2780%27%3E%3Crect width=%27120%27 height=%2780%27 rx=%2712%27 fill=%27%236366f1%27/%3E%3C/svg%3E:equipamento-demo.svg]", side: "in", time: "14:22", date: now, sentAtISO: now, status: "read", provider: "meta" },
    { id: `demo:message-${i}-audio`, conversationId: c.id, author: c.contactName, text: "[LOCAL_MEDIA:audio:data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=:audio-demo.wav]", side: "in", time: "14:23", date: now, sentAtISO: now, status: "read", provider: "meta" },
    { id: `demo:message-${i}-system`, conversationId: c.id, author: "Sistema", senderType: "system", text: "[Nota] Negociação vinculada ao atendimento de demonstração.", isInternalNote: true, side: "out", time: "14:24", date: now, sentAtISO: now },
  ] }));
  return { ...config, conversations, contacts, accounts, deals, tasks,
    directives: f.directives.map((d) => ({ ...d, dealValue: d.value, status: d.status === "completed" ? "completed" : "pending", overdue: d.status === "overdue", assignedDate: now.slice(0,10), dueAt: now })),
    templates: f.personalTemplates.map((t) => ({ ...t, tenantId: config.tenantId, name: t.title, content: t.text, operatorId: config.operatorId })),
    quickResponses: f.personalTemplates.map((t) => ({ ...t, tenantId: config.tenantId, shortcut: "/saudacao", category: "Atendimento", ownerId: t.isGlobal ? null : config.operatorId, operatorId: t.isGlobal ? null : config.operatorId })),
    pipelines: [{ id: "demo:pipeline-1", name: "Funil Máquinas", isDefault: true, stages }, { id: "demo:pipeline-2", name: "Funil Soluções", stages }],
    operators: [{ id: config.operatorId, tenantId: config.tenantId, name: config.operatorName, email: "operador@example.test", role: config.role, status: "disponivel", groupId: "demo:group", avatar: "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2748%27 height=%2748%27%3E%3Crect width=%2748%27 height=%2748%27 rx=%2724%27 fill=%27%236366f1%27/%3E%3C/svg%3E" }, { id: "demo:colleague", tenantId: config.tenantId, name: "Colega de demonstração", email: "colega@example.test", status: "disponivel", groupId: "demo:group", avatar: "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2748%27 height=%2748%27%3E%3Crect width=%2748%27 height=%2748%27 rx=%2724%27 fill=%27%236366f1%27/%3E%3C/svg%3E" }],
    events: [], requests: [], sequence: 0, primaryDealId: f.deals[0].id };
}

/** An in-memory API used only by the iframe. No network fallback, including for reads. */
export async function handleTrainingRequest(store: TrainingStore, input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, "https://training.invalid");
  const path = decodeURIComponent(url.pathname), method = (init.method || (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  let body: Row = {};
  try { if (typeof init.body === "string") body = JSON.parse(init.body); } catch { return new Response(JSON.stringify({ error: "Dados de demonstração inválidos." }), { status: 400 }); }
  const reply = (data: unknown, status = 200) => { store.requests.push({ method, path, status }); return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "X-Onboarding-Demo": "memory" } }); };
  const find = (rows: Row[], id?: string | null) => rows.find((r) => r.id === id);
  const id = (prefix: string) => `demo:created-${prefix}-${++store.sequence}`;
  const search = (rows: Row[]) => { const q = (url.searchParams.get("search") || url.searchParams.get("dealSearch") || "").toLowerCase(); return rows.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q)); };
  const operator = store.operators[0], tenantId = store.tenantId;
  const createTask = (data: Row, deal: Row) => {
    const contact = deal.contacts?.[0]?.contact || store.contacts.find(c => c.accountId === deal.accountId) || store.contacts[0];
    return { ...data, id: id("task"), tenantId, name:data.title, subject:data.title, dealId:deal.id,
      deal:{id:deal.id,name:deal.title}, client:{name:contact.name,phone:contact.phone},
      operatorId:data.assignedToOperatorId || store.operatorId, operatorName:store.operatorName,
      chatContactId:contact.id,chatConversationId:contact.latestConversationId,
      type:data.type || "task",status:data.status || "pending",createdAt:new Date().toISOString() };
  };
  const group = { id: "demo:group", tenantId, name: "Acesso do treinamento", allowedTenants: [tenantId], allowedChannels: store.allowedChannels, permissions: store.permissions, canCaptureChat: true, canTransferChat: true, canFinishChat: true, canViewAllChats: true, canEditProfile: true };
  if (path === "/api/auth/session") return reply({ authenticated: true, success: true, tenantId, operator, permissions: store.permissions, accessGroup: group, availableTenants: [tenantId], isCommercialConsultant: store.isCommercialConsultant, commercialDivision: store.isCommercialConsultant ? "maquinas" : null, channelConfig: { activeProvider: "meta" } });
  if (path.startsWith("/api/auth/")) return reply({ error: "A sessão operacional não é alterada no treinamento." }, 403);
  if (path === "/api/operators/onboarding") return reply({ enabled: false, tenantId, operatorId: store.operatorId, status: "not_started", currentStepId: null, completedStepIds: [], capabilities: { allowedChannels: store.allowedChannels } });
  if (path === "/api/operators/profile") { if (method !== "GET") Object.assign(operator, body); return reply({ success: true, operator, ...operator }); }
  if (path === "/api/operators") return reply(store.operators);
  if (path === "/api/groups") return reply([group]);
  if (path === "/api/sectors") return reply([{ id: "demo:sector", tenantId, name: "Equipe de demonstração", operatorIds: store.operators.map((o) => o.id) }]);
  if (path === "/api/commercial/home") {
    if (!store.isCommercialConsultant) return reply({ error: "Início comercial indisponível para este perfil." }, 403);
    const now = new Date().toISOString();
    if (method === "PATCH") {
      const targetIds = Array.isArray(body.directiveIds) ? body.directiveIds : [];
      for (const dir of store.directives) {
        if (body.markAll || targetIds.includes(dir.id)) {
          dir.notificationReadAt = now;
        }
      }
      return reply({ success: true, updatedCount: store.directives.length, notificationReadAt: now });
    }
    return reply({ asOf: now, today: now.slice(0,10), month: now.slice(0,7), consultant: { id: store.operatorId, name: store.operatorName, avatar: operator.avatar, division: "maquinas" }, goal: { configured: true, targetValue: 100000, realizedValue: 40000, conversionRate: 25, businessDays: 22, elapsedDays: 12, remainingDays: 10, expectedPercent: 55, coveragePercent: 40, dailyRequired: 6000 }, deals: { openCount: store.deals.length, openValue: store.deals.reduce((v,d) => v + Number(d.value),0), wonThisMonthCount: 1 }, wonDeals: [], calendarDays: [], activities: store.tasks.map(t => { const deal = find(store.deals, t.deal?.id || t.dealId); return { id:t.id,title:t.name,type:t.type||"task",description:t.description||null,status:t.status||"pending",dueDate:t.dueDate,dealId:t.deal.id,dealTitle:t.deal.name,dealValue:Number(deal?.value||0),stageName:deal?.stageName||"Qualificação",accountId:deal?.accountId||store.accounts[0]?.id||null,accountName:deal?.account?.name||store.accounts[0]?.name||null,contactId:t.chatContactId||store.contacts[0]?.id||null,contactName:t.client?.name||store.contacts[0]?.name||null,contactPhone:t.client?.phone||store.contacts[0]?.phone||null,conversationId:t.chatConversationId||store.conversations[0]?.id||null }; }), directives: store.directives.map(d => { const deal = find(store.deals, d.dealId); return { ...d, accountId: d.accountId || deal?.accountId || store.accounts[0]?.id || null, accountName: d.accountName || deal?.account?.name || store.accounts[0]?.name || null, contactId: d.contactId || store.contacts[0]?.id || null, contactName: d.contactName || store.contacts[0]?.name || null, contactPhone: d.contactPhone || store.contacts[0]?.phone || null, conversationId: d.conversationId || store.conversations[0]?.id || null, assignedByOperatorName: d.assignedByOperatorName || "Gestão Comercial" }; }) });
  }
  const evidence = path.match(/^\/api\/commercial\/directives\/([^/]+)\/evidence$/);
  if (evidence) {
    const directive = find(store.directives, evidence[1]);
    if (!directive || !store.isCommercialConsultant) return reply({error:"Diretriz fictícia indisponível."},404);
    const deal = find(store.deals, directive.dealId);
    if (method === "GET") return reply({ directive, deal, contacts: store.contacts.map(c => ({...c,conversationId:c.latestConversationId,totalMessages:3,totalMedia:0})), activeConversationId:store.conversations[0].id,calls:[],emails:[] });
    if (!body.summary?.trim() || !["call","whatsapp","email"].includes(body.channel)) return reply({error:"Registre a evidência."},422);
    if (body.nextAction === "continue" && (!body.nextTaskTitle?.trim() || !body.nextTaskDueAt || Date.parse(body.nextTaskDueAt) <= Date.now())) return reply({error:"Informe o próximo compromisso futuro."},422);
    if (body.nextAction === "lost" && !body.lossReason) return reply({error:"Informe o motivo da perda."},422);
    Object.assign(directive,{status:"completed",completionNote:body.summary,evidenceChannel:body.channel,completedAt:new Date().toISOString()});
    if(deal && ["won","lost"].includes(body.nextAction)) Object.assign(deal,{status:body.nextAction,lossReason:body.lossReason});
    if(body.nextAction === "continue" && deal) store.tasks.push(createTask({title:body.nextTaskTitle,dueDate:body.nextTaskDueAt,description:body.nextTaskDescription},deal));
    return reply({success:true,directive});
  }
  for (const [prefix, rows, key] of [["/api/quick-responses", store.quickResponses, "text"], ["/api/templates", store.templates, "text"]] as const) {
    if (path === prefix) {
      if (method === "GET") return reply(rows);
      const rowId = body.id || url.searchParams.get("id"), row = find(rows, rowId);
      if (method === "DELETE") { if (row) rows.splice(rows.indexOf(row), 1); return reply({ success: true }); }
      if (!(body[key] || body.content || row?.[key])) return reply({ error: "Preencha o texto." }, 422);
      if (row) Object.assign(row, body); else rows.push({ ...body, id: id("template"), tenantId, operatorId: store.operatorId });
      return reply({ success: true, ...rows.at(-1) });
    }
  }
  if (path === "/api/chats" && url.searchParams.has("ownership")) return reply({ operatorId: store.operatorId, role: store.role, permissions: store.permissions, conversations: store.conversations.map(({ id, operatorId, queue, version }) => ({ id, operatorId, queue, version })) });
  if (path === "/api/chats" && body.action === "checkAccess") return reply({ allowedIds: store.conversations.map((c) => c.id), conversations: store.conversations });
  if (path === "/api/chats") {
    if (method === "GET") return reply(store.conversations);
    const row = find(store.conversations, body.conversationId || body.id);
    if (row && body.message) row.messages.push({ ...body.message, id: body.message.id || id("message") });
    if (row) Object.assign(row, body.updates || {});
    return reply({ success: true, conversation: row, message: row?.messages.at(-1), id: row?.id });
  }
  if (path === "/api/chats/update-queue") { const row = find(store.conversations, body.conversationId); if (!row) return reply({ error: "Atendimento fictício não encontrado." }, 404); const nextQueue = body.queueState ?? body.queue ?? row.queue; const nextOpId = body.operatorId !== undefined ? body.operatorId : row.operatorId; Object.assign(row, { queue: nextQueue, operatorId: nextOpId, ...(nextQueue === "meus" && nextOpId ? { walletOperatorId: nextOpId } : {}), version: row.version + 1 }); return reply({ success: true, conversation: row, ...row }); }
  const contextRoute = path.match(/^\/api\/chats\/([^/]+)\/deal-context$/);
  if (contextRoute) {
    const conversation = find(store.conversations, contextRoute[1]);
    if (method === "PATCH" && conversation && find(store.deals,body.dealId)) { conversation.currentDealId=body.dealId; conversation.version++; }
    const currentDeal = find(store.deals, conversation?.currentDealId);
    return reply({ conversationId:conversation?.id, contactId:conversation?.contactId, currentDeal, previousDeal:null, hasCurrentDeal:!!currentDeal, editable:true, selectionRequired:!currentDeal, deals:store.deals.map(d=>({...d,isLinked:true})), linkedDeals:store.deals, requiresDealSelection:!currentDeal, version:conversation?.version || 1 });
  }
  const conversationRoute = path.match(/^\/api\/chats\/([^/]+)\/(messages|deals|deal-requirement|events)$/);
  if (conversationRoute) {
    const conversation = find(store.conversations,conversationRoute[1]);
    if (!conversation) return reply({error:"Atendimento fictício não encontrado."},404);
    if (conversationRoute[2] === "messages") return reply({messages:conversation.messages,nextCursor:null});
    if (conversationRoute[2] === "deals") return reply({deals:store.deals.filter(d=>d.id===conversation.currentDealId),dealRequired:false,currentDealRequired:false,contact:store.contacts.find(c=>c.id===conversation.contactId)||store.contacts[0],customFieldDefinitions:[]});
    if (conversationRoute[2] === "events") {
      if (method !== "GET") store.events.unshift({ id: id("att-event"), conversationId: conversation.id, eventType: body.eventType || "note.form_opened", description: body.description || "Evento registrado no treinamento.", actorName: store.operatorName, createdAt: new Date().toISOString(), dealId: conversation.currentDealId, pendingBinding: false, legacy: false });
      const attEvents = store.events.filter(e => e.conversationId === conversation.id);
      return reply({ success: true, events: attEvents.length ? attEvents : [{ id: "demo:att-event-1", conversationId: conversation.id, eventType: "attendance.captured", description: "Atendimento de demonstração iniciado pelo operador.", actorName: store.operatorName, createdAt: new Date().toISOString(), dealId: conversation.currentDealId, pendingBinding: false, legacy: false }], nextCursor: null });
    }
    return reply({pending:false,currentRequired:false,selectionRequired:false,hasCurrentDeal:!!conversation.currentDealId,version:conversation.version});
  }
  if (path === "/api/chats/tag-task") {
    const row = find(store.conversations, body.conversationId) || store.conversations[0];
    if (!String(body.tagName || "").trim()) return reply({ error: "Preencha o título da tarefa." }, 422);
    const deal = find(store.deals, body.dealId || row?.currentDealId) || store.deals[0];
    const dueAt = body.dueDate ? `${body.dueDate}T${body.dueTime || "09:00"}:00.000Z` : new Date(Date.now() + 86400000).toISOString();
    const task = createTask({ title: body.tagName, type: body.taskType || "task", dueDate: dueAt }, deal);
    store.tasks.push(task);
    if (row && !row.tags.includes(body.tagName)) row.tags.push(body.tagName);
    return reply({ success: true, task });
  }
  if (path === "/api/chats/resolve") {
    const key = (url.searchParams.get("key") || "").trim();
    const digits = key.replace(/\D/g, "");
    const row = store.conversations.find((c) => c.id === key || (digits && String(c.phone || "").replace(/\D/g, "") === digits)) || store.conversations[0];
    return reply({ success: true, conversationId: row?.id || store.conversations[0].id, conversation: row });
  }
  if (path.startsWith("/api/chats/") || path === "/api/whatsapp/send") {
    const row = find(store.conversations, body.conversationId || url.searchParams.get("conversationId"));
    if (method !== "GET" && row && (body.text || body.message)) row.messages.push({ id: id("message"), conversationId: row.id, author: store.operatorName, text: body.text || body.message, time: "14:30", side: "out", status: "read", provider: "meta" });
    return reply({ success: true, messages: row?.messages || [], conversation: row, messageId: row?.messages.at(-1)?.id, ...row });
  }
  if (path === "/api/crm/pipelines") return reply({ pipelines: store.pipelines });
  if (path === "/api/crm/stage-settings") return reply({ settings: [], stages: [] });
  if (/^\/api\/crm\/pipelines\/[^/]+\/stages-summary$/.test(path)) return reply({ stages: store.pipelines[0].stages.map((s: Row) => { const deals=store.deals.filter(d=>d.stageId===s.id),totalValue=deals.reduce((n,d)=>n+Number(d.value),0); return { stageId:s.id,dealsCount:deals.length,knownValueDealsCount:deals.filter(d=>d.value!=null).length,totalValue,formattedTotalValue:totalValue.toLocaleString("pt-BR",{style:"currency",currency:"BRL"}) }; }) });
  if (path === "/api/crm/deals") {
    if (method === "GET") { let rows = search(store.deals); const stage = url.searchParams.get("stageId"), status = url.searchParams.get("status"); if (stage) rows = rows.filter((d) => d.stageId === stage); if (status && status !== "all") rows = rows.filter((d) => d.status === status); return reply({ deals: rows, total: rows.length, hasMore: false }); }
    if (!(body.title || "").trim() || !body.stageId || !body.pipelineId) return reply({ error: "Preencha o título, funil e etapa." }, 422);
    const account = find(store.accounts, body.accountId) || null, contact = find(store.contacts, body.contactId);
    const deal = { ...body, id: id("deal"), tenantId, value: body.value == null ? null : String(body.value), account, accountId: account?.id || null, status: "open", version: 1, contacts: contact ? [{ contactId: contact.id, contact, isPrimary: true }] : [], contactsCount: contact ? 1 : 0, conversationsCount: 0, customFields: body.customFields || {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    store.deals.unshift(deal); return reply({ success: true, deal }, 201);
  }
  if (path.startsWith("/api/crm/deals/bulk")) {
    const rows = store.deals.filter((d) => (body.dealIds || body.ids || []).includes(d.id));
    if (!rows.length) return reply({ error: "Selecione negociações da demonstração." }, 422);
    if (body.action === "create_tasks") {
      if (!body.taskData?.title?.trim() || !body.taskData?.dueDate) return reply({error:"Preencha assunto e data da tarefa."},422);
      for (const row of rows) store.tasks.push(createTask(body.taskData,row));
    } else if (["delete_trash","delete_permanent"].includes(body.action)) {
      for (const row of rows) { if(body.action==="delete_trash") row.status="deleted"; else store.deals.splice(store.deals.indexOf(row),1); }
    } else if (body.action) return reply({error:"Esta ação em massa ainda não foi preparada no treinamento."},501);
    else {
      const fields = Object.fromEntries(Object.entries(body).filter(([key])=>["operatorId","status","lossReason","pipelineId","stageId","rating","campaign","source","productId"].includes(key)));
      if (!Object.keys(fields).length) return reply({error:"Selecione a alteração em massa."},422);
      for (const row of rows) { Object.assign(row, fields); row.version++; }
    }
    return reply({ success: true, updated: rows.length, results: rows });
  }
  const dealRoute = path.match(/^\/api\/crm\/deals\/([^/]+)(?:\/(.+))?$/);
  if (dealRoute) {
    const deal = find(store.deals, dealRoute[1]); if (!deal) return reply({ error: "Negociação de demonstração não encontrada." }, 404);
    const part = dealRoute[2];
    if (!part) { if (method !== "GET") { Object.assign(deal, body); deal.version++; } const activities = store.tasks.filter(t => t.dealId === deal.id || t.deal?.id === deal.id); const enriched = { ...deal, activities, files: deal.files || [] }; return reply({ deal: enriched, ...enriched }); }
    if (part === "conversations") return reply({ conversations: store.conversations.filter((c) => c.currentDealId === deal.id), availableConversations: store.conversations });
    if (part.startsWith("activities")) {
      if (method !== "GET") {
        const task = find(store.tasks, body.id || part.split("/")[1]);
        if (task && method === "DELETE") store.tasks.splice(store.tasks.indexOf(task),1);
        else if (task) Object.assign(task, body, body.title ? {name:body.title,subject:body.title} : {});
        else if (!body.title?.trim()) return reply({ error: "Preencha o título da atividade." }, 422);
        else store.tasks.push(createTask(body,deal));
      }
      const activities = store.tasks.filter(t => t.dealId === deal.id || t.deal?.id === deal.id);
      return reply({ success: true, activities, activity: activities.at(-1) });
    }
    if (part === "contacts" || part === "participants") { if (method !== "GET") { const contact = find(store.contacts, body.contactId); if (contact) deal.contacts.push({ id: id("participant"), contactId: contact.id, contact, role: body.role || "Comprador", isPrimary: !deal.contacts.length }); } return reply({ success: true, contacts: deal.contacts, participants: deal.contacts }); }
    if (part.includes("note") && method !== "GET") { if (!String(body.content || body.text || body.description || "").trim()) return reply({ error: "Escreva a anotação." }, 422); store.events.push({ ...body, id: id("event"), dealId: deal.id, type: "note_created", createdAt: new Date().toISOString(), operatorName: store.operatorName }); }
    if (part.includes("histor") || part === "events") return reply({ events: store.events, history: store.events });
    if (part.startsWith("files")) return reply({ success: true, files: deal.files || [], items: deal.files || [], data: deal.files || [] });
    if (["products", "evidence", "marketing-history", "custom-fields"].some((p) => part.startsWith(p))) return reply({ success: true, [part.split("/")[0]]: [], items: [], fields: [], data: [] });
  }
  if (path === "/api/crm/contacts" || path === "/api/contacts") {
    if (method === "GET") return reply({ contacts: search(store.contacts), total: search(store.contacts).length, hasMore: false });
    if (!(body.name || "").trim()) return reply({ error: "Preencha o nome." }, 422);
    const contact = { ...body, id: id("contact"), tenantId, tags: body.tags || [], mainChannel: body.channel || "whatsapp", createdAt: new Date().toISOString() }; store.contacts.unshift(contact); return reply({ success: true, contact }, 201);
  }
  if (path === "/api/contacts/check-inactivity") return reply({ contacts: store.contacts, inactiveContacts: [], count: 0, over50Count: 0, over60Count: 0 });
  if (path === "/api/contacts/account-options") { const account=find(store.accounts,url.searchParams.get("id"));return reply(account ? {account} : {accounts:search(store.accounts)}); }
  if (path === "/api/contacts/update-wallet") { const contact=find(store.contacts,body.contactId);if(!contact)return reply({error:"Contato fictício não encontrado."},404);contact.walletOperatorId=body.walletOperatorId;for(const c of store.conversations.filter(c=>c.contactId===contact.id))c.walletOperatorId=body.walletOperatorId;return reply({success:true,contact}); }
  const contactRoute = path.match(/^\/api\/contacts\/([^/]+)(?:\/(.+))?$/);
  if (contactRoute) { const contact = find(store.contacts, contactRoute[1]); if (!contact) return reply({ error: "Contato fictício não encontrado." }, 404); if (contactRoute[2] === "conversations") return reply({ conversations: store.conversations.filter((c) => c.contactId === contact.id), conversation: store.conversations.find((c) => c.contactId === contact.id), requiresDealSelection: false, deals: store.deals }); if (method !== "GET") Object.assign(contact, body); return reply({ success: true, contact, ...contact }); }
  if (path === "/api/crm/accounts") { if (method === "GET") return reply({ accounts: search(store.accounts), total: search(store.accounts).length }); if (!body.name?.trim()) return reply({ error: "Preencha o nome do comprador." }, 422); const account = { ...body, id: id("account"), tenantId, customFields: {}, createdAt: new Date().toISOString() }; store.accounts.unshift(account); return reply({ success: true, account }, 201); }
  const accountRoute = path.match(/^\/api\/crm\/accounts\/([^/]+)(?:\/(.+))?$/);
  if (accountRoute) { const account = find(store.accounts, accountRoute[1]); if (!account) return reply({ error: "Comprador fictício não encontrado." }, 404); if (method !== "GET") Object.assign(account, body); const result = { ...account, contacts: store.contacts.filter((c) => c.accountId === account.id), deals: store.deals.filter((d) => d.accountId === account.id), conversations: [], history: [] }; return reply({ success: true, account: result, ...result }); }
  if (path === "/api/tasks") { if (method !== "GET") { const task = find(store.tasks, body.taskId || body.id); if (!task) return reply({error:"Tarefa fictícia não encontrada."},404); Object.assign(task, body); } return reply({ configured: true, tasks: store.tasks, success: true }); }
  if (path === "/api/valentina/catalog-images") {
    if (url.searchParams.get("action") === "rawImage") {
      store.requests.push({ method, path, status: 200 });
      return new Response("<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80'><rect width='120' height='80' rx='12' fill='#6366f1'/></svg>", { status: 200, headers: { "Content-Type": "image/svg+xml" } });
    }
    const svgDataUrl = "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27120%27 height=%2780%27%3E%3Crect width=%27120%27 height=%2780%27 rx=%2712%27 fill=%27%236366f1%27/%3E%3C/svg%3E";
    return reply({
      items: [{ id: "demo:catalog-img-1", name: "envasadora-vsf.svg", displayName: "Envasadora VSF — Foto Oficial", title: "Envasadora VSF — Foto Oficial", sku: "PAMQGPAU079", category: "Envasadoras", fileName: "envasadora-vsf.svg", mimeType: "image/svg+xml", fileSize: 1024, size: "1 KB", type: "image", uploadedAt: new Date().toISOString(), codes: ["VSF", "PAMQGPAU079"], imageUrl: svgDataUrl, mediaUrl: svgDataUrl, thumbnailUrl: svgDataUrl, summary: "Foto ilustrativa do equipamento para treinamento" }],
      categories: [{ name: "Envasadoras", count: 1 }],
    });
  }
  if (path === "/api/valentina/messages" && method === "GET") return reply([{ id: "demo:assistant-source", role: "assistant", content: "Exemplo fictício: confirme tensão, capacidade e aplicação no manual antes de orientar o cliente.", createdAt: new Date().toISOString(), metadata: { knowledgeSourceStatus: "verified", knowledgeSources: [{ id: "demo:manual", kind: "manual", title: "Manual fictício de treinamento", excerptOrDetail: "Documento sintético; não representa especificações de um produto real.", verified: true }] } }]);
  if (path.startsWith("/api/valentina/")) return reply({ messages: [], history: [], success: true, response: "Resposta fictícia: consulte o manual e confirme os requisitos da aplicação.", text: "Texto de demonstração revisado.", suggestions: ["Confirmar aplicação", "Registrar próximo passo"] });
  if (path.startsWith("/api/whatsapp/connections")) {
    if (method !== "GET") return reply({ success: true, conversationId: body.sourceConversationId || store.conversations[0].id, queueState: "meus" });
    return reply({ enabled:true,canManage:false,canSwitchDuringAttendance:true,encryptionReady:true,accessGroups:[],connections: [{ id: "demo:connection", tenantId, name: "Canal de demonstração", phone: "11900000101", provider: "meta", corporate:true, status: "connected", enabled: true, canSend:true,ownerOperatorId: store.operatorId }, { id: "demo:connection-2", tenantId, name: "Canal secundário", phone: "11900000102", provider: "meta", corporate:false, status: "connected", enabled: true, canSend:true,ownerOperatorId: store.operatorId }], multiConnectionEnabled: true });
  }
  if (path === "/api/whatsapp/contact-history") { const c=find(store.conversations,url.searchParams.get("conversationId"));return reply({messages:c?.messages || [],visibleConversationIds:c?[c.id]:[],nextCursor:null}); }
  if (path === "/api/whatsapp/meta-state") return reply({window:{open:true,expiresAt:new Date(Date.now()+86400000).toISOString()},provider:"meta",templates:store.templates.map(t=>({...t,name:"retorno_orcamento",language:"pt_BR",category:"UTILITY",bodyText:t.text,variableCount:0,bindings:{},status:"APPROVED",supported:true,components:[{type:"BODY",text:t.text}]})),customGroups:[]});
  if (path.startsWith("/api/whatsapp/templates")) return reply({ templates: store.templates.map((t) => ({ ...t, name: "retorno_orcamento", language: "pt_BR", status: "APPROVED", components: [{ type: "BODY", text: t.text }] })) });
  if (path.startsWith("/api/settings/")) return reply({ configured: false, enabled: false, activeProvider: "meta", status: "connected" });
  if (path.includes("catalog") || path.includes("products")) return reply({ products: [{ id: "demo:product", name: "Envasadora VSF", title: "Envasadora VSF", sku: "DEMO-VSF", description: "Equipamento fictício para treinamento", price: 1500, photos: [], images: [] }], items: [], categories: [], folders: [] });
  if (path.includes("custom-fields")) return reply({ fields: [{id:"demo:custom-field",entityType:url.searchParams.get("entity") || "deal",name:"Aplicação (treinamento)",fieldType:"text",options:[],required:false,visibleOnCreate:true,allPipelines:true,pipelineIds:[],sortOrder:0,createdAt:new Date().toISOString()}], groups: [], options: [] });
  if (path.includes("journey") || path.includes("site-context")) return reply({ visitor: { id: "demo:visitor", name: store.contacts[0].name }, pages: [{ id: "demo:page", url: "/catalogo/vsf", title: "Envasadora VSF", visits: 2 }], events: [{ id: "demo:visit", type: "page_view", title: "Consulta ao catálogo VSF", createdAt: new Date().toISOString() }], summary: { totalPages: 1, totalVisits: 2 }, timeline: [] });
  // Explicitly unavailable features never pretend to complete an operation.
  return reply({ error: "Este recurso ainda não está preparado para a demonstração.", code: "DEMO_ENDPOINT_UNAVAILABLE" }, 501);
}


