/**
 * Tipos de mensagem da Cloud API que carregam arquivo (baixados e salvos em mediaFiles).
 * Renderizados no chat pelo marcador `[MEDIA:<tipo>]<id>`.
 */
export const META_MEDIA_TYPES = ["image", "audio", "video", "document", "sticker"] as const;

export function isMetaMediaType(type: unknown): type is (typeof META_MEDIA_TYPES)[number] {
  return typeof type === "string" && (META_MEDIA_TYPES as readonly string[]).includes(type);
}

/** Eventos que chegam em `messages` mas não são mensagens para o operador (reações têm tratamento próprio). */
export function isIgnorableMetaMessage(msg: any): boolean {
  return msg?.type === "request_welcome";
}

export interface MetaUnsupportedDetails {
  rawType: string;
  subtype?: string | null;
  errorCode?: number | null;
  errorTitle?: string | null;
  errorDetails?: string | null;
}

export interface MetaUnsupportedExplanation {
  rawType: string;
  subtype: string | null;
  errorCode: number | null;
  errorTitle: string | null;
  errorDetails: string | null;
  badgeLabel: string;
  headline: string;
  summary: string;
  possibleCauses: string[];
  clientInstruction: string;
  suggestedClientReply: string;
  previewLabel: string;
  technicalSummary: string;
}

interface UnsupportedSubtypeTemplate {
  persistedText: string;
  badgeLabel: string;
  headline: string;
  summary: string;
  possibleCauses: string[];
  clientInstruction: string;
  suggestedClientReply: string;
  previewLabel: string;
}

const HANDLED_NON_MEDIA_TYPES = new Set([
  "location",
  "contacts",
  "interactive",
  "button",
  "order",
]);

