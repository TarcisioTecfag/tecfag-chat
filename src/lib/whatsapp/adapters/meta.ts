import { WhatsAppAdapter, UniversalOutboundMessage, DeliveryStatus, ChannelSettings } from "../types";
import { db } from "../../../db";
import { channelConfigs, mediaFiles, messages } from "../../../db/schema";
import { and, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { getMetaServiceWindow } from "../meta-policy";
import { convertAudioToOggOpus, metaAudioNeedsConversion, META_AUDIO_OUTPUT_MIME } from "../audio-convert";
import { getMetaTemplateBindings } from "../meta-templates";
import { isSupportedMetaTemplate, type TemplateBindings } from "../meta-template-common";

const META_GRAPH_VERSION = "v21.0";
const META_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const META_BSUID_BASE_URL = "https://graph.facebook.com/v25.0";

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

  async listApprovedTemplates(tenantId: string): Promise<Array<{ id: string; name: string; language: string; category: string; bodyText: string; variableCount: number; supported: boolean; bindings: TemplateBindings }>> {
    const { accessToken, businessAccountId } = await this.getCredentials(tenantId);
    if (!businessAccountId) throw new Error("Meta Business Account ID não configurado para este tenant");

    const templates: Array<{ id: string; name: string; language: string; category: string; bodyText: string; variableCount: number; supported: boolean; bindings: TemplateBindings }> = [];
    let url: string | null = `${META_BASE_URL}/${encodeURIComponent(businessAccountId)}/message_templates?fields=id,name,language,status,category,components&limit=100`;
    for (let page = 0; url && page < 10; page++) {
      const response: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || "Falha ao consultar templates aprovados na Meta");
      for (const item of data.data || []) {
        if (item.status === "APPROVED" && item.name && item.language) {
          const components = Array.isArray(item.components) ? item.components : [];
          const bodyText = String(components.find((c: any) => c.type === "BODY")?.text || "");
          const variableCount = Math.max(0, ...Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1])));
          const supported = isSupportedMetaTemplate(components, bodyText);
          templates.push({ id: String(item.id), name: item.name, language: item.language, category: item.category || "", bodyText, variableCount, supported,
            bindings: item.id ? await getMetaTemplateBindings(tenantId, String(item.id)) : {} });
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

      // O BSUID tem prioridade: um telefone antigo pode deixar de ser um destino válido.
      const cleanTo = message.recipientPhone.replace(/\D/g, "");
      const userId = message.recipientUserId?.trim();
      if (!userId && !cleanTo) {
        return { externalId: "", status: "failed", error: "Contato sem BSUID ou telefone para envio" };
      }

      let bodyPayload: Record<string, any> = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...(userId ? { recipient: userId } : { to: cleanTo }),
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
      // 2. Mídia (Imagem, Áudio, Vídeo, Documento, Figurinha)
      else if (message.mediaUrl && message.mediaType) {
        let mediaPayload: Record<string, any>;
        let resolvedMimeType = "";
        let sendType: "image" | "audio" | "video" | "document" | "sticker" = message.mediaType;

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

          resolvedMimeType = mimeType.toLowerCase();

          // A Cloud API tem tipo próprio para figurinha: WebP enviado como "image" é rejeitado.
          if (sendType === "image" && resolvedMimeType.startsWith("image/webp")) {
            sendType = "sticker";
          }

          // A Cloud API só aceita AAC, M4A/MP4, MP3, AMR e OGG/Opus. Áudio gravado pelo navegador (WebM)
          // e outros formatos são convertidos para OGG/Opus, que o WhatsApp exibe como mensagem de voz.
          let uploadFileName = fileName;
          if (sendType === "audio" && mediaBuffer && metaAudioNeedsConversion(mimeType)) {
            try {
              mediaBuffer = await convertAudioToOggOpus(mediaBuffer);
              mimeType = META_AUDIO_OUTPUT_MIME;
              uploadFileName = `${fileName.replace(/\.[^./\\]+$/, "") || "audio"}.ogg`;
            } catch (convErr: any) {
              console.error(`[MetaAdapter] Falha ao converter áudio para OGG/Opus (tenant: ${tenantId}):`, convErr);
              return {
                externalId: "",
                status: "failed",
                error: "Não foi possível converter o áudio para o formato aceito pela Meta. Tente enviar um arquivo MP3, M4A ou OGG.",
              };
            }
          }

          if (mediaBuffer) {
            const metaMediaId = await this.uploadMediaToMeta(phoneNumberId, accessToken, mediaBuffer, uploadFileName, mimeType);
            mediaPayload = { id: metaMediaId };
          } else {
            mediaPayload = { link: message.mediaUrl };
          }
        }

        // Legenda: só image, video e document. Áudio e figurinha não aceitam caption.
        if (message.text && (sendType === "image" || sendType === "video" || sendType === "document")) {
          mediaPayload.caption = message.text;
        }
        // Nome do arquivo: parâmetro exclusivo de document.
        if (message.fileName && sendType === "document") mediaPayload.filename = message.fileName;

        bodyPayload = {
          ...bodyPayload,
          type: sendType,
          [sendType]: mediaPayload,
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

      const response = await fetch(`${userId ? META_BSUID_BASE_URL : META_BASE_URL}/${phoneNumberId}/messages`, {
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

        console.error(`[MetaAdapter] Falha no envio para ${userId ? "[BSUID]" : cleanTo} (tenant: ${tenantId}):`, metaError);
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

  /**
   * Confirmação de leitura oficial da Cloud API: o cliente passa a ver ✓✓ azul em todas as mensagens
   * até `wamid` (inclusive). Com `typing = true`, também exibe "digitando..." no WhatsApp do cliente
   * por até 25s ou até a próxima mensagem enviada — a Meta só permite o indicador atrelado ao "lido".
   * A Cloud API NÃO oferece indicador de "gravando áudio" (apenas `typing_indicator.type = "text"`).
   */
  async markInboundRead(tenantId: string, wamid: string, typing = false): Promise<{ ok: boolean; error?: string }> {
    try {
      if (!wamid) return { ok: false, error: "wamid ausente" };
      const { phoneNumberId, accessToken } = await this.getCredentials(tenantId);
      const response = await fetch(`${META_BASE_URL}/${phoneNumberId}/messages`, {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: wamid,
          ...(typing ? { typing_indicator: { type: "text" } } : {}),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        return { ok: false, error: data?.error?.message || `HTTP ${response.status}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || "Falha ao contatar a Meta" };
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

  /**
   * Envia uma reação a uma mensagem existente via Meta Cloud API.
   * Para remover uma reação existente, passa emoji vazio/nulo ("").
   */
  async sendReaction(
    tenantId: string,
    recipientPhone: string,
    targetWamid: string,
    emoji: string
  ): Promise<{ success: boolean; externalId?: string; error?: string }> {
    try {
      const { phoneNumberId, accessToken } = await this.getCredentials(tenantId);
      const cleanPhone = recipientPhone.replace(/\D/g, "");
      const cleanWamid = targetWamid.replace(/^meta:[^:]+:/, "").trim();

      if (!cleanWamid) {
        return { success: false, error: "Mensagem alvo sem WAMID válido para reação na Meta" };
      }

      const bodyPayload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanPhone,
        type: "reaction",
        reaction: {
          message_id: cleanWamid,
          emoji: emoji ? emoji.trim() : "",
        },
      };

      const response = await fetch(`${META_BASE_URL}/${phoneNumberId}/messages`, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bodyPayload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorMsg = data?.error?.message || `Erro HTTP ${response.status} ao enviar reação na Meta`;
        console.warn(`[MetaAdapter.sendReaction] Falha (tenant ${tenantId}):`, errorMsg, data);
        return { success: false, error: errorMsg };
      }

      return { success: true, externalId: data?.messages?.[0]?.id };
    } catch (err: any) {
      console.error(`[MetaAdapter.sendReaction] Exceção (tenant ${tenantId}):`, err);
      return { success: false, error: err?.message || "Falha de rede ao enviar reação para a Meta" };
    }
  }
}

export const metaAdapter = new MetaAdapter();
