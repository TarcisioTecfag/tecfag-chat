/**
 * jid-validator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo de validação de JIDs do Baileys/WhatsApp — APENAS SERVIDOR.
 *
 * Regras de identificação de entidades que NÃO são contatos individuais:
 *   • Grupos: JID termina em "@g.us"                  (ex: 120363048293028392@g.us)
 *   • Status: JID é "status@broadcast"                 (atualizações de status do WA)
 *   • Transmissões: JID termina em "@broadcast"        (listas de transmissão)
 *   • Canais: JID termina em "@newsletter"             (canais do WhatsApp)
 *
 * ⚠️  NÃO use o número de telefone extraído para detectar grupos.
 *     IDs de grupos Baileys (ex: 120363...) parecem números, mas começar com
 *     "1203" não é critério seguro — números americanos (+1 213...) também
 *     começam com "1" e são clientes legítimos.
 *
 * ⚠️  JIDs do tipo "@lid" (Multi-Device) são contatos reais pendentes de
 *     resolução de número. NÃO devem ser bloqueados.
 */

/**
 * Retorna true se o JID for de um grupo do WhatsApp.
 * Ex: "120363048293028392@g.us" → true
 */
export function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}

/**
 * Retorna true se o JID for do Status do WhatsApp (atualizações de status).
 * Ex: "status@broadcast" → true
 */
export function isStatusJid(jid: string): boolean {
  return jid === "status@broadcast" || jid.toLowerCase().startsWith("status@");
}

/**
 * Retorna true se o JID for uma lista de transmissão.
 * Ex: "broadcast@broadcast" → true, "1@broadcast" → true
 */
export function isBroadcastJid(jid: string): boolean {
  return jid.endsWith("@broadcast") && jid !== "status@broadcast";
}

/**
 * Retorna true se o JID for um canal do WhatsApp.
 * Ex: "123456789@newsletter" → true
 */
export function isNewsletterJid(jid: string): boolean {
  return jid.endsWith("@newsletter");
}

/**
 * Função principal: retorna true se o JID deve ser IGNORADO pelo sistema.
 * Use no início de handleIncomingMessage e handleContactsSync.
 *
 * @param jid  O JID completo do WhatsApp (ex: "5514981196534@s.whatsapp.net")
 * @returns    true  → ignorar (grupo, status, broadcast, canal)
 *             false → processar (contato individual, inclusive @lid ainda não resolvido)
 */
export function shouldIgnoreJid(jid: string): boolean {
  if (!jid) return true;
  return (
    isGroupJid(jid) ||
    isStatusJid(jid) ||
    isBroadcastJid(jid) ||
    isNewsletterJid(jid)
  );
}

/**
 * Retorna uma descrição legível do motivo pelo qual o JID está sendo ignorado.
 * Útil para logs de debug.
 */
export function ignoreReason(jid: string): string {
  if (isGroupJid(jid)) return "grupo (@g.us)";
  if (isStatusJid(jid)) return "status do WhatsApp";
  if (isBroadcastJid(jid)) return "lista de transmissão (@broadcast)";
  if (isNewsletterJid(jid)) return "canal (@newsletter)";
  return "desconhecido";
}
