import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";

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
  
  // Configurações exclusivas da API Meta (Tec Chat)
  metaBusinessAccountId: text("meta_business_account_id"),
  metaPhoneNumberId: text("meta_phone_number_id"),
  metaAccessToken: text("meta_access_token"),
  metaVerifyToken: text("meta_verify_token"),

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

// ─── 4. CONTATOS (Base de Clientes) ─────────────────────────────────────────
export const contacts = pgTable("contacts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
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
  
  lastMessageText: text("last_message_text"),
  lastMessageTime: timestamp("last_message_time").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 6. MENSAGENS (Histórico de Chat & Notas Internas) ───────────────────────
export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
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
  // Salva o que foi "visto/ouvido" em turnos anteriores para que a Valentina
  // mantenha memória visual sem precisar reenviar o binário da mídia.
  mediaInterpretation: text("media_interpretation"),

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
  fileName: text("file_name"),
  mimeType: text("mime_type").notNull(),
  base64Data: text("base64_data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  startedAt: timestamp("started_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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

// ── Tipos de Voz (Ligações & Campanhas) ──
export type VoiceCall = typeof voiceCalls.$inferSelect;
export type VoiceCallMessage = typeof voiceCallMessages.$inferSelect;
export type VoiceCampaign = typeof voiceCampaigns.$inferSelect;
export type VoiceCampaignLead = typeof voiceCampaignLeads.$inferSelect;



