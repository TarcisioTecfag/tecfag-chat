/**
 * Tipos de mensagem da Cloud API que carregam arquivo (baixados e salvos em mediaFiles).
 * Renderizados no chat pelo marcador `[MEDIA:<tipo>]<id>`.
 */
export const META_MEDIA_TYPES = ["image", "audio", "video", "document", "sticker"] as const;

export function isMetaMediaType(type: unknown): type is (typeof META_MEDIA_TYPES)[number] {
  return typeof type === "string" && (META_MEDIA_TYPES as readonly string[]).includes(type);
}

/** Eventos que chegam em `messages` mas não são mensagens para o operador. */
export function isIgnorableMetaMessage(msg: any): boolean {
  return msg?.type === "reaction" || msg?.type === "request_welcome";
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
    default:
      return `[Mensagem do tipo "${type ?? "desconhecido"}" não suportada pelo painel]`;
  }
}