const UNSUPPORTED_SUBTYPE_TEMPLATES: Record<string, UnsupportedSubtypeTemplate> = {
  edit: {
    persistedText: "[Mensagem editada pelo cliente — não exibida pela API oficial do WhatsApp]",
    badgeLabel: "Edição · API Meta",
    headline: "O cliente editou uma mensagem anterior",
    summary:
      "O cliente usou o recurso de editar mensagem no WhatsApp, mas a API oficial da Meta não entrega o novo texto para o painel.",
    possibleCauses: [
      "O cliente editou uma mensagem já enviada pelo celular ou WhatsApp Web.",
    ],
    clientInstruction:
      "Peça para o cliente enviar a informação corrigida em uma nova mensagem.",
    suggestedClientReply:
      "Oi! Vi que você tentou editar uma mensagem anterior, mas pelo nosso sistema oficial de atendimento não recebemos edições do WhatsApp. Pode me enviar a informação corrigida em uma nova mensagem, por favor?",
    previewLabel: "Mensagem editada (não exibida pela Meta)",
  },
  poll_creation: {
    persistedText: "[Enquete do WhatsApp — formato não suportado pela API oficial]",
    badgeLabel: "Enquete · API Meta",
    headline: "O cliente enviou ou interagiu com uma enquete",
    summary:
      "Enquetes nativas do WhatsApp não são entregues pela API oficial da Meta para painéis de atendimento.",
    possibleCauses: [
      "Criação de enquete ou resposta em enquete pelo aplicativo do WhatsApp.",
    ],
    clientInstruction: "Peça para o cliente responder em mensagem de texto comum.",
    suggestedClientReply:
      "Oi! Nosso sistema oficial de atendimento não exibe enquetes do WhatsApp. Pode me mandar sua resposta por escrito em texto normal, por favor?",
    previewLabel: "Enquete do WhatsApp (não exibida pela Meta)",
  },
  poll_update: {
    persistedText: "[Voto em enquete do WhatsApp — formato não suportado pela API oficial]",
    badgeLabel: "Enquete · API Meta",
    headline: "O cliente votou em uma enquete",
    summary:
      "Interações e votos em enquetes nativas não são entregues pela API oficial da Meta para painéis externos.",
    possibleCauses: ["Voto ou atualização em enquete no WhatsApp."],
    clientInstruction: "Peça para o cliente confirmar a opção escolhida por escrito.",
    suggestedClientReply:
      "Oi! Nosso sistema oficial de atendimento não exibe votos de enquetes do WhatsApp. Pode me confirmar por escrito a opção desejada, por favor?",
    previewLabel: "Voto em enquete (não exibido pela Meta)",
  },
  media_placeholder: {
    persistedText:
      "[Mídia indisponível ou enviada em visualização única — bloqueada pela API oficial]",
    badgeLabel: "Mídia bloqueada · API Meta",
    headline: "Mídia em visualização única ou bloqueada pela Meta",
    summary:
      "A API oficial da Meta bloqueia fotos e vídeos de visualização única (\"ver uma vez\") ou mídias que não ficaram disponíveis para download.",
    possibleCauses: [
      "Foto ou vídeo enviado com \"Visualização única\" ativada (ícone ① no WhatsApp).",
      "Mídia ou arquivo bloqueado/indisponível nos servidores da Meta antes da entrega.",
    ],
    clientInstruction:
      "Peça para o cliente enviar novamente como foto, vídeo ou PDF comum (sem visualização única).",
    suggestedClientReply:
      "Oi! Não consegui abrir a última mídia que você enviou porque nosso sistema oficial não recebe arquivos em \"Visualização única\" ou bloqueados pelo WhatsApp. Pode me enviar novamente como foto/PDF normal ou em texto, por favor?",
    previewLabel: "Mídia não entregue pela Meta (ver aviso)",
  },
  view_once: {
    persistedText:
      "[Mídia em visualização única — não entregue pela API oficial do WhatsApp]",
    badgeLabel: "Visualização única · API Meta",
    headline: "Mídia enviada em visualização única",
    summary:
      "Por regra de privacidade da Meta, mídias enviadas em \"Visualização única\" não são entregues para sistemas conectados à API oficial.",
    possibleCauses: [
      "Foto ou vídeo enviado com o modo \"Visualização única\" (①) ativado.",
    ],
    clientInstruction:
      "Peça para reenviar a foto ou documento sem ativar a visualização única.",
    suggestedClientReply:
      "Oi! Não consigo visualizar fotos ou vídeos enviados em \"Visualização única\" pelo nosso sistema oficial. Pode me reenviar como foto ou arquivo comum, por favor?",
    previewLabel: "Mídia de visualização única (não exibida)",
  },
  ephemeral: {
    persistedText:
      "[Mensagem temporária/visualização única — não entregue pela API oficial]",
    badgeLabel: "Temporária · API Meta",
    headline: "Mensagem temporária ou de visualização única",
    summary:
      "A API oficial da Meta não repassou o conteúdo dessa mensagem temporária/restrita ao painel.",
    possibleCauses: [
      "Mídia de visualização única ou recurso temporário restrito pela API oficial.",
    ],
    clientInstruction:
      "Peça para o cliente enviar o conteúdo em mensagem de texto ou mídia comum.",
    suggestedClientReply:
      "Oi! Não consegui visualizar sua última mensagem pelo nosso sistema oficial de atendimento. Pode me enviar novamente em texto normal ou foto/PDF comum, por favor?",
    previewLabel: "Mensagem restrita pela Meta (ver aviso)",
  },
  gif: {
    persistedText: "[GIF em formato não suportado pela API oficial do WhatsApp]",
    badgeLabel: "GIF · API Meta",
    headline: "GIF enviado em formato não entregue pela Meta",
    summary:
      "Esse GIF foi enviado em um formato ou origem que a API oficial da Meta não repassa ao painel.",
    possibleCauses: ["GIF animado enviado em formato incompatível com a Cloud API."],
    clientInstruction:
      "Se houver alguma informação importante, peça para enviar em texto ou imagem comum.",
    suggestedClientReply:
      "Oi! Recebi sua última interação como um GIF que o painel oficial não conseguiu exibir. Se havia alguma informação importante, pode mandar em texto ou imagem normal, por favor?",
    previewLabel: "GIF não exibido pela Meta",
  },
  group_invite: {
    persistedText: "[Convite de grupo não suportado pela API oficial do WhatsApp]",
    badgeLabel: "Convite de grupo · API Meta",
    headline: "Convite de grupo não exibido pela API oficial",
    summary:
      "O cliente enviou um cartão de convite de grupo do WhatsApp, que a API oficial não entrega ao painel.",
    possibleCauses: ["Cartão/convite de grupo compartilhado pelo WhatsApp."],
    clientInstruction:
      "Explique que o atendimento oficial é individual e peça a informação em texto.",
    suggestedClientReply:
      "Oi! Nosso sistema oficial de atendimento funciona apenas em conversas individuais e não exibe convites de grupo. Pode me enviar por escrito por aqui mesmo, por favor?",
    previewLabel: "Convite de grupo (não exibido pela Meta)",
  },
  pin: {
    persistedText: "[Ação de fixar mensagem no WhatsApp — não exibida pela API oficial]",
    badgeLabel: "Mensagem fixada · API Meta",
    headline: "O cliente fixou uma mensagem no WhatsApp",
    summary:
      "O cliente usou a opção de fixar uma mensagem no chat do celular. Essa ação não traz texto novo.",
    possibleCauses: ["Ação de fixar mensagem na conversa do WhatsApp."],
    clientInstruction:
      "Normalmente não exige reenvio; pergunte apenas se ele enviou algo novo junto.",
    suggestedClientReply:
      "Oi! Apareceu aqui uma notificação de mensagem fixada no seu WhatsApp que o sistema não detalha. Você enviou alguma nova informação que precise que eu veja?",
    previewLabel: "Mensagem fixada no WhatsApp",
  },
  keep_in_chat: {
    persistedText: "[Ação de manter mensagem no chat — não exibida pela API oficial]",
    badgeLabel: "Ação no chat · API Meta",
    headline: "Ação de manter mensagem temporária salva",
    summary:
      "O cliente interagiu com a retenção de uma mensagem no aplicativo do celular; não há conteúdo novo bloqueado.",
    possibleCauses: ["O cliente salvou/manteve uma mensagem temporária no WhatsApp."],
    clientInstruction: "Confirme com o cliente apenas se ele tentou mandar algo novo.",
    suggestedClientReply:
      "Oi! Recebemos uma atualização interna do seu WhatsApp que o painel não exibe. Você chegou a enviar alguma mensagem ou arquivo novo agora?",
    previewLabel: "Atualização de mensagem no WhatsApp",
  },
};

