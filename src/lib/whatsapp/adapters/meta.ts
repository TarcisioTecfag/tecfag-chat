import { WhatsAppAdapter, UniversalOutboundMessage, DeliveryStatus, ChannelSettings } from "../types";
import { db } from "../../../db";
import { channelConfigs, mediaFiles, messages } from "../../../db/schema";
import { and, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { getMetaServiceWindow } from "../meta-policy";

const META_GRAPH_VERSION = "v21.0";
const META_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export class MetaAdapter implements WhatsAppAdapter {
  readonly provider = "meta" as const;

  async downloadInboundMedia(tenantId: string, phoneNumberId: string, mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const credentials = await this.getCredentials(tenantId);
    if (credentials.phoneNumberId !== phoneNumberId) throw new Error("Mídia não pertence ao número configurado para o tenant");

    const metadataResponse = await fetch(`${META_BASE_URL}/${encodeURIComponent(mediaId)}?phone_number_id=${encodeURIComponent(phoneNumberId)}`, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    const metadata = await metadataResponse.json().catch(() => ({}));
    if (!metadataResponse.ok || typeof metadata.url !== "string" || !metadata.url.startsWith("https://")) {
      throw new Error(metadata?.error?.message || "Meta não retornou URL segura para mídia recebida");
    }

    const mediaResponse = await fetch(metadata.url, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!mediaResponse.ok) throw new Error(`Download de mídia Meta falhou: HTTP ${mediaResponse.status}`);
    const maxBytes = 20 * 1024 * 1024;
    const declaredSize = Number(mediaResponse.headers.get("content-length") || 0);
    if (declaredSize > maxBytes) throw new Error("Mídia Meta excede o limite operacional de 20 MB");
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!mediaResponse.body) throw new Error("Mídia Meta retornou corpo vazio");
    const reader = mediaResponse.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error("Mídia Meta excede o limite operacional de 20 MB");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const buffer = Buffer.concat(chunks, size);
    return { buffer, mimeType: metadata.mime_type || mediaResponse.headers.get("content-type") || "application/octet-stream" };
  }

  private async getCredentials(tenantId: string): Promise<{ phoneNumberId: string; accessToken: string; businessAccountId: string | null }> {
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
      businessAccountId: config.metaBusinessAccountId,
    };
  }

  async listApprovedTemplates(tenantId: string): Promise<Array<{ name: string; language: string; category: string; bodyText: string; variableCount: number; supported: boolean }>> {
    const { accessToken, businessAccountId } = await this.getCredentials(tenantId);
    if (!businessAccountId) throw new Error("Meta Business Account ID não configurado para este tenant");

    const templates: Array<{ name: string; language: string; category: string; bodyText: string; variableCount: number; supported: boolean }> = [];
    let url: string | null = `${META_BASE_URL}/${encodeURIComponent(businessAccountId)}/message_templates?fields=name,language,status,category,components&limit=100`;
    for (let page = 0; url && page < 10; page++) {
      const response: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || "Falha ao consultar templates aprovados na Meta");
      for (const item of data.data || []) {
        if (item.status === "APPROVED" && item.name && item.language) {
          const components = Array.isArray(item.components) ? item.components : [];
          const bodyText = String(components.find((c: any) => c.type === "BODY")?.text || "");
          const variableCount = Math.max(0, ...Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1])));
          const supported = components.every((c: any) =>
            c.type === "BODY" || c.type === "FOOTER" || (c.type === "HEADER" && c.format === "TEXT" && !/\{\{\d+\}\}/.test(c.text || ""))
          );
          templates.push({ name: item.name, language: item.language, category: item.category || "", bodyText, variableCount, supported });
        }
      }
      const next: unknown = data.paging?.next;
      url = typeof next === "string" && next.startsWith("https://graph.facebook.com/") ? next : null;
    }
    return templates;
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

      if (message.templateName) {
        const approved = await this.listApprovedTemplates(tenantId);
        const language = message.templateLanguage || "pt_BR";
        const selected = approved.find((t) => t.name === message.templateName && t.language === language);
        if (!selected?.supported) {
          return { externalId: "", status: "failed", error: "Template não aprovado ou formato ainda não suportado neste painel." };
        }
        const bodyParameters = message.templateComponents?.find((c: any) => c.type === "body")?.parameters;
        if (selected.variableCount !== (Array.isArray(bodyParameters) ? bodyParameters.length : 0)) {
          return { externalId: "", status: "failed", error: "Preencha todas as variáveis do template aprovado." };
        }
      } else {
        const window = await getMetaServiceWindow(tenantId, message.conversationId);
        if (!window.open) {
          return { externalId: "", status: "failed", error: "Janela de 24 horas encerrada. Selecione um template aprovado pela Meta." };
        }
      }

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
              const [record] = await db.select().from(mediaFiles).where(and(eq(mediaFiles.id, messageId), eq(mediaFiles.tenantId, tenantId)));
              if (!record) throw new Error("Mídia não pertence ao tenant da mensagem");
              const localPath = path.join(process.cwd(), "media", messageId);
              const mimePath = path.join(process.cwd(), "media", `${messageId}.mime`);
              if (fs.existsSync(localPath)) {
                mediaBuffer = fs.readFileSync(localPath);
                if (fs.existsSync(mimePath)) mimeType = fs.readFileSync(mimePath, "utf-8").trim();
              } else {
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
          const [quoted] = await db.select({ externalId: messages.externalId }).from(messages).where(and(
            eq(messages.id, message.quotedMessageId),
            eq(messages.tenantId, tenantId),
            eq(messages.conversationId, message.conversationId)
          ));
          if (quoted?.externalId) {
            const inboundPrefix = `meta:${tenantId}:`;
            bodyPayload.context = { message_id: quoted.externalId.startsWith(inboundPrefix)
              ? quoted.externalId.slice(inboundPrefix.length) : quoted.externalId };
          }
        }
      } else {
        return { externalId: "", status: "failed", error: "Mensagem sem texto, mídia ou template" };
      }

      const response = await fetch(`${META_BASE_URL}/${phoneNumberId}/messages`, {
        method: "POST",
        signal: AbortSignal.timeout(30000),
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
      if (!externalId) {
        return { externalId: "", status: "unknown", error: "Meta respondeu sem ID da mensagem. Confira os webhooks antes de tentar novamente." };
      }
      return {
        externalId,
        status: "accepted",
      };

    } catch (err: any) {
      console.error(`[MetaAdapter] Exceção durante envio (tenant: ${tenantId}):`, err);
      const uncertain = err?.name === "TimeoutError" || err?.name === "AbortError"
        || err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT"
        || /fetch failed|network|timeout/i.test(err?.message || "");
      return {
        externalId: "",
        status: uncertain ? "unknown" : "failed",
        error: uncertain
          ? "Confirmação de envio não recebida da Meta. Não reenvie automaticamente; aguarde o webhook ou reconcilie manualmente."
          : err.message || "Erro inesperado ao despachar para a Meta API",
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
      const [stored] = await db.select().from(channelConfigs).where(eq(channelConfigs.tenantId, tenantId));
      const phoneNumberId = customConfig?.metaPhoneNumberId || stored?.metaPhoneNumberId;
      const accessToken = customConfig?.metaAccessToken || stored?.metaAccessToken;
      if (!phoneNumberId || !accessToken) {
        return { valid: false, error: "Phone Number ID e Access Token são obrigatórios para testar." };
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
