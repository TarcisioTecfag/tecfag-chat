import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, boolean, jsonb, numeric, index, uniqueIndex } from "drizzle-orm/pg-core";

// ─── 1. TENANTS (Empresas: Valem, Tecfag) ──────────────────────────────────
export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(), // 'valem' | 'tecfag'
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  connectionType: text("connection_type").notNull(), // 'meta' | 'baileys'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 2. CONFIGURAÇÕES DE CANAL (Credenciais / Conexão) ──────────────────────
export const channelConfigs = pgTable("channel_configs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  
  // Controle central de provedor ativo e versão de conexão
  activeProvider: text("active_provider").default("baileys").notNull(), // 'baileys' | 'meta'
  connectionStatus: text("connection_status").default("disconnected").notNull(), // 'disconnected' | 'connecting' | 'connected' | 'error'
  connectionVersion: integer("connection_version").default(1).notNull(),
  lastError: text("last_error"),

  // Configurações exclusivas da API Meta (Tec Chat)
  metaBusinessAccountId: text("meta_business_account_id"),
  metaPhoneNumberId: text("meta_phone_number_id"),
  metaAccessToken: text("meta_access_token"),
  metaVerifyToken: text("meta_verify_token"),
  metaAppSecret: text("meta_app_secret"), // Segredo da aplicação Meta para validar assinatura HMAC SHA-256 do webhook

  // Configurações exclusivas do Baileys (Valem Chat)
  baileysSessionStatus: text("baileys_session_status").default("disconnected"), // 'disconnected' | 'qr_ready' | 'connected'
  baileysPairedPhone: text("baileys_paired_phone"),
  baileysAuthKeys: jsonb("baileys_auth_keys"), // Guarda o JSON de autenticação gerado pelo Baileys
  
  // Configurações de Relatórios Automáticos
  reportDailyWhatsapp: boolean("report_daily_whatsapp").default(false).notNull(),
  reportDailyEmail: boolean("report_daily_email").default(false).notNull(),
  reportWeeklyWhatsapp: boolean("report_weekly_whatsapp").default(false).notNull(),
  reportWeeklyEmail: boolean("report_weekly_email").default(false).notNull(),
  reportWhatsappNumbers: text("report_whatsapp_numbers"),
  reportEmailAddresses: text("report_email_addresses"),
  // Aprovação obrigatória antes do envio: se true, o cron apenas gera o rascunho
  // e aguarda aprovação manual do operador para disparar.
  reportRequiresApproval: boolean("report_requires_approval").default(false).notNull(),

  // Configurações de E-mail SMTP
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPass: text("smtp_pass"),
  smtpFrom: text("smtp_from"),

  // Integração RD Station CRM (OAuth2 com refresh token rotativo)
  rdCrmClientId: text("rd_crm_client_id"),
  rdCrmClientSecret: text("rd_crm_client_secret"),
  rdCrmAccessToken: text("rd_crm_access_token"),
  rdCrmRefreshToken: text("rd_crm_refresh_token"),
  rdCrmTokenExpiresAt: text("rd_crm_token_expires_at"), // timestamp ms como string

  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── 2.5. GRUPOS DE ACESSO (RBAC) ───────────────────────────────────────────
export const accessGroups = pgTable("access_groups", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  allowedTenants: jsonb("allowed_tenants").$type<string[]>().default([]).notNull(),
  allowedChannels: jsonb("allowed_channels").$type<string[]>().default([]).notNull(),
  canCreateUser: boolean("can_create_user").default(true).notNull(),
  canResetPassword: boolean("can_reset_password").default(true).notNull(),
  canEditProfile: boolean("can_edit_profile").default(true).notNull(),
  // ── Permissões de Atendimento (RBAC) ────────────────────────────────────────
  canCaptureChat: boolean("can_capture_chat").default(false).notNull(),
  canTransferChat: boolean("can_transfer_chat").default(false).notNull(),
  canFinishChat: boolean("can_finish_chat").default(false).notNull(),
  canViewAllChats: boolean("can_view_all_chats").default(false).notNull(),
  canOverrideChat: boolean("can_override_chat").default(false).notNull(),
  permissions: jsonb("permissions").$type<any>().default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 2.6. SETORES (Sectors) ─────────────────────────────────────────────────
export const sectors = pgTable("sectors", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  operatorIds: jsonb("operator_ids").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 3. OPERADORES / USUÁRIOS ──────────────────────────────────────────────
export const operators = pgTable("operators", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").default("agent").notNull(), // 'admin' | 'agent'
  avatar: text("avatar"), // Foto de perfil em Base64 compactada
  status: text("status").default("disponivel").notNull(), // 'disponivel' | 'ocupado' | 'ausente'
  groupId: text("group_id").references(() => accessGroups.id, { onDelete: "set null" }), // Referência para grupo de acesso/RBAC
  isOnline: boolean("is_online").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 3.5. SESSÕES DE AUTENTICAÇÃO DO SERVIDOR (HttpOnly Cookie Sessions) ──────
export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  operatorId: text("operator_id").references(() => operators.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(), // sha256 do token do cookie
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 3.5. CRM CONTAS (Clientes PF / PJ) ───────────────────────────────────
export const crmAccounts = pgTable("crm_accounts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(), // 'person' | 'company'
  name: text("name").notNull(),
  tradeName: text("trade_name"),
  documentType: text("document_type"), // 'cpf' | 'cnpj' | 'foreign' | 'other'
  document: text("document"), // Dígitos normalizados (sem pontuação)
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  address: jsonb("address").default({}).notNull(),
  customFields: jsonb("custom_fields").default({}).notNull(),
  notes: text("notes"),
  rdOrganizationId: text("rd_organization_id"),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  tenantNameIdx: index("idx_crm_accounts_tenant_name").on(table.tenantId, table.name),
  tenantDocIdx: uniqueIndex("idx_crm_accounts_tenant_doc_uniq").on(table.tenantId, table.document).where(sql`document IS NOT NULL AND document != ''`),
}));

// ─── 4. CONTATOS (Base de Clientes) ─────────────────────────────────────────
export const contacts = pgTable("contacts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  // Cliente principal atual do contato (1:N: uma conta compradora possui múltiplos contatos)
  accountId: text("account_id").references(() => crmAccounts.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  phone: text("phone"),
  // JID completo do WhatsApp (ex: '5514981468232@s.whatsapp.net').
  // Usado para envio confiável — evita reconstrução frágil a partir do telefone.
  whatsappJid: text("whatsapp_jid"),
  email: text("email"),
  cnpj: text("cnpj"),
  cpf: text("cpf"),
  avatar: text("avatar"), // URL da foto de perfil do contato
  tags: jsonb("tags").$type<string[]>().default([]).notNull(),
  mainChannel: text("main_channel").notNull(), // 'whatsapp' | 'instagram' | 'messenger'
  walletOperatorId: text("wallet_operator_id").references(() => operators.id, { onDelete: "set null" }),
  responsibleName: text("responsible_name").default("Na Fila").notNull(),
  rdCrmDealId: text("rd_crm_deal_id"),
  rdCrmDealLink: text("rd_crm_deal_link"),
  cnpjDetails: jsonb("cnpj_details").default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 5. CONVERSAS (Atendimentos / Filas) ─────────────────────────────────────
export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }).notNull(),
  operatorId: text("operator_id").references(() => operators.id, { onDelete: "set null" }), // Null indica que está na fila ou bot
  sectorId: text("sector_id").references(() => sectors.id, { onDelete: "set null" }), // Novo campo para vincular diretamente o setor à conversa
  
  queueState: text("queue_state").default("fila").notNull(), // 'meus' | 'fila' | 'automacao' | 'finalizados'
  unreadCount: integer("unread_count").default(0).notNull(),
  
  // Controle de concorrência otimista (Entrega C) e carimbo de atualização
  version: integer("version").default(1).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  lastMessageText: text("last_message_text"),
  lastMessageTime: timestamp("last_message_time").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 6. MENSAGENS (Histórico de Chat & Notas Internas) ───────────────────────
export const messages = pgTable("messages", {
  id: text("id").primaryKey(), // ID interno estável
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  
  senderType: text("sender_type").notNull(), // 'client' | 'agent' | 'bot' | 'system'
  senderName: text("sender_name").notNull(), // Ex: "Pedro Silva" ou "Fagner (Vendedor)"
  
  content: text("content").notNull(),
  isInternalNote: boolean("is_internal_note").default(false).notNull(), // TRUE renderiza como nota amarela
  
  quotedMessageId: text("quoted_message_id"),
  quotedMessageSender: text("quoted_message_sender"),
  quotedMessageContent: text("quoted_message_content"),

  // Interpretação textual de mídia feita pelo Gemini (imagem, áudio, PDF).
  mediaInterpretation: text("media_interpretation"),

  // ── Transporte Universal & Fila Confiável de Mensagens (Entregas A & B) ───────
  externalId: text("external_id"), // ID externo retornado pelo WhatsApp (Baileys stanzaId / Meta wamid)
  provider: text("provider").default("baileys"), // 'baileys' | 'meta' | 'system' | 'internal'
  direction: text("direction").default("inbound"), // 'inbound' | 'outbound'
  status: text("status").default("accepted").notNull(), // 'pending' | 'sending' | 'accepted' | 'delivered' | 'read' | 'failed' | 'unknown'
  idempotencyKey: text("idempotency_key"), // clientMessageId enviado pelo frontend para evitar envios duplicados
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  sentAt: timestamp("sent_at").defaultNow().notNull(),
});

// ─── 7. RESPOSTAS RÁPIDAS (Templates por Tenant) ────────────────────────────
export const quickResponses = pgTable("quick_responses", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  shortcut: text("shortcut").notNull(), // Ex: "/cnpj"
  text: text("text").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 8. ARQUIVOS E MÍDIAS PERSISTIDOS (Salvos em definitivo no banco) ───────
export const mediaFiles = pgTable("media_files", {
  id: text("id").primaryKey(), // o messageId da mídia
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }), // Isolamento por tenant
  conversationId: text("conversation_id"),
  fileName: text("file_name"),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size"),
  base64Data: text("base64_data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 8.5. RECEBIMENTOS PENDENTES (Caixa de entrada durável para Webhooks / Eventos) ───────
export const pendingInbounds = pgTable("pending_inbounds", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  provider: text("provider").notNull(), // 'baileys' | 'meta'
  externalEventId: text("external_event_id"), // ID do evento do provedor para deduplicação
  payload: jsonb("payload").notNull(),
  status: text("status").default("pending").notNull(), // 'pending' | 'processing' | 'processed' | 'failed'
  attempts: integer("attempts").default(0).notNull(),
  nextRetryAt: timestamp("next_retry_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
});

// ─── 9. SESSÕES DE CHAMADA (Ligações WebRTC) ─────────────────────────────────
export const callSessions = pgTable("call_sessions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  operatorId: text("operator_id").references(() => operators.id, { onDelete: "set null" }),
  roomId: text("room_id").notNull().unique(),          // UUID único da sala WebRTC
  status: text("status").default("waiting").notNull(), // 'waiting' | 'active' | 'ended' | 'missed'
  startedAt: timestamp("started_at"),                  // Quando o cliente entrou
  endedAt: timestamp("ended_at"),                      // Quando a chamada encerrou
  durationSeconds: integer("duration_seconds"),         // Duração total em segundos
  transcription: text("transcription"),                // Texto da transcrição (Groq Whisper)
  transcriptionMessageId: text("transcription_message_id"), // ID da nota interna gerada no chat
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 9. LOGS DE TEMPO DE RESPOSTA (SLA Engine) ───────────────────────────────
// Cada linha representa um ciclo: cliente enviou mensagem → agente respondeu.
// Quando o agente ainda não respondeu, agentResponseAt e responseTimeSeconds ficam null.
export const responseTimeLogs = pgTable("response_time_logs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  operatorId: text("operator_id").references(() => operators.id, { onDelete: "set null" }),

  clientMessageId: text("client_message_id").notNull(),       // ID da mensagem do cliente que abriu o ciclo
  clientMessageAt: timestamp("client_message_at").notNull(),  // Quando o cliente enviou

  agentResponseId: text("agent_response_id"),                 // ID da primeira resposta do agente (null = pendente)
  agentResponseAt: timestamp("agent_response_at"),            // Quando o agente respondeu
  responseTimeSeconds: integer("response_time_seconds"),      // Delta calculado em segundos

  isOverdue: boolean("is_overdue").default(false).notNull(),  // TRUE quando passou do limite de SLA
  overdueThresholdSeconds: integer("overdue_threshold_seconds").default(900).notNull(), // Limite em seg (default 15min)
  overdueNotifiedAt: timestamp("overdue_notified_at"),        // Quando foi marcado como overdue

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 10. AUDITORIAS DE CONVERSA POR I.A. ─────────────────────────────────────
// Uma linha por conversa finalizada. A IA analisa a transcrição completa
// e gera score, sentimento, flags de problema e insights acionáveis.
export const aiConversationAudits = pgTable("ai_conversation_audits", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  operatorId: text("operator_id").references(() => operators.id, { onDelete: "set null" }),
  contactName: text("contact_name"),          // Desnormalizado para exibição rápida sem joins

  // ── Resultado estruturado da IA ──
  performanceScore: integer("performance_score"),             // 0-100
  clientSentiment: text("client_sentiment"),                  // 'satisfeito' | 'neutro' | 'frustrado'

  // ── Flags booleanas de problema (indexáveis e filtráveis) ──
  hadLongResponseGap: boolean("had_long_response_gap").default(false).notNull(),
  hadMissedObjection: boolean("had_missed_objection").default(false).notNull(),
  hadRudeLanguage: boolean("had_rude_language").default(false).notNull(),
  hadNoFollowUp: boolean("had_no_follow_up").default(false).notNull(),

  // ── Textos gerados pela IA ──
  summary: text("summary"),                 // Resumo em 2-3 linhas do que aconteceu
  strengths: text("strengths"),             // O que o vendedor fez bem (específico)
  weaknesses: text("weaknesses"),           // O que o vendedor errou (com ref. à mensagem)
  actionableInsight: text("actionable_insight"), // 1 frase direta para o gestor agir

  rawAiResponse: jsonb("raw_ai_response"),  // JSON bruto para auditoria futura

  // ── Controle de processamento ──
  status: text("status").default("pending").notNull(), // 'pending' | 'processing' | 'done' | 'error'
  errorMessage: text("error_message"),
  auditedAt: timestamp("audited_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 11. MÉTRICAS DIÁRIAS POR OPERADOR (Pré-calculadas) ──────────────────────
// Atualizada após cada auditoria concluída. Permite que o dashboard carregue
// instantaneamente sem queries pesadas de agregação em tempo real.
export const operatorDailyMetrics = pgTable("operator_daily_metrics", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  operatorId: text("operator_id").references(() => operators.id, { onDelete: "cascade" }).notNull(),
  operatorName: text("operator_name").notNull(),  // Desnormalizado para exibição rápida
  date: text("date").notNull(),                   // Formato 'YYYY-MM-DD'

  totalConversations: integer("total_conversations").default(0).notNull(),
  avgResponseTimeSeconds: integer("avg_response_time_seconds"),   // Tempo médio de resposta do dia
  maxResponseTimeSeconds: integer("max_response_time_seconds"),   // Pior caso do dia
  overdueCount: integer("overdue_count").default(0).notNull(),    // Qtd de respostas atrasadas

  avgPerformanceScore: integer("avg_performance_score"),          // Média dos scores da IA no dia
  satisfiedCount: integer("satisfied_count").default(0).notNull(),
  neutralCount: integer("neutral_count").default(0).notNull(),
  frustratedCount: integer("frustrated_count").default(0).notNull(),

  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── 12. RELATÓRIOS AUTOMÁTICOS GERADOS PELA I.A. ────────────────────────────
// Relatórios diários e semanais — v2: armazena StoredReport JSON completo + workflow de aprovação.
export const aiReports = pgTable("ai_reports", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(),           // 'daily' | 'weekly'
  period: text("period").notNull(),       // 'YYYY-MM-DD' para daily, 'YYYY-WNN' para weekly

  reportMarkdown: text("report_markdown").notNull(), // Markdown para envio WhatsApp/Email
  reportData: jsonb("report_data"),                  // StoredReport JSON completo (v2)

  // ── Campos v2 (Relatórios IA insight-navigator) ──
  stage: text("stage").default("rascunho").notNull(),        // 'rascunho' | 'revisao' | 'aprovado' | 'enviado'
  currentVersion: text("current_version").default("v1").notNull(),
  headline: text("headline"),
  summary: text("summary"),
  confidence: integer("confidence").default(90),

  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

// ─── 12b. VERSÕES DOS RELATÓRIOS DE I.A. ─────────────────────────────────────
// Cada relatório pode ter múltiplas versões (regenerações, ajustes editoriais).
export const aiReportVersions = pgTable("ai_report_versions", {
  id: text("id").primaryKey(),
  reportId: text("report_id").references(() => aiReports.id, { onDelete: "cascade" }).notNull(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  version: text("version").notNull(),           // "v1", "v2"
  createdAt: text("created_at").notNull(),       // "03/08/2026, 18:00" (display format)
  author: text("author").notNull(),             // "IA · sla_advisor" ou nome do revisor
  note: text("note").notNull(),
  stage: text("stage").default("rascunho").notNull(),
  reportData: jsonb("report_data"),              // Snapshot do StoredReport nesta versão
});

// ─── 12c. FEEDBACK POR SEÇÃO DOS RELATÓRIOS DE I.A. ──────────────────────────
// Feedback granular (thumbs up/down + comentário) por seção de cada versão.
export const aiReportFeedback = pgTable("ai_report_feedback", {
  id: text("id").primaryKey(),
  reportId: text("report_id").references(() => aiReports.id, { onDelete: "cascade" }).notNull(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  version: text("version").notNull(),           // "v1"
  sectionId: text("section_id").notNull(),       // "resumo", "volume", "destaques", etc.
  vote: text("vote"),                           // "up", "down", null
  comment: text("comment").default(""),
  operatorId: text("operator_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 13. TEMPLATES INDIVIDUAIS DOS OPERADORES ───────────────────────────────
export const operatorTemplates = pgTable("operator_templates", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  operatorId: text("operator_id").references(() => operators.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 14. TAREFAS SINCRONIZADAS DO RD STATION CRM ──────────────────────────────
export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(), // ID da tarefa vindo do RD Station CRM
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  dueDate: timestamp("due_date"),
  description: text("description"),
  dealId: text("deal_id"),
  dealName: text("deal_name"),
  clientName: text("client_name"),
  clientPhone: text("client_phone"),
  chatContactId: text("chat_contact_id").references(() => contacts.id, { onDelete: "set null" }),
  chatConversationId: text("chat_conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  operatorEmail: text("operator_email"), // E-mail do operador responsável (para filtro individual)
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════
// 💼 MÓDULO CONVERSAS + CRM (Fase 1: Fundação & Núcleo de Dados)
// Isolamento mandatório por tenantId NOT NULL em 100% das entidades.
// ═══════════════════════════════════════════════════════════════════════════

// ─── 14.1. HISTÓRICO DE CLIENTE / CONTA DO CONTATO ──────────────────────────
// Registra trocas de empresa de um contato sem reescrever dados históricos.
export const crmContactAccountHistory = pgTable("crm_contact_account_history", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }).notNull(),
  accountId: text("account_id").references(() => crmAccounts.id, { onDelete: "set null" }),
  reason: text("reason"),
  changedByOperatorId: text("changed_by_operator_id").references(() => operators.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantContactIdx: index("idx_crm_contact_acc_hist_tenant_contact").on(table.tenantId, table.contactId),
}));

// ─── 14.2. VÍNCULO HISTÓRICO CONTA ↔ CONVERSA ───────────────────────────────
// Permite contextualizar um atendimento à empresa compradora mesmo sem card criado.
export const crmAccountConversations = pgTable("crm_account_conversations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  accountId: text("account_id").references(() => crmAccounts.id, { onDelete: "cascade" }).notNull(),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  contextNote: text("context_note"),
  createdByOperatorId: text("created_by_operator_id").references(() => operators.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantAccConvIdx: uniqueIndex("idx_crm_acc_conv_tenant_acc_conv_uniq").on(table.tenantId, table.accountId, table.conversationId),
}));

// ─── 14.3. FUNIS DE VENDAS (Pipelines) ──────────────────────────────────────
export const crmPipelines = pgTable("crm_pipelines", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  orderIndex: integer("order_index").default(0).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  color: text("color").default("#0284c7").notNull(),
  coolingDays: integer("cooling_days").default(10).notNull(), // Alerta de estagnação / esfriando
  rdPipelineId: text("rd_pipeline_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  tenantOrderIdx: index("idx_crm_pipelines_tenant_order").on(table.tenantId, table.orderIndex),
}));

// ─── 14.4. ETAPAS DOS FUNIS (Stages) ────────────────────────────────────────
export const crmStages = pgTable("crm_stages", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  pipelineId: text("pipeline_id").references(() => crmPipelines.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  orderIndex: integer("order_index").default(0).notNull(),
  isWinStage: boolean("is_win_stage").default(false).notNull(),
  isLossStage: boolean("is_loss_stage").default(false).notNull(),
  requiredFields: jsonb("required_fields").$type<string[]>().default([]).notNull(),
  rdStageId: text("rd_stage_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  tenantPipelineOrderIdx: index("idx_crm_stages_tenant_pipeline_order").on(table.tenantId, table.pipelineId, table.orderIndex),
}));

// ─── 14.5. NEGOCIAÇÕES / CARDS (Deals) ───────────────────────────────────────
export const crmDeals = pgTable("crm_deals", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  accountId: text("account_id").references(() => crmAccounts.id, { onDelete: "set null" }),
  pipelineId: text("pipeline_id").references(() => crmPipelines.id, { onDelete: "cascade" }).notNull(),
  stageId: text("stage_id").references(() => crmStages.id, { onDelete: "cascade" }).notNull(),
  status: text("status").default("open").notNull(), // 'open' | 'won' | 'lost' | 'paused'
  value: numeric("value", { precision: 12, scale: 2 }).default("0.00").notNull(),
  currency: text("currency").default("BRL").notNull(),
  expectedCloseDate: timestamp("expected_close_date"),
  operatorId: text("operator_id").references(() => operators.id, { onDelete: "set null" }), // Vendedor responsável
  source: text("source"),
  campaign: text("campaign"),
  rating: integer("rating").default(0).notNull(), // 0 a 5 estrelas / qualificação
  lossReason: text("loss_reason"),
  pausedReason: text("paused_reason"),
  rdDealId: text("rd_deal_id"),
  rdDealUrl: text("rd_deal_url"),
  customFields: jsonb("custom_fields").default({}).notNull(),
  version: integer("version").default(1).notNull(), // Concorrência otimista
  lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  tenantPipelineStageIdx: index("idx_crm_deals_tenant_pipeline_stage").on(table.tenantId, table.pipelineId, table.stageId),
  tenantStatusIdx: index("idx_crm_deals_tenant_status").on(table.tenantId, table.status),
  tenantOperatorIdx: index("idx_crm_deals_tenant_operator").on(table.tenantId, table.operatorId),
  tenantAccountIdx: index("idx_crm_deals_tenant_account").on(table.tenantId, table.accountId),
  tenantRdDealIdx: index("idx_crm_deals_tenant_rd_deal").on(table.tenantId, table.rdDealId),
  tenantIdUniqIdx: uniqueIndex("idx_crm_deals_tenant_id_uniq").on(table.tenantId, table.id),
}));

// ─── 14.6. PARTICIPANTES DA NEGOCIAÇÃO (Contatos N:N) ────────────────────────
export const crmDealContacts = pgTable("crm_deal_contacts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  dealId: text("deal_id").references(() => crmDeals.id, { onDelete: "cascade" }).notNull(),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }).notNull(),
  role: text("role").default("buyer").notNull(), // 'buyer' | 'technical' | 'decision_maker' | 'user' | 'other'
  isPrimary: boolean("is_primary").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantDealContactIdx: uniqueIndex("idx_crm_deal_contacts_tenant_deal_contact_uniq").on(table.tenantId, table.dealId, table.contactId),
}));

// ─── 14.7. VÍNCULO N:N CONVERSAS ↔ NEGOCIAÇÕES ─────────────────────────────
// Uma conversa pode tratar de múltiplos negócios; um negócio pode reunir vários atendimentos.
export const crmConversationDeals = pgTable("crm_conversation_deals", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  dealId: text("deal_id").references(() => crmDeals.id, { onDelete: "cascade" }).notNull(),
  origin: text("origin").default("chat").notNull(), // 'chat' | 'crm' | 'auto_sdr'
  createdByOperatorId: text("created_by_operator_id").references(() => operators.id, { onDelete: "set null" }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  unlinkedAt: timestamp("unlinked_at"),
  unlinkedByOperatorId: text("unlinked_by_operator_id").references(() => operators.id, { onDelete: "set null" }),
}, (table) => ({
  activeUniqIdx: uniqueIndex("idx_crm_conv_deals_active_uniq").on(table.tenantId, table.conversationId, table.dealId).where(sql`is_active = true`),
  tenantConvIdx: index("idx_crm_conv_deals_tenant_conv").on(table.tenantId, table.conversationId),
  tenantDealIdx: index("idx_crm_conv_deals_tenant_deal").on(table.tenantId, table.dealId),
}));

// ─── 14.8. ATIVIDADES DA NEGOCIAÇÃO (Tarefas, Notas, Reuniões) ───────────────
export const crmDealActivities = pgTable("crm_deal_activities", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  dealId: text("deal_id").references(() => crmDeals.id, { onDelete: "cascade" }).notNull(),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  type: text("type").notNull(), // 'task' | 'note' | 'call' | 'meeting' | 'system_event'
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").default("pending").notNull(), // 'pending' | 'completed' | 'cancelled'
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  operatorId: text("operator_id").references(() => operators.id, { onDelete: "set null" }),
  assignedToOperatorId: text("assigned_to_operator_id").references(() => operators.id, { onDelete: "set null" }),
  rdTaskId: text("rd_task_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  tenantDealIdx: index("idx_crm_deal_activities_tenant_deal").on(table.tenantId, table.dealId),
  tenantStatusDueIdx: index("idx_crm_deal_activities_tenant_status_due").on(table.tenantId, table.status, table.dueDate),
}));

// ─── 14.9. EVIDÊNCIAS DE MENSAGENS EM ATIVIDADES/DEALS ──────────────────────
export const crmActivityMessages = pgTable("crm_activity_messages", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  dealId: text("deal_id").references(() => crmDeals.id, { onDelete: "cascade" }).notNull(),
  activityId: text("activity_id").references(() => crmDealActivities.id, { onDelete: "cascade" }),
  messageId: text("message_id").references(() => messages.id, { onDelete: "cascade" }).notNull(),
  markedByOperatorId: text("marked_by_operator_id").references(() => operators.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantDealIdx: index("idx_crm_activity_msgs_tenant_deal").on(table.tenantId, table.dealId),
  tenantMsgIdx: index("idx_crm_activity_msgs_tenant_msg").on(table.tenantId, table.messageId),
}));

// ─── 14.10. AUDITORIA IMUTÁVEL DE EVENTOS COMERCIAIS ────────────────────────
export const crmDealEvents = pgTable("crm_deal_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  dealId: text("deal_id").references(() => crmDeals.id, { onDelete: "cascade" }).notNull(),
  eventType: text("event_type").notNull(), // 'created' | 'stage_changed' | 'status_changed' | 'value_changed' | 'operator_changed' | 'contact_linked' | 'contact_unlinked' | 'conversation_linked' | 'conversation_unlinked'
  fromStageId: text("from_stage_id"),
  toStageId: text("to_stage_id"),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  metadata: jsonb("metadata").default({}).notNull(),
  operatorId: text("operator_id").references(() => operators.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantDealCreatedIdx: index("idx_crm_deal_events_tenant_deal_created").on(table.tenantId, table.dealId, table.createdAt),
}));

// ─── 14.11. PRODUTOS & CATÁLOGO COMERCIAL ─────────────────────────────────────
export const crmProducts = pgTable("crm_products", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  sku: text("sku"),
  description: text("description"),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).default("0.00").notNull(),
  unit: text("unit").default("UN").notNull(), // 'UN' | 'MILHEIRO' | 'CX' | 'PC' | 'KG' | 'L'
  category: text("category"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  tenantActiveIdx: index("idx_crm_products_tenant_active").on(table.tenantId, table.isActive),
  tenantSkuIdx: index("idx_crm_products_tenant_sku").on(table.tenantId, table.sku),
  tenantIdUniqIdx: uniqueIndex("idx_crm_products_tenant_id_uniq").on(table.tenantId, table.id),
}));

// ─── 14.12. ITENS / PRODUTOS DA NEGOCIAÇÃO ───────────────────────────────────
export const crmDealProducts = pgTable("crm_deal_products", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  dealId: text("deal_id").references(() => crmDeals.id, { onDelete: "cascade" }).notNull(),
  productId: text("product_id").references(() => crmProducts.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).default("1.000").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).default("0.00").notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).default("0.00").notNull(),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).default("0.00").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantDealIdx: index("idx_crm_deal_products_tenant_deal").on(table.tenantId, table.dealId),
}));