UNSUPPORTED_SUBTYPE_TEMPLATES.poll = UNSUPPORTED_SUBTYPE_TEMPLATES.poll_creation;

const PERSISTED_TEXT_TO_SUBTYPE = new Map<string, string>(
  Object.entries(UNSUPPORTED_SUBTYPE_TEMPLATES).map(([key, tpl]) => [tpl.persistedText, key]),
);

const LEGACY_UNSUPPORTED_TEXT_RE = /^\[Mensagem do tipo "([^"]+)" não suportada pelo painel\]$/i;

function normalizeSubtypeKey(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase();
  return cleaned || null;
}

/**
 * Extrai metadados estruturados quando a Meta envia `type: "unsupported"` ou um tipo
 * desconhecido no webhook, preservando subtipo (`unsupported.type`) e erro (`errors[0]`).
 */
export function extractMetaUnsupportedDetails(msg: any): MetaUnsupportedDetails | null {
  if (!msg || typeof msg !== "object") return null;
  const type = typeof msg.type === "string" ? msg.type.trim() : "";
  if (!type) return null;

  if (
    type === "text" ||
    type === "reaction" ||
    isIgnorableMetaMessage(msg) ||
    isMetaMediaType(type) ||
    HANDLED_NON_MEDIA_TYPES.has(type) ||
    (type === "system" && typeof msg.system?.body === "string" && msg.system.body.trim().length > 0)
  ) {
    return null;
  }

  const subtype =
    typeof msg.unsupported?.type === "string" && msg.unsupported.type.trim()
      ? msg.unsupported.type.trim()
      : null;

  const firstErr = Array.isArray(msg.errors) ? msg.errors[0] : null;
  const rawCode = firstErr?.code;
  const errorCode =
    typeof rawCode === "number" && Number.isFinite(rawCode)
      ? rawCode
      : typeof rawCode === "string" && /^\d+$/.test(rawCode.trim())
        ? Number(rawCode.trim())
        : null;

  const errorTitle =
    typeof firstErr?.title === "string" && firstErr.title.trim()
      ? firstErr.title.trim()
      : typeof firstErr?.message === "string" && firstErr.message.trim()
        ? firstErr.message.trim()
        : null;

  const errorDetails =
    typeof firstErr?.error_data?.details === "string" && firstErr.error_data.details.trim()
      ? firstErr.error_data.details.trim()
      : null;

  return {
    rawType: type,
    subtype,
    errorCode,
    errorTitle,
    errorDetails,
  };
}

