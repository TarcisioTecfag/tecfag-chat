export type WhatsAppProviderType = "baileys" | "meta";

export type DeliveryStatus = "pending" | "sending" | "accepted" | "failed" | "unknown";

export type MessageDirection = "in" | "out";

export interface UniversalOutboundMessage {
  idempotencyKey?: string; // clientMessageId para evitar duplicidade de envio
  tenantId: string;
  conversationId: string;
  recipientPhone: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: "image" | "audio" | "video" | "document";
  fileName?: string;
  quotedMessageId?: string;
  templateName?: string;
  templateLanguage?: string;
  templateComponents?: any[];
  operatorId?: string | null;
  senderName?: string;
  senderId?: string;
  isInternalNote?: boolean;
}

export interface UniversalOutboundResult {
  success: boolean;
  messageId: string;
  externalId?: string;
  status: DeliveryStatus;
  error?: string;
}

export interface UniversalInboundMedia {
  url?: string;
  mimeType: string;
  fileName?: string;
  fileSize?: number;
  localPath?: string;
  dataBuffer?: Buffer;
}

export interface UniversalInboundMessage {
  externalEventId: string; // provider:tenantId:externalId para deduplicação em pending_inbounds
  tenantId: string;
  provider: WhatsAppProviderType;
  fromPhone: string;
  senderName?: string;
  text?: string;
  media?: UniversalInboundMedia;
  quotedExternalId?: string;
  timestamp: Date;
  rawPayload?: any;
}

export interface ChannelSettings {
  tenantId: string;
  activeProvider: WhatsAppProviderType;
  connectionStatus: "disconnected" | "connecting" | "connected" | "qr_ready" | "error";
  connectionVersion: number;
  baileysPhoneNumber?: string | null;
  metaPhoneNumberId?: string | null;
  metaBusinessAccountId?: string | null;
  metaAccessToken?: string | null;
  metaVerifyToken?: string | null;
  metaAppSecret?: string | null;
  lastError?: string | null;
}

export interface WhatsAppAdapter {
  readonly provider: WhatsAppProviderType;
  send(tenantId: string, message: UniversalOutboundMessage): Promise<{
    externalId: string;
    status: DeliveryStatus;
    error?: string;
  }>;
  getStatus(tenantId: string): Promise<{
    status: "disconnected" | "connecting" | "connected" | "qr_ready" | "error";
    phone?: string;
    details?: any;
  }>;
  connect?(tenantId: string, options?: any): Promise<void>;
  disconnect?(tenantId: string): Promise<void>;
  testCredentials?(tenantId: string, config?: Partial<ChannelSettings>): Promise<{
    valid: boolean;
    error?: string;
    details?: any;
  }>;
}
