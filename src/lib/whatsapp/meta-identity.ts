export type MetaSenderIdentity = {
  fromPhone: string;
  fromUserId?: string;
  whatsappUsername?: string | null;
  senderName?: string;
};

const isPhone = (value: unknown): value is string => typeof value === "string" && /^\d{8,15}$/.test(value);

/** A posição de contacts[] não precisa corresponder à posição de messages[]. */
export function resolveMetaSenderIdentity(message: any, contacts: any[]): MetaSenderIdentity {
  const matched = contacts.find((candidate) =>
    (message.from_user_id && candidate?.user_id === message.from_user_id) ||
    (message.from && candidate?.wa_id === message.from)
  ) || (contacts.length === 1 ? contacts[0] : undefined);

  if (message.from_user_id && matched?.user_id && message.from_user_id !== matched.user_id) {
    throw new Error("BSUID da mensagem diverge do contato no webhook");
  }
  if (isPhone(message.from) && isPhone(matched?.wa_id) && message.from !== matched.wa_id) {
    throw new Error("Telefone da mensagem diverge do contato no webhook");
  }

  return {
    fromPhone: isPhone(message.from) ? message.from : isPhone(matched?.wa_id) ? matched.wa_id : "",
    fromUserId: message.from_user_id || matched?.user_id,
    whatsappUsername: matched?.user_id || message.from_user_id
      ? (matched ? (typeof matched.profile?.username === "string" ? matched.profile.username.replace(/^@/, "") : null) : undefined)
      : undefined,
    senderName: typeof matched?.profile?.name === "string" ? matched.profile.name : undefined,
  };
}