/**
 * Interpreta mensagens não suportadas (tanto registros novos com `metaDetails.metaUnsupported`
 * quanto registros já salvos no banco como `[Mensagem do tipo "unsupported" não suportada pelo painel]`)
 * para exibir um aviso claro exclusivo para o funcionário no painel.
 */
export function analyzeMetaUnsupportedMessage(
  text?: string | null,
  metaDetails?: Record<string, any> | null,
): MetaUnsupportedExplanation | null {
  const stored =
    metaDetails && typeof metaDetails === "object" && metaDetails.metaUnsupported
      ? (metaDetails.metaUnsupported as MetaUnsupportedDetails)
      : null;

  const trimmedText = typeof text === "string" ? text.trim() : "";
  const legacyMatch = trimmedText.match(LEGACY_UNSUPPORTED_TEXT_RE);
  const textMappedSubtype = PERSISTED_TEXT_TO_SUBTYPE.get(trimmedText) || null;

  if (!stored && !legacyMatch && !textMappedSubtype) {
    return null;
  }

  const rawType = stored?.rawType || legacyMatch?.[1] || textMappedSubtype || "unsupported";
  const subtype =
    normalizeSubtypeKey(stored?.subtype) ||
    textMappedSubtype ||
    (rawType.toLowerCase() !== "unsupported" ? normalizeSubtypeKey(rawType) : null);

  const errorCode =
    typeof stored?.errorCode === "number" && Number.isFinite(stored.errorCode)
      ? stored.errorCode
      : null;
  const errorTitle = stored?.errorTitle || null;
  const errorDetails = stored?.errorDetails || null;

  const template = subtype ? UNSUPPORTED_SUBTYPE_TEMPLATES[subtype] : undefined;

  const technicalParts = [`Tipo Meta: ${rawType}`];
  if (subtype && subtype !== rawType.toLowerCase()) {
    technicalParts.push(`Subtipo: ${subtype}`);
  }
  if (errorCode !== null) {
    technicalParts.push(`Código #${errorCode}`);
  }
  if (errorDetails || errorTitle) {
    technicalParts.push(errorDetails || errorTitle || "");
  }
  const technicalSummary = technicalParts.filter(Boolean).join(" · ");

  if (template) {
    return {
      rawType,
      subtype,
      errorCode,
      errorTitle,
      errorDetails,
      badgeLabel: errorCode ? `${template.badgeLabel} #${errorCode}` : template.badgeLabel,
      headline: template.headline,
      summary: template.summary,
      possibleCauses: template.possibleCauses,
      clientInstruction: template.clientInstruction,
      suggestedClientReply: template.suggestedClientReply,
      previewLabel: template.previewLabel,
      technicalSummary,
    };
  }

  const normalizedRaw = rawType.toLowerCase();
  const specificTypeSuffix =
    normalizedRaw !== "unsupported" && normalizedRaw !== "desconhecido"
      ? ` (tipo "${rawType}")`
      : "";

  return {
    rawType,
    subtype,
    errorCode,
    errorTitle,
    errorDetails,
    badgeLabel: errorCode ? `API Meta #${errorCode}` : "API Oficial Meta",
    headline: `Conteúdo bloqueado pelo WhatsApp${specificTypeSuffix}`,
    summary:
      "A própria API oficial da Meta entregou apenas este aviso, sem o arquivo ou texto original. Não foi erro seu nem perda silenciosa no painel.",
    possibleCauses: [
      "Foto, vídeo ou arquivo enviado em Visualização Única (\"Ver uma vez\" / ①).",
      "Mensagem que o cliente editou após enviar no WhatsApp.",
      "Enquete, figurinha/GIF especial ou recurso do WhatsApp de celular não liberado na API oficial.",
    ],
    clientInstruction:
      "Avise o cliente que o sistema oficial não abriu esse formato e peça para reenviar em texto digitado ou foto/PDF comum.",
    suggestedClientReply:
      "Oi! Não consegui visualizar sua última mensagem aqui pelo nosso sistema oficial de atendimento (o WhatsApp bloqueia envios em visualização única, mensagens editadas ou enquetes). Pode me enviar novamente em texto digitado ou foto/PDF comum, por favor?",
    previewLabel: "Mensagem bloqueada pelo WhatsApp (ver aviso)",
    technicalSummary,
  };
}

