import { WhatsAppAdapter, UniversalOutboundMessage, DeliveryStatus, ChannelSettings } from "../types";
import { db } from "../../../db";
import { channelConfigs, mediaFiles } from "../../../db/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";

const META_GRAPH_VERSION = "v21.0";
const META_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export class MetaAdapter implements WhatsAppAdapter {
  readonly provider = "meta" as const;

  private async getCredentials(tenantId: string): Promise<{ phoneNumberId: string; accessToken: string }> {
    const [config] = await db
      .select()
      .from(channelConfigs)
      .where(eq(channelConfigs.tenantId, tenantId));

    if (!config || !config.metaPhoneNumberId || !config.metaAccessToken) {
      throw new Error(`Credenciais da Meta Cloud API não configuradas para o tenant '${tenantId}'`);
    }

    return {
      phoneNumberId: config.metaPhoneNumberId,
      accessToken: config.metaAccessToken,
    };
  }

  private async uploadMediaToMeta(
    phoneNumberId: string,
    accessToken: string,
    buffer: Buffer,
    fileName: string,
    mimeType: string
  ): Promise<string> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
    formData.append("file", blob, fileName);
    formData.append("type", mimeType);
    formData.append("messaging_product", "whatsapp");

    const uploadRes = await fetch(`${META_BASE_URL}/${phoneNumberId}/media`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
      body: formData,
    });

    if (!uploadRes.ok) {
      const errJson = await uploadRes.json().catch(() => ({}));
      throw new Error(`Falha no upload de mídia para Meta API: ${errJson?.error?.message || uploadRes.statusText}`);
    }

    const uploadData = await uploadRes.json();
    if (!uploadData?.id) {
      throw new Error("Meta API não retornou ID de mídia válido no upload");
    }

    return uploadData.id;
  }

  async send(tenantId: string, message: UniversalOutboundMessage): Promise<{
    externalId: string;
    status: DeliveryStatus;
    error?: string;
  }> {
    try {
      const { phoneNumberId, accessToken } = await this.getCredentials(tenantId);

      // Limpa caracteres especiais do telefone de destino (apenas dígitos)
      const cleanTo = message.recipientPhone.replace(/\D/g, "");
      if (!cleanTo) {
        return { externalId: "", status: "failed", error: "Telefone de destino inválido ou vazio" };
      }

      let bodyPayload: Record<string, any> = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanTo,
      };

      // 1. Mensagem de Template Oficial (necessária para iniciar conversa ou fora da janela de 24h)
      if (message.templateName) {
        bodyPayload = {
          ...bodyPayload,
          type: "template",
          template: {
            name: message.templateName,
            language: { code: message.templateLanguage || "pt_BR" },
            components: message.templateComponents || [],
          },
        };
      }
      // 2. Mídia (Imagem, Áudio, Vídeo, Documento)
      else if (message.mediaUrl && message.mediaType) {
        let mediaPayload: Record<string, any>;

        // Verifica se a mediaUrl é pública (https://) e não é localhost
        const isPublicUrl = message.mediaUrl.startsWith("https://") && !message.mediaUrl.includes("localhost") && !message.mediaUrl.includes("127.0.0.1");

        if (isPublicUrl) {
          mediaPayload = { link: message.mediaUrl };
        } else {
          // Mídia local ou relativa: obter buffer e subir para a Meta Media API
          let mediaBuffer: Buffer | null = null;
          let mimeType = "application/octet-stream";
          const fileName = message.fileName || `arquivo-${Date.now()}`;

          try {
            const urlMatch = message.mediaUrl.match(/messageId=([^&]+)/);
            const messageId = urlMatch ? urlMatch[1] : (message.mediaUrl.startsWith("media-") ? message.mediaUrl : null);
            if (messageId) {
              const localPath = path.join(process.cwd(), "media", messageId);
              const mimePath = path.join(process.cwd(), "media", `${messageId}.mime`);
              if (fs.existsSync(localPath)) {
                mediaBuffer = fs.readFileSync(localPath);
                if (fs.existsSync(mimePath)) mimeType = fs.readFileSync(mimePath, "utf-8").trim();
              } else {
                const [record] = await db.select().from(mediaFiles).where(eq(mediaFiles.id, messageId));
                if (record?.base64Data) {
                  mediaBuffer = Buffer.from(record.base64Data, "base64");
                  mimeType = record.mimeType;
                }
              }
            }
          } catch (readErr) {
            console.warn("[MetaAdapter] Erro ao ler mídia local:", readErr);
          }

          if (mediaBuffer) {
            const metaMediaId = await this.uploadMediaToMeta(phoneNumberId, accessToken, mediaBuffer, fileName, mimeType);
            mediaPayload = { id: metaMediaId };
          } else {
            mediaPayload = { link: message.mediaUrl };
          }
        }

        if (message.text) mediaPayload.caption = message.text;
        if (message.fileName) mediaPayload.filename = message.fileName;

        bodyPayload = {
          ...bodyPayload,
          type: message.mediaType,
          [message.mediaType]: mediaPayload,
        };
      }
      // 3. Texto Puro
      else if (message.text) {
        bodyPayload = {
          ...bodyPayload,
          type: "text",
          text: {
            preview_url: true,
            body: message.text,
          },
        };

        // Contexto de resposta a mensagem anterior (quoted) se fornecido
        if (message.quotedMessageId) {
          bodyPayload.context = {
            message_id: message.quotedMessageId,
          };
        }
      } else {
        return { externalId: "", status: "failed", error: "Mensagem sem texto, mídia ou template" };
      }

      const response = await fetch(`${META_BASE_URL}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bodyPayload),
      });

      const data = await response.json();

      if (!response.ok) {
        const metaError = data?.error;
        let errorMessage = metaError?.message || `Erro HTTP ${response.status} na Meta API`;
        
        // Tratar erro clássico de janela de 24 horas da Meta
        if (metaError?.code === 131047) {
          errorMessage = "Conversa fora da janela de 24h da Meta. É necessário utilizar um Template aprovado para reabrir o diálogo.";
        }

        console.error(`[MetaAdapter] Falha no envio para ${cleanTo} (tenant: ${tenantId}):`, metaError);
        return {
          externalId: "",
          status: "failed",
          error: errorMessage,
        };
      }

      const externalId = data.messages?.[0]?.id || "";
      return {
        externalId,
        status: "accepted",
      };

    } catch (err: any) {
      console.error(`[MetaAdapter] Exceção durante envio (tenant: ${tenantId}):`, err);
      return {
        externalId: "",
        status: "failed",
        error: err.message || "Erro inesperado ao despachar para a Meta API",
      };
    }
  }

  async getStatus(tenantId: string): Promise<{
    status: "disconnected" | "connecting" | "connected" | "qr_ready" | "error";
    phone?: string;
    details?: any;
  }> {
    try {
      const [config] = await db
        .select()
        .from(channelConfigs)
        .where(eq(channelConfigs.tenantId, tenantId));

      if (!config || !config.metaPhoneNumberId || !config.metaAccessToken) {
        return {
          status: "disconnected",
          details: { message: "Credenciais da Meta API não configuradas" },
        };
      }

      // Testa status do número na Meta
      const res = await fetch(`${META_BASE_URL}/${config.metaPhoneNumberId}?fields=verified_name,display_phone_number,quality_rating`, {
        headers: { "Authorization": `Bearer ${config.metaAccessToken}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return {
          status: "error",
          details: err.error || { message: "Token inválido ou sem permissão" },
        };
      }

      const data = await res.json();
      return {
        status: "connected",
        phone: data.display_phone_number || "",
        details: {
          verifiedName: data.verified_name,
          qualityRating: data.quality_rating,
        },
      };
    } catch (err: any) {
      return {
        status: "error",
        details: { message: err.message },
      };
    }
  }

  async testCredentials(tenantId: string, customConfig?: Partial<ChannelSettings>): Promise<{
    valid: boolean;
    error?: string;
    details?: any;
  }> {
    try {
      let phoneNumberId = customConfig?.metaPhoneNumberId;
      let accessToken = customConfig?.metaAccessToken;

      if (!phoneNumberId || !accessToken) {
        const creds = await this.getCredentials(tenantId);
        phoneNumberId = creds.phoneNumberId;
        accessToken = creds.accessToken;
      }

      const res = await fetch(`${META_BASE_URL}/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,code_verification_status`, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          valid: false,
          error: data?.error?.message || `Código de erro HTTP ${res.status}`,
        };
      }

      return {
        valid: true,
        details: {
          verifiedName: data.verified_name,
          phoneNumber: data.display_phone_number,
          qualityRating: data.quality_rating,
          verificationStatus: data.code_verification_status,
        },
      };
    } catch (err: any) {
      return {
        valid: false,
        error: err.message || "Erro de conexão com a Graph API da Meta",
      };
    }
  }
}

export const metaAdapter = new MetaAdapter();
