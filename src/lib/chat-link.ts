export function getChatLinkKey(
  chat: { id: string; phone?: string | null },
  conversations: Array<{ id: string; phone?: string | null }>,
): string {
  const phone = chat.phone?.replace(/\D/g, "") || "";
  if (phone.length < 8 || phone.length > 20) return chat.id;
  const duplicated = conversations.some((item) =>
    item.id !== chat.id && item.phone?.replace(/\D/g, "") === phone,
  );
  return duplicated ? chat.id : phone;
}
