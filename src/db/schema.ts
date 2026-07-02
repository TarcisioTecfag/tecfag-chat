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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── 5. CONVERSAS (Atendimentos / Filas) ─────────────────────────────────────
export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }).notNull(),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }).notNull(),
  operatorId: text("operator_id").references(() => operators.id), // Null indica que está na fila ou bot
  
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

// ─── Tipos Derivados (Inferidos) ──────────────────────────────────────────────
export type Tenant = typeof tenants.$inferSelect;
export type ChannelConfig = typeof channelConfigs.$inferSelect;
export type Operator = typeof operators.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type QuickResponse = typeof quickResponses.$inferSelect;
export type MediaFile = typeof mediaFiles.$inferSelect;
