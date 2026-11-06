import { WhatsAppAdapter, UniversalOutboundMessage, DeliveryStatus, ChannelSettings } from "../types";
import { db } from "../../../db";
import { channelConfigs, mediaFiles, messages } from "../../../db/schema";
import { and, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { getMetaServiceWindow } from "../meta-policy";
import { convertAudioToOggOpus, metaAudioNeedsConversion, META_AUDIO_OUTPUT_MIME } from "../audio-convert";
import {
  convertAndCompressVideoToMp4,
  metaVideoNeedsConversion,
  META_VIDEO_OUTPUT_MIME,
} from "../video-convert";
import { getMetaTemplateBindings, getMetaTemplateLocalMetadataMap } from "../meta-templates";
import { isSupportedMetaTemplate, type TemplateBindings } from "../meta-template-common";
import { normalizeCanonicalPhone } from "../../utils";

const META_GRAPH_VERSION = "v21.0";
const META_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const META_BSUID_BASE_URL = "https://graph.facebook.com/v25.0";

function parseMetaMessagingTier(rawTier: unknown): {
  tierCode: string | null;
  tierLabel: string;
  dailyLimit: number | null;
  meetsCallingMinimum: boolean | null;
} {
  const code = typeof rawTier === "string" ? rawTier.trim().toUpperCase() : "";
  if (!code) {
    return {
      tierCode: null,
      tierLabel: "Não informado pela API",
      dailyLimit: null,
      meetsCallingMinimum: null,
    };
  }

  const map: Record<string, { label: string; limit: number }> = {
    TIER_50: { label: "50 conversas / 24h (Iniciante)", limit: 50 },
    TIER_250: { label: "250 conversas / 24h (Padrão Inicial)", limit: 250 },
    TIER_1K: { label: "1.000 conversas / 24h", limit: 1000 },
    TIER_2K: { label: "2.000 conversas / 24h (Mínimo para Ligações)", limit: 2000 },
    TIER_10K: { label: "10.000 conversas / 24h", limit: 10000 },
    TIER_100K: { label: "100.000 conversas / 24h", limit: 100000 },
    TIER_UNLIMITED: { label: "Ilimitado", limit: 1000000 },
    STANDARD: { label: "Padrão (250 / 24h)", limit: 250 },
  };

  if (map[code]) {
    return {
      tierCode: code,
      tierLabel: map[code].label,
      dailyLimit: map[code].limit,
      meetsCallingMinimum: map[code].limit >= 2000,
    };
  }

  const numMatch = code.match(/(\d+)\s*K\b/i);
  if (numMatch) {
    const limit = Number(numMatch[1]) * 1000;
    return {
      tierCode: code,
      tierLabel: `${limit.toLocaleString("pt-BR")} conversas / 24h`,
      dailyLimit: limit,
      meetsCallingMinimum: limit >= 2000,
    };
  }

  const rawNum = Number(code.replace(/\D/g, ""));
  if (Number.isFinite(rawNum) && rawNum > 0) {
    return {
      tierCode: code,
      tierLabel: `${rawNum.toLocaleString("pt-BR")} conversas / 24h`,
      dailyLimit: rawNum,
      meetsCallingMinimum: rawNum >= 2000,
    };
  }

  return {
    tierCode: code,
    tierLabel: code,
    dailyLimit: null,
    meetsCallingMinimum: null,
  };
}

export class MetaAdapter implements WhatsAppAdapter {
  readonly provider = "meta" as const;

  async downloadInboundMedia(
    tenantId: string,
    phoneNumberId: string,
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
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

  private async getCredentials(
    tenantId: string,
  ): Promise<{ phoneNumberId: string; accessToken: string; businessAccountId: string | null }> {
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

  async listApprovedTemplates(
    tenantId: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      language: string;
      category: string;
      bodyText: string;
      variableCount: number;
      supported: boolean;
      bindings: TemplateBindings;
      customGroups: string[];
      allPipelines?: boolean;
      pipelineIds?: string[];
      stageIds?: string[];
      components: unknown[];
    }>
  > {
    const { accessToken, businessAccountId } = await this.getCredentials(tenantId);
    if (!businessAccountId) throw new Error("Meta Business Account ID não configurado para este tenant");

    const localMetaMap = await getMetaTemplateLocalMetadataMap(tenantId);
    const templates: Array<{
      id: string;
      name: string;
      language: string;
      category: string;
      bodyText: string;
      variableCount: number;
      supported: boolean;
      bindings: TemplateBindings;
      customGroups: string[];
      allPipelines?: boolean;
      pipelineIds?: string[];
      stageIds?: string[];
      components: unknown[];
    }> = [];
    let url: string | null = `${META_BASE_URL}/${encodeURIComponent(businessAccountId)}/message_templates?fields=id,name,language,status,category,components&limit=100`;
    for (let page = 0; url && page < 10; page++) {
      const response: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || "Falha ao consultar templates aprovados na Meta");
      for (const item of data.data || []) {
        if (item.status === "APPROVED" && item.name && item.language) {
          const components = Array.isArray(item.components) ? item.components : [];
          const bodyText = String(components.find((c: any) => c.type === "BODY")?.text || "");
          const variableCount = Math.max(0, ...Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1])));
          const supported = isSupportedMetaTemplate(components, bodyText);
          const localMeta =
            (item.id ? localMetaMap.get(String(item.id)) : undefined) ||
            localMetaMap.get(`${item.name}:${item.language}`);
          templates.push({
            id: String(item.id),
            name: item.name,
            language: item.language,
            category: item.category || "",
            bodyText,
            variableCount,
            supported,
            components,
            bindings: localMeta?.bindings || (item.id ? await getMetaTemplateBindings(tenantId, String(item.id)) : {}),
            customGroups: localMeta?.customGroups || [],
            allPipelines: localMeta?.allPipelines ?? true,
            pipelineIds: localMeta?.pipelineIds ?? [],
            stageIds: localMeta?.stageIds ?? [],
          });
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
    mimeType: string,
  ): Promise<string> {
    const cleanMime = (mimeType || "application/octet-stream").split(";")[0].trim().toLowerCase();
    const rawExt = (fileName.split(".").pop() || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const fallbackExt = cleanMime.startsWith("video/")
      ? "mp4"
      : cleanMime.includes("ogg")
        ? "ogg"
        : cleanMime.startsWith("image/png")
          ? "png"
          : cleanMime.startsWith("image/webp")
            ? "webp"
            : cleanMime.startsWith("image/")
              ? "jpg"
              : cleanMime.includes("pdf")
                ? "pdf"
                : "bin";
    const safeUploadName = `media-${Date.now()}.${rawExt || fallbackExt}`;
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: cleanMime });
    formData.append("file", blob, safeUploadName);
    formData.append("type", cleanMime);
    formData.append("messaging_product", "whatsapp");

    const uploadRes = await fetch(`${META_BASE_URL}/${phoneNumberId}/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
      signal: AbortSignal.timeout(60000),
    });

    if (!uploadRes.ok) {
      const errJson = await uploadRes.json().catch(() => ({}));
      const metaDetails = errJson?.error?.error_data?.details || errJson?.error?.error_user_msg;
      const baseMsg = errJson?.error?.message || uploadRes.statusText;
      console.error("[MetaAdapter.uploadMediaToMeta] Erro da Meta:", {
        status: uploadRes.status,
        cleanMime,
        bytes: buffer.length,
        error: errJson?.error || errJson,
      });
      throw new Error(
        `Falha no upload de mídia para Meta API: ${baseMsg}${metaDetails ? ` (${metaDetails})` : ""}`,
      );
    }

    const uploadData = await uploadRes.json();
    if (!uploadData?.id) {
      throw new Error("Meta API não retornou ID de mídia válido no upload");
    }

    return uploadData.id;
  }

  async send(
    tenantId: string,
    message: UniversalOutboundMessage,
  ): Promise<{
    externalId: string;
    status: DeliveryStatus;
    error?: string;
    retryable?: boolean;
  }> {
    let requestStarted = false;
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
      const cleanTo = normalizeCanonicalPhone(message.recipientPhone);
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
          let resolvedMediaId: string | null = null;

          try {
            const urlMatch = message.mediaUrl.match(/messageId=([^&]+)/);
            const messageId = urlMatch
              ? decodeURIComponent(urlMatch[1])
              : message.mediaUrl.startsWith("media-")
                ? message.mediaUrl
                : null;
            if (messageId) {
              resolvedMediaId = messageId;
              const [record] = await db.select().from(mediaFiles).where(and(eq(mediaFiles.id, messageId), eq(mediaFiles.tenantId, tenantId)));
              if (!record) throw new Error("Mídia não pertence ao tenant da mensagem");
              if (record.mimeType) mimeType = record.mimeType;
              const localPath = path.join(process.cwd(), "media", messageId);
              const mimePath = path.join(process.cwd(), "media", `${messageId}.mime`);
              if (fs.existsSync(localPath)) {
                mediaBuffer = fs.readFileSync(localPath);
                if (fs.existsSync(mimePath)) {
                  const diskMime = fs.readFileSync(mimePath, "utf-8").trim();
                  if (diskMime) mimeType = diskMime;
                }
              } else {
                if (record?.base64Data) {
                  mediaBuffer = Buffer.from(record.base64Data, "base64");
                  mimeType = record.mimeType || mimeType;
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

          // Para garantir reprodução nativa como mensagem de voz (PTT) no WhatsApp (Android, iOS e Web),
          // todo áudio deve estar em OGG/Opus mono 48kHz e ser enviado com voice: true.
          let uploadFileName = fileName;
          if (sendType === "audio" && mediaBuffer && metaAudioNeedsConversion(mimeType, mediaBuffer)) {
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

          // Compressão e padronização automática de vídeos para MP4 H.264/AAC (< 15 MB) aceito pela Meta Cloud API
          let videoAlreadyTranscoded = false;
          const transcodeAndPersistVideo = async () => {
            if (!mediaBuffer) return;
            const originalBytes = mediaBuffer.length;
            mediaBuffer = await convertAndCompressVideoToMp4(mediaBuffer);
            mimeType = META_VIDEO_OUTPUT_MIME;
            uploadFileName = `${fileName.replace(/\.[^./\\]+$/, "") || "video"}.mp4`;
            videoAlreadyTranscoded = true;
            console.log(
              `[MetaAdapter] Vídeo comprimido/padronizado para MP4 H.264 (tenant: ${tenantId}): ${(originalBytes / (1024 * 1024)).toFixed(2)} MB -> ${(mediaBuffer.length / (1024 * 1024)).toFixed(2)} MB`,
            );
            if (resolvedMediaId) {
              try {
                await db
                  .update(mediaFiles)
                  .set({
                    mimeType: META_VIDEO_OUTPUT_MIME,
                    fileSize: mediaBuffer.length,
                    base64Data: mediaBuffer.toString("base64"),
                  })
                  .where(and(eq(mediaFiles.id, resolvedMediaId), eq(mediaFiles.tenantId, tenantId)));
                const mediaDir = path.join(process.cwd(), "media");
                if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
                await fs.promises.writeFile(path.join(mediaDir, resolvedMediaId), mediaBuffer);
                await fs.promises.writeFile(path.join(mediaDir, `${resolvedMediaId}.mime`), META_VIDEO_OUTPUT_MIME);
              } catch (persistErr) {
                console.warn("[MetaAdapter] Não foi possível atualizar cache do vídeo comprimido:", persistErr);
              }
            }
          };

          if (sendType === "video" && mediaBuffer && metaVideoNeedsConversion(mimeType, mediaBuffer)) {
            try {
              await transcodeAndPersistVideo();
            } catch (convErr: any) {
              console.error(`[MetaAdapter] Falha ao comprimir/converter vídeo para MP4 (tenant: ${tenantId}):`, convErr);
              return {
                externalId: "",
                status: "failed",
                error: "Não foi possível comprimir ou converter o vídeo para o limite da Meta (16 MB MP4 H.264).",
              };
            }
          }

          if (mediaBuffer) {
            let metaMediaId: string;
            try {
              metaMediaId = await this.uploadMediaToMeta(phoneNumberId, accessToken, mediaBuffer, uploadFileName, mimeType);
            } catch (uploadErr: any) {
              // Fallback automático: se um vídeo aparentemente válido (< 15 MB) for rejeitado pela Meta (ex.: (#100) Invalid parameter por codec/perfil interno), recodifica via FFmpeg e reenvia
              if (sendType === "video" && !videoAlreadyTranscoded) {
                console.warn(
                  `[MetaAdapter] Upload de vídeo rejeitado pela Meta (${uploadErr?.message}); aplicando compressão/recodificação automática via FFmpeg e tentando novamente...`,
                );
                await transcodeAndPersistVideo();
                metaMediaId = await this.uploadMediaToMeta(phoneNumberId, accessToken, mediaBuffer, uploadFileName, mimeType);
              } else {
                throw uploadErr;
              }
            }
            const isOggVoice =
              sendType === "audio" &&
              (mimeType.toLowerCase().includes("ogg") ||
                uploadFileName.toLowerCase().endsWith(".ogg") ||
                uploadFileName.toLowerCase().endsWith(".opus"));
            mediaPayload = isOggVoice ? { id: metaMediaId, voice: true } : { id: metaMediaId };
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
      } else {
        return { externalId: "", status: "failed", error: "Mensagem sem texto, mídia ou template" };
      }

      // Contexto de resposta a mensagem anterior (quoted) se fornecido (suportado para texto e mídia)
      if (!message.templateName && message.quotedMessageId) {
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

      const messagesEndpoint = `${userId ? META_BSUID_BASE_URL : META_BASE_URL}/${phoneNumberId}/messages`;
      requestStarted = true;
      let response = await fetch(messagesEndpoint, {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bodyPayload),
      });

      let data = await response.json();

      // Fallback defensivo: caso a API rejeite especificamente o parâmetro `voice`, reenvia sem `voice`
      if (
        !response.ok &&
        bodyPayload.type === "audio" &&
        bodyPayload.audio?.voice &&
        /voice/i.test(data?.error?.message || "")
      ) {
        const fallbackPayload = {
          ...bodyPayload,
          audio: { id: bodyPayload.audio.id },
        };
        response = await fetch(messagesEndpoint, {
          method: "POST",
          signal: AbortSignal.timeout(30000),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(fallbackPayload),
        });
        data = await response.json();
      }

      if (!response.ok) {
        const metaError = data?.error;
        let errorMessage = metaError?.message || `Erro HTTP ${response.status} na Meta API`;

        // Tratar erro clássico de janela de 24 horas da Meta
        if (metaError?.code === 131047) {
          errorMessage = "Conversa fora da janela de 24h da Meta. É necessário utilizar um Template aprovado para reabrir o diálogo.";
        } else if (metaError?.code === 130472 || /part of an experiment/i.test(errorMessage)) {
          errorMessage = "User's number is part of an experiment (130472)";
        } else if (metaError?.code === 131049 || /healthy ecosystem engagement/i.test(errorMessage)) {
          errorMessage = "This message was not delivered to maintain healthy ecosystem engagement (131049)";
        } else if (metaError?.code === 131026 || /message undeliverable/i.test(errorMessage)) {
          errorMessage = "Message undeliverable (131026)";
        }

        console.error(`[MetaAdapter] Falha no envio para ${userId ? "[BSUID]" : cleanTo} (tenant: ${tenantId}):`, metaError);
        return {
          externalId: "",
          status: response.status >= 500 ? "unknown" : "failed",
          error: errorMessage,
          retryable: response.status === 429,
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
      console.error(`[MetaAdapter.send] Exceção (tenant ${tenantId}):`, err);
      const uncertain = requestStarted;
      const transientBeforeSend = !requestStarted && (err?.name === "TimeoutError" ||
        err?.name === "AbortError" ||
        err?.code === "ECONNRESET" ||
        err?.code === "ETIMEDOUT" ||
        /fetch failed|network|timeout/i.test(err?.message || ""));
      return {
        externalId: "",
        status: uncertain ? "unknown" : "failed",
        retryable: transientBeforeSend,
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
  async markInboundRead(
    tenantId: string,
    wamid: string,
    typing = false,
  ): Promise<{ ok: boolean; error?: string }> {
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
      const res = await fetch(
        `${META_BASE_URL}/${config.metaPhoneNumberId}?fields=verified_name,display_phone_number,quality_rating`,
        {
          headers: { Authorization: `Bearer ${config.metaAccessToken}` },
        },
      );

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

  async testCredentials(
    tenantId: string,
    customConfig?: Partial<ChannelSettings>,
  ): Promise<{
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

      const res = await fetch(
        `${META_BASE_URL}/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,code_verification_status,messaging_limit_tier`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      const data = await res.json();

      if (!res.ok) {
        return {
          valid: false,
          error: data?.error?.message || `Código de erro HTTP ${res.status}`,
        };
      }

      const tierInfo = parseMetaMessagingTier(
        data.whatsapp_business_manager_messaging_limit || data.messaging_limit_tier,
      );

      return {
        valid: true,
        details: {
          verifiedName: data.verified_name,
          phoneNumber: data.display_phone_number,
          qualityRating: data.quality_rating,
          verificationStatus: data.code_verification_status,
          messagingTierCode: tierInfo.tierCode,
          messagingTierLabel: tierInfo.tierLabel,
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
   * Verifica na Graph API da Meta se o número e o portfólio já atendem aos requisitos
   * da WhatsApp Business Calling API (Tier >= 2.000 conversas/24h e status de `/settings`).
   */
  async checkCallingEligibility(
    tenantId: string,
    customConfig?: Partial<ChannelSettings>,
  ): Promise<{
    valid: boolean;
    eligible: boolean;
    callingEnabled: boolean;
    summaryMessage: string;
    error?: string;
    details?: {
      phoneNumberId: string;
      verifiedName: string;
      phoneNumber: string;
      qualityRating: string;
      platformType: string | null;
      accountMode: string | null;
      tierCode: string | null;
      tierLabel: string;
      dailyLimit: number | null;
      meetsCallingMinimum: boolean | null;
      callingStatus: string | null;
      callIconVisibility: string | null;
      callbackPermissionStatus: string | null;
      settingsReachable: boolean;
      settingsError: string | null;
      settingsErrorCode: number | null;
    };
  }> {
    try {
      const [stored] = await db.select().from(channelConfigs).where(eq(channelConfigs.tenantId, tenantId));
      const phoneNumberId = (customConfig?.metaPhoneNumberId || stored?.metaPhoneNumberId || "").trim();
      const accessToken = (customConfig?.metaAccessToken || stored?.metaAccessToken || "").trim();

      if (!phoneNumberId || !accessToken) {
        return {
          valid: false,
          eligible: false,
          callingEnabled: false,
          summaryMessage: "Phone Number ID e Access Token são obrigatórios para verificar ligações.",
          error: "Phone Number ID e Access Token são obrigatórios para verificar ligações.",
        };
      }

      // 1. Consulta metadados e tier de limite do número (com fallback caso algum campo novo não exista na versão)
      const fieldAttempts = [
        "id,verified_name,display_phone_number,quality_rating,code_verification_status,messaging_limit_tier,whatsapp_business_manager_messaging_limit,platform_type,account_mode",
        "id,verified_name,display_phone_number,quality_rating,code_verification_status,messaging_limit_tier,platform_type,account_mode",
        "id,verified_name,display_phone_number,quality_rating,code_verification_status",
      ];

      let phoneData: any = null;
      let lastPhoneError = "";
      for (const fields of fieldAttempts) {
        const res = await fetch(`${META_BASE_URL}/${encodeURIComponent(phoneNumberId)}?fields=${fields}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15000),
        });
        const parsed = await res.json().catch(() => ({}));
        if (res.ok) {
          phoneData = parsed;
          break;
        }
        lastPhoneError = parsed?.error?.message || `HTTP ${res.status}`;
        // Se for erro de token (190) ou permissão (10/200), não adianta tentar menos campos
        if (parsed?.error?.code === 190 || res.status === 401 || res.status === 403) {
          break;
        }
      }

      if (!phoneData) {
        return {
          valid: false,
          eligible: false,
          callingEnabled: false,
          summaryMessage: `Falha ao consultar número na Meta: ${lastPhoneError}`,
          error: lastPhoneError,
        };
      }

      const rawTier =
        phoneData.whatsapp_business_manager_messaging_limit ||
        phoneData.messaging_limit_tier ||
        null;
      const tierInfo = parseMetaMessagingTier(rawTier);

      // 2. Consulta o endpoint `/settings` do número para inspecionar o objeto `calling`
      let callingSettings: any = null;
      let settingsReachable = false;
      let settingsError: string | null = null;
      let settingsErrorCode: number | null = null;

      try {
        const settingsRes = await fetch(`${META_BASE_URL}/${encodeURIComponent(phoneNumberId)}/settings`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15000),
        });
        const settingsJson = await settingsRes.json().catch(() => ({}));
        if (settingsRes.ok) {
          settingsReachable = true;
          callingSettings =
            settingsJson?.calling ||
            (Array.isArray(settingsJson?.data) ? settingsJson.data[0]?.calling : null) ||
            null;
        } else {
          settingsError =
            settingsJson?.error?.error_user_msg ||
            settingsJson?.error?.message ||
            `HTTP ${settingsRes.status}`;
          settingsErrorCode = settingsJson?.error?.code ?? null;
        }
      } catch (e: any) {
        settingsError = e?.message || "Falha de rede ao consultar /settings";
      }

      const callingStatus: string | null = callingSettings?.status
        ? String(callingSettings.status).toUpperCase()
        : null;
      const callIconVisibility: string | null = callingSettings?.call_icon_visibility || null;
      const callbackPermissionStatus: string | null = callingSettings?.callback_permission_status || null;

      const callingEnabled = callingStatus === "ENABLED";
      const eligible =
        callingEnabled ||
        tierInfo.meetsCallingMinimum === true ||
        (callingStatus !== null && tierInfo.meetsCallingMinimum !== false);

      let summaryMessage = "";
      if (callingEnabled) {
        summaryMessage = `Ligações nativas JÁ ATIVAS neste número (${phoneData.display_phone_number || phoneNumberId})! Nível atual: ${tierInfo.tierLabel}.`;
      } else if (tierInfo.meetsCallingMinimum === true) {
        summaryMessage = `Número ELEGÍVEL para Ligações Meta (${tierInfo.tierLabel})! O recurso de voz está atualmente ${callingStatus || "DESATIVADO"} — você já pode ativá-lo.`;
      } else if (tierInfo.meetsCallingMinimum === false) {
        summaryMessage = `Ainda não liberado pela Meta: o número está no limite de ${tierInfo.tierLabel}, e a Meta exige o nível mínimo de 2.000 conversas / 24h (TIER_2K) para liberar ligações por API.`;
      } else if (settingsReachable && callingStatus) {
        summaryMessage = `Endpoint de ligações acessível na Meta (status atual: ${callingStatus}).`;
      } else {
        summaryMessage = `Número validado (${phoneData.display_phone_number || phoneNumberId}), mas a API ainda não retornou liberação de chamadas (${settingsError || tierInfo.tierLabel}).`;
      }

      return {
        valid: true,
        eligible,
        callingEnabled,
        summaryMessage,
        details: {
          phoneNumberId,
          verifiedName: phoneData.verified_name || "Meta Cloud",
          phoneNumber: phoneData.display_phone_number || "",
          qualityRating: phoneData.quality_rating || "UNKNOWN",
          platformType: phoneData.platform_type || null,
          accountMode: phoneData.account_mode || null,
          tierCode: tierInfo.tierCode,
          tierLabel: tierInfo.tierLabel,
          dailyLimit: tierInfo.dailyLimit,
          meetsCallingMinimum: tierInfo.meetsCallingMinimum,
          callingStatus,
          callIconVisibility,
          callbackPermissionStatus,
          settingsReachable,
          settingsError,
          settingsErrorCode,
        },
      };
    } catch (err: any) {
      return {
        valid: false,
        eligible: false,
        callingEnabled: false,
        summaryMessage: err.message || "Erro ao consultar elegibilidade de ligações na Meta",
        error: err.message || "Erro ao consultar elegibilidade de ligações na Meta",
      };
    }
  }

  /**
   * Ativa ou desativa a configuração de chamadas nativas (`calling.status = "ENABLED" | "DISABLED"`)
   * diretamente no endpoint `POST /{PHONE_NUMBER_ID}/settings` da Meta Cloud API.
   */
  async setCallingStatus(
    tenantId: string,
    enable: boolean,
    customConfig?: Partial<ChannelSettings>,
  ): Promise<{
    success: boolean;
    message: string;
    error?: string;
    metaCode?: number;
    eligibility?: Awaited<ReturnType<MetaAdapter["checkCallingEligibility"]>>;
  }> {
    try {
      const [stored] = await db.select().from(channelConfigs).where(eq(channelConfigs.tenantId, tenantId));
      const phoneNumberId = (customConfig?.metaPhoneNumberId || stored?.metaPhoneNumberId || "").trim();
      const accessToken = (customConfig?.metaAccessToken || stored?.metaAccessToken || "").trim();

      if (!phoneNumberId || !accessToken) {
        return {
          success: false,
          message: "Phone Number ID e Access Token são obrigatórios.",
          error: "Phone Number ID e Access Token são obrigatórios.",
        };
      }

      const payload = {
        calling: {
          status: enable ? "ENABLED" : "DISABLED",
          call_icon_visibility: "DEFAULT",
          callback_permission_status: "ENABLED",
        },
      };

      const res = await fetch(`${META_BASE_URL}/${encodeURIComponent(phoneNumberId)}/settings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const rawMsg =
          data?.error?.error_user_msg ||
          data?.error?.error_data?.details ||
          data?.error?.message ||
          `HTTP ${res.status}`;
        const code = data?.error?.code;
        return {
          success: false,
          message: `A Meta recusou a ativação de chamadas neste momento: ${rawMsg}${code ? ` (Código Meta #${code})` : ""}`,
          error: rawMsg,
          metaCode: code,
        };
      }

      const eligibility = await this.checkCallingEligibility(tenantId, customConfig);
      return {
        success: true,
        message: enable
          ? "Ligações nativas (WhatsApp Calling API) ativadas com sucesso no número!"
          : "Ligações nativas desativadas no número.",
        eligibility,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || "Falha de comunicação ao configurar chamadas na Meta.",
        error: err?.message,
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
    emoji: string,
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
          Authorization: `Bearer ${accessToken}`,
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