// ─── 14.13. PROPOSTAS & ORÇAMENTOS COMERCIAIS ────────────────────────────────
export const crmProposals = pgTable("crm_proposals", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  dealId: text("deal_id").references(() => crmDeals.id, { onDelete: "cascade" }).notNull(),
  proposalNumber: text("proposal_number").notNull(),
  title: text("title").notNull(),
  status: text("status").default("draft").notNull(), // 'draft' | 'copied' | 'sent' | 'accepted' | 'rejected' | 'expired'
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).default("0.00").notNull(),
  discount: numeric("discount", { precision: 12, scale: 2 }).default("0.00").notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).default("0.00").notNull(),
  paymentTerms: text("payment_terms"),
  deliveryTerms: text("delivery_terms"),
  validityDays: integer("validity_days").default(15).notNull(),
  items: jsonb("items").default([]).notNull(),
  notes: text("notes"),
  createdOperatorId: text("created_operator_id").references(() => operators.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at"),
  acceptedAt: timestamp("accepted_at"),
  rejectedAt: timestamp("rejected_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  tenantDealIdx: index("idx_crm_proposals_tenant_deal").on(table.tenantId, table.dealId),
  tenantNumberIdx: uniqueIndex("idx_crm_proposals_tenant_number_uniq").on(table.tenantId, table.proposalNumber),
}));