export function isMetaUnsupportedMessage(
  text?: string | null,
  metaDetails?: Record<string, any> | null,
): boolean {
  return analyzeMetaUnsupportedMessage(text, metaDetails) !== null;
}

/**
 * Converte mensagens que não são texto nem arquivo (localização, contato, resposta de botão,
 * pedido, tipos novos/não suportados) em texto legível para o chat.
 * Retorna `null` para texto e tipos de mídia, que têm tratamento próprio.
 * Nunca devolve string vazia: evita a bolha em branco no painel.
 */
export function describeNonMediaMetaMessage(msg: any): string | null {
  const type = msg?.type;
  if (type === "text" || isMetaMediaType(type)) return null;

  switch (type) {
    case "location": {
      const { latitude, longitude, name, address } = msg.location ?? {};
      const lines = ["📍 Localização"];
      if (name) lines.push(String(name));
      if (address) lines.push(String(address));
      if (latitude !== undefined && longitude !== undefined) {
        lines.push(`https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`);
      }
      return lines.join("\n");
    }
    case "contacts": {
      const list: any[] = Array.isArray(msg.contacts) ? msg.contacts : [];
      if (list.length === 0) return "👤 Contato compartilhado";
      return list
        .map((c) => {
          const name = c?.name?.formatted_name || "Contato";
          const phones = (Array.isArray(c?.phones) ? c.phones : [])
            .map((p: any) => p?.phone || p?.wa_id)
            .filter(Boolean)
            .join(", ");
          return phones ? `👤 ${name} — ${phones}` : `👤 ${name}`;
        })
        .join("\n");
    }
    case "interactive": {
      const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
      const title = reply?.title;
      const description = reply?.description;
      if (title) return description ? `${title}\n${description}` : String(title);
      return "[Resposta interativa sem texto]";
    }
    case "button":
      return msg.button?.text ? String(msg.button.text) : "[Resposta de botão sem texto]";
    case "order":
      return "🛒 Pedido recebido pelo catálogo do WhatsApp";
    case "system": {
      const body = typeof msg.system?.body === "string" ? msg.system.body.trim() : "";
      if (body) return `ℹ️ ${body}`;
      return `[Mensagem do tipo "system" não suportada pelo painel]`;
    }
    default: {
      const subtype = normalizeSubtypeKey(msg?.unsupported?.type);
      const directTemplate =
        (subtype && UNSUPPORTED_SUBTYPE_TEMPLATES[subtype]) ||
        (typeof type === "string" ? UNSUPPORTED_SUBTYPE_TEMPLATES[type.trim().toLowerCase()] : undefined);
      if (directTemplate) {
        return directTemplate.persistedText;
      }
      return `[Mensagem do tipo "${type ?? "desconhecido"}" não suportada pelo painel]`;
    }
  }
}