// ── Valentina Agent Tables ─────────────────────────────────────────────

// ─── 15. CONFIGURAÇÕES DOS AGENTES VALENTINA ─────────────────────────────────
// Cada linha configura um dos 3 agentes (SDR, Supervisor, Vendedor) por tenant.
// O campo `config` guarda prompts, regras de roteamento e comportamento em JSONB.
export const agentConfigs = pgTable("agent_configs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  agentType: text("agent_type").notNull(), // 'sdr' | 'supervisor' | 'vendedor'
  enabled: integer("enabled").default(0).notNull(), // 0=off, 1=on
  config: jsonb("config").default({}).notNull(), // prompts, rules, routing
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── 16. ESTADO DO FLUXO DO AGENTE POR CONVERSA ─────────────────────────────
// Rastreia em qual passo da conversa o agente está para cada atendimento ativo.
// Permite retomar o fluxo exatamente de onde parou após reconexão.
export const agentFlowStates = pgTable("agent_flow_states", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  conversationId: text("conversation_id").references(() => conversations.id).notNull(),
  agentType: text("agent_type").notNull(), // 'sdr' | 'supervisor' | 'vendedor'
  currentStep: text("current_step").notNull(), // 'greeting' | 'collecting_name' | etc.
  collectedData: jsonb("collected_data").default({}).notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  lastInteractionAt: timestamp("last_interaction_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  outcome: text("outcome"), // 'transferred' | 'abandoned' | 'completed' | 'escalated'
});

// ─── 17. ESTADO DO ROUND ROBIN (Distribuição de Leads) ───────────────────────
// Controla a distribuição circular de leads entre operadores de cada setor.
export const roundRobinState = pgTable("round_robin_state", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  sectorId: text("sector_id").references(() => sectors.id).notNull(),
  lastAssignedOperatorId: text("last_assigned_operator_id"),
  assignmentCount: jsonb("assignment_count").default({}).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── 18. MENSAGENS INTERNAS (Chat Operador ↔ Valentina) ──────────────────────
// Histórico do chat interno entre operadores e o agente Supervisor.
export const internalMessages = pgTable("internal_messages", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  operatorId: text("operator_id").references(() => operators.id, { onDelete: "cascade" }).notNull(),
  direction: text("direction").notNull(), // 'to_agent' | 'from_agent'
  agentType: text("agent_type").notNull(), // 'supervisor'
  content: text("content").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  read: integer("read").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // ── Deduplicação de alertas repetidos (Supervisor) ──────────────────────────
  // repeatCount: quantas vezes este mesmo alerta disparou dentro da janela de 4h
  // lastFiredAt: timestamp do último disparo real (para exibir "última ocorrência")
  repeatCount: integer("repeat_count").default(1).notNull(),
  lastFiredAt: timestamp("last_fired_at").defaultNow().notNull(),
});

// ─── 19. BASE DE CONHECIMENTO VALENTINA ────────────────────────────────────
export const knowledgeFolders = pgTable("knowledge_folders", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  parentId: text("parent_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const knowledgeFiles = pgTable("knowledge_files", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  folderId: text("folder_id").references(() => knowledgeFolders.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  size: text("size").notNull(),
  type: text("type").notNull(), // 'pdf' | 'word' | 'image' | 'txt' | 'md'
  format: text("format").notNull(), // 'embeddings' | 'real'
  content: text("content"), // Conteúdo textual extraído para aprendizado da IA
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

// ─── 20. TELEMETRIA E CUSTOS DE I.A. (Vertex AI / Gemini) ─────────────────────
// Guarda o consumo real de tokens, latência e custo calculado em USD/BRL por requisição.
export const aiUsageLogs = pgTable("ai_usage_logs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  feature: text("feature").notNull(), // 'sdr_agent' | 'conversation_audit' | 'sla_advisor' | 'supervisor_chat' | 'call_transcription' | 'knowledge_rag'
  model: text("model").notNull(),     // 'gemini-2.5-pro' | 'gemini-1.5-flash' | etc.
  
  promptTokens: integer("prompt_tokens").default(0).notNull(),
  completionTokens: integer("completion_tokens").default(0).notNull(),
  totalTokens: integer("total_tokens").default(0).notNull(),
  
  costUsd: text("cost_usd").notNull(), // Decimal em USD string (ex: "0.002345")
  costBrl: text("cost_brl").notNull(), // Decimal em BRL string (ex: "0.013132")
  latencyMs: integer("latency_ms").default(0).notNull(),
  
  status: text("status").default("success").notNull(), // 'success' | 'error'
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").default({}).notNull(),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 24. PUSH SUBSCRIPTIONS (Dispositivos Móveis para Notificações Web Push) ──
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  operatorId: text("operator_id").references(() => operators.id, { onDelete: "cascade" }).notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 25. VOICE CALLS (Módulo de Voz & Ligações Twilio/Valentina) ──────────────
export const voiceCalls = pgTable("voice_calls", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  callSid: text("call_sid").notNull().unique(),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  direction: text("direction").default("inbound").notNull(), // 'inbound' | 'outbound'
  status: text("status").default("active").notNull(), // 'active' | 'completed' | 'failed' | 'no-answer'
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  durationSeconds: integer("duration_seconds").default(0).notNull(),
  sentiment: text("sentiment").default("neutral"), // 'positive' | 'neutral' | 'negative'
  summary: text("summary"),
  extractedInfo: jsonb("extracted_info").default({}).notNull(), // { nome, empresa, interesse, objecoes, proximo_passo }
  campaignId: text("campaign_id"), // Referência opcional para voiceCampaigns
  transcriptDone: boolean("transcript_done").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const voiceCallMessages = pgTable("voice_call_messages", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  callId: text("call_id").references(() => voiceCalls.id, { onDelete: "cascade" }).notNull(),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const voiceCampaigns = pgTable("voice_campaigns", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  status: text("status").default("draft").notNull(), // 'draft' | 'running' | 'paused' | 'completed' | 'cancelled'
  totalLeads: integer("total_leads").default(0).notNull(),
  calledLeads: integer("called_leads").default(0).notNull(),
  qualifiedLeads: integer("qualified_leads").default(0).notNull(),
  intervalSeconds: integer("interval_seconds").default(30).notNull(),
  maxAttempts: integer("max_attempts").default(2).notNull(),
  objectiveId: text("objective_id"), // FK lógica para voice_objectives (sem constraint para evitar ordem circular)
  startedAt: timestamp("started_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 26. VOICE OBJECTIVES (Objetivos configuráveis da Valentina) ───────────────
export const voiceObjectives = pgTable("voice_objectives", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),                    // Ex: "Valentina NPS"
  description: text("description"),               // Descrição interna para o operador
  emoji: text("emoji").default("🎯"),             // Ícone visual do objetivo
  prompt: text("prompt").notNull(),               // System prompt completo que substitui o padrão
  collectFields: jsonb("collect_fields").default([]).notNull(),
  // [{ key: "rating", label: "Nota 1-10", type: "number"|"text"|"boolean", required: boolean }]
  actions: jsonb("actions").default([]).notNull(),
  // ["collect_nps", "create_rd_deal", "send_whatsapp_catalog", "schedule_callback", "enrich_cnpj"]
  isActive: boolean("is_active").default(true).notNull(),
  isTemplate: boolean("is_template").default(false).notNull(), // templates pré-definidos do sistema
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const voiceCampaignLeads = pgTable("voice_campaign_leads", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  campaignId: text("campaign_id").references(() => voiceCampaigns.id, { onDelete: "cascade" }).notNull(),
  name: text("name"),
  phone: text("phone").notNull(),
  company: text("company"),
  productInterest: text("product_interest"),
  notes: text("notes"),
  status: text("status").default("pending").notNull(), // 'pending' | 'calling' | 'done' | 'no-answer' | 'failed'
  attempts: integer("attempts").default(0).notNull(),
  callId: text("call_id").references(() => voiceCalls.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const voiceAgenda = pgTable("voice_agenda", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone").notNull(),
  company: text("company"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  type: text("type").default("follow_up").notNull(), // 'follow_up' | 'customer_request' | 'excel_list' | 'sdr_outreach'
  status: text("status").default("pending").notNull(), // 'pending' | 'completed' | 'rescheduled' | 'cancelled' | 'no_answer'
  priority: text("priority").default("normal").notNull(), // 'low' | 'normal' | 'high' | 'urgent'
  notes: text("notes"),
  campaignName: text("campaign_name"),
  assignedAgent: text("assigned_agent").default("Valentina").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Tipos Derivados (Inferidos) ──────────────────────────────────────────────
export type Tenant = typeof tenants.$inferSelect;
export type ChannelConfig = typeof channelConfigs.$inferSelect;
export type Operator = typeof operators.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type QuickResponse = typeof quickResponses.$inferSelect;
export type MediaFile = typeof mediaFiles.$inferSelect;
export type OperatorTemplate = typeof operatorTemplates.$inferSelect;

// ── Novos tipos do Gestor de I.A. ──
export type ResponseTimeLog = typeof responseTimeLogs.$inferSelect;
export type AiConversationAudit = typeof aiConversationAudits.$inferSelect;
export type OperatorDailyMetrics = typeof operatorDailyMetrics.$inferSelect;
export type AiReport = typeof aiReports.$inferSelect;
export type AiReportVersion = typeof aiReportVersions.$inferSelect;
export type AiReportFeedback = typeof aiReportFeedback.$inferSelect;
export type CallSession = typeof callSessions.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type AiUsageLog = typeof aiUsageLogs.$inferSelect;

// ── Tipos da Valentina (Agentes I.A. & Base de Conhecimento) ──
export type AgentConfig = typeof agentConfigs.$inferSelect;
export type AgentFlowState = typeof agentFlowStates.$inferSelect;
export type RoundRobinState = typeof roundRobinState.$inferSelect;
export type InternalMessage = typeof internalMessages.$inferSelect;
export type KnowledgeFolder = typeof knowledgeFolders.$inferSelect;
export type KnowledgeFileRecord = typeof knowledgeFiles.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

// ── Tipos de Voz (Ligações & Campanhas & Agenda) ──
export type VoiceCall = typeof voiceCalls.$inferSelect;
export type VoiceCallMessage = typeof voiceCallMessages.$inferSelect;
export type VoiceCampaign = typeof voiceCampaigns.$inferSelect;
export type VoiceCampaignLead = typeof voiceCampaignLeads.$inferSelect;
export type VoiceAgenda = typeof voiceAgenda.$inferSelect;
export type VoiceObjective = typeof voiceObjectives.$inferSelect;


// ═══════════════════════════════════════════════════════════════════════════
// 🌐 LIVE CHAT DO SITE (valem-widget) — Módulo Web Chat
// Todas as tabelas têm tenantId NOT NULL — isolamento multi-tenant obrigatório.
// ═══════════════════════════════════════════════════════════════════════════

// ─── LC-1. VISITANTES ───────────────────────────────────────────────────────
// Um visitante é criado por cookie (cookieId) ao abrir o widget no site.
export const lcVisitors = pgTable("lc_visitors", {
  id:           text("id").primaryKey(),
  tenantId:     text("tenant_id").notNull(),              // sempre "valem" por enquanto
  cookieId:     text("cookie_id").notNull(),              // fingerprint do browser (localStorage)
  sessionStart: timestamp("session_start").defaultNow().notNull(),
  lastSeenAt:   timestamp("last_seen_at").defaultNow().notNull(),

  // Dados coletados pela Valentina durante o atendimento
  name:         text("name"),
  company:      text("company"),
  cnpj:         text("cnpj"),
  phone:        text("phone"),
  email:        text("email"),
  productInterest: text("product_interest"),
  quantityInterest: text("quantity_interest"),

  // Classificação
  intentScore:    integer("intent_score").default(0).notNull(),       // 0–100
  pipelineStage:  text("pipeline_stage").default("novo").notNull(),   // novo | qualificando | atacado_qualificado | varejo_checkout | bridge_enviado | finalizado
  temperature:    text("temperature").default("frio").notNull(),      // frio | morno | quente

  // URL atual no site
  currentUrl:   text("current_url"),
  currentTitle: text("current_title"),

  // Metadados de origem
  referrer:     text("referrer"),
  userAgent:    text("user_agent"),
  ipAddress:    text("ip_address"),
});

// ─── LC-2. CHATS (sessões de atendimento) ───────────────────────────────────
// Um visitante pode ter vários chats (um por visita ao site).
export const lcChats = pgTable("lc_chats", {
  id:          text("id").primaryKey(),
  tenantId:    text("tenant_id").notNull(),
  visitorId:   text("visitor_id").notNull(),              // FK → lcVisitors.id
  channel:     text("channel").default("livechat").notNull(), // sempre 'livechat'
  status:      text("status").default("active").notNull(), // active | operator_took_over | bridge_sent | closed
  operatorId:  text("operator_id"),                        // null = Valentina atendendo; preenchido = operador assumiu
  startedAt:   timestamp("started_at").defaultNow().notNull(),
  closedAt:    timestamp("closed_at"),
  outcome:     text("outcome"),                            // null | bridge_whatsapp | checkout | abandoned | resolved
  // Bridge WhatsApp: quando a Valentina inicia conversa no WhatsApp
  waConversationId: text("wa_conversation_id"),            // ID da conversa no sistema WhatsApp (se bridge feito)
});

// ─── LC-3. MENSAGENS ────────────────────────────────────────────────────────
export const lcMessages = pgTable("lc_messages", {
  id:          text("id").primaryKey(),
  tenantId:    text("tenant_id").notNull(),
  chatId:      text("chat_id").notNull(),                  // FK → lcChats.id
  sender:      text("sender").notNull(),                   // 'visitor' | 'ai' | 'operator' | 'system'
  content:     text("content").notNull(),
  contentType: text("content_type").default("text").notNull(), // text | audio | image | document | tray_product | bridge_card | system
  // Para mídias
  mediaUrl:    text("media_url"),
  mediaType:   text("media_type"),
  fileName:    text("file_name"),
  // Para card de produto Tray (embed na mensagem)
  trayProductData: jsonb("tray_product_data"),             // { id, name, price, imageUrl, productUrl }
  sentAt:      timestamp("sent_at").defaultNow().notNull(),
});

// ─── LC-4. PAGEVIEWS (trilha de navegação do visitante) ─────────────────────
export const lcPageviews = pgTable("lc_pageviews", {
  id:          text("id").primaryKey(),
  tenantId:    text("tenant_id").notNull(),
  visitorId:   text("visitor_id").notNull(),
  url:         text("url").notNull(),
  title:       text("title"),
  timeOnPage:  integer("time_on_page_sec").default(0),     // segundos na página
  scrollDepth: integer("scroll_depth_pct").default(0),     // 0–100%
  visitedAt:   timestamp("visited_at").defaultNow().notNull(),
});

// ─── LC-5. CLICK EVENTS ─────────────────────────────────────────────────────
export const lcClickEvents = pgTable("lc_click_events", {
  id:          text("id").primaryKey(),
  tenantId:    text("tenant_id").notNull(),
  visitorId:   text("visitor_id").notNull(),
  eventType:   text("event_type").notNull(),               // widget_open | whatsapp_click | add_to_cart | product_view | chat_sent
  eventData:   jsonb("event_data"),                        // dados extras do evento
  occurredAt:  timestamp("occurred_at").defaultNow().notNull(),
});

// ─── LC-6. TRAY CONFIG (tokens OAuth por tenant) ────────────────────────────
// Guarda as credenciais de autenticação Tray Commerce por tenant.
// Nunca expor consumer_secret no frontend — somente via API com autenticação.
export const lcTrayConfig = pgTable("lc_tray_config", {
  id:               text("id").primaryKey(),
  tenantId:         text("tenant_id").notNull().unique(),  // 1 config por tenant
  apiAddress:       text("api_address").notNull(),         // ex: https://valemvalvulas.corpsuite.com.br/web_api
  consumerKey:      text("consumer_key"),
  consumerSecret:   text("consumer_secret"),
  accessToken:      text("access_token"),
  refreshToken:     text("refresh_token"),
  accessTokenExpiresAt:  timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  // Configurações de comportamento do widget
  proactiveMessage: text("proactive_message").default("Olá! Posso te ajudar com informações sobre nossos produtos?"),
  proactiveDelaySec: integer("proactive_delay_sec").default(60),
  sessionTtlHours:  integer("session_ttl_hours").default(4),
  attackQualifyScore: integer("attack_qualify_score").default(70), // score mínimo p/ oferecer bridge WhatsApp
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});

// ── Tipos LC ──
export type LcVisitor      = typeof lcVisitors.$inferSelect;
export type LcChat         = typeof lcChats.$inferSelect;
export type LcMessage      = typeof lcMessages.$inferSelect;
export type LcPageview     = typeof lcPageviews.$inferSelect;
export type LcClickEvent   = typeof lcClickEvents.$inferSelect;
export type LcTrayConfig   = typeof lcTrayConfig.$inferSelect;

// ── Tipos do Módulo Conversas + CRM ──
export type CrmAccount               = typeof crmAccounts.$inferSelect;
export type CrmContactAccountHistory = typeof crmContactAccountHistory.$inferSelect;
export type CrmAccountConversation   = typeof crmAccountConversations.$inferSelect;
export type CrmPipeline              = typeof crmPipelines.$inferSelect;
export type CrmStage                 = typeof crmStages.$inferSelect;
export type CrmDeal                  = typeof crmDeals.$inferSelect;
export type CrmDealContact           = typeof crmDealContacts.$inferSelect;
export type CrmConversationDeal      = typeof crmConversationDeals.$inferSelect;
export type CrmDealActivity          = typeof crmDealActivities.$inferSelect;
export type CrmActivityMessage       = typeof crmActivityMessages.$inferSelect;
export type CrmDealEvent             = typeof crmDealEvents.$inferSelect;
export type CrmProduct               = typeof crmProducts.$inferSelect;
export type CrmDealProduct           = typeof crmDealProducts.$inferSelect;
export type CrmProposal              = typeof crmProposals.$inferSelect;
