import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildSiteToWhatsappClosingMessage,
  isCommercialSiteDestination,
  parseSiteChannelSettings,
} from "../src/lib/livechat/site-channel-policy";

describe("Política Site → WhatsApp (Zero Poluição CWR + Funil por Setor)", () => {
  it("parseSiteChannelSettings lê siteWhatsappTemplateId preservando demais chaves", () => {
    const parsed = parseSiteChannelSettings(true, {
      siteChannelEnabled: true,
      siteAllowedOrigins: ["https://www.tecfag.com.br"],
      siteWhatsappNumber: "5514999999999",
      siteWhatsappTemplateId: "  fagner_site_continuacao  ",
    });
    expect(parsed.enabled).toBe(true);
    expect(parsed.whatsappTemplateId).toBe("fagner_site_continuacao");

    const empty = parseSiteChannelSettings(true, { siteChannelEnabled: true });
    expect(empty.whatsappTemplateId).toBe("");
  });

  it("classifica corretamente destinos comerciais (FUNIL CWR) vs operacionais (funil próprio do setor)", () => {
    expect(isCommercialSiteDestination("MAQUINAS")).toBe(true);
    expect(isCommercialSiteDestination("PERSONNALITE")).toBe(true);
    expect(isCommercialSiteDestination("PECAS")).toBe(true);
    expect(isCommercialSiteDestination("REVIEW")).toBe(true);
    expect(isCommercialSiteDestination(null)).toBe(true);

    expect(isCommercialSiteDestination("POS_VENDA")).toBe(false);
    expect(isCommercialSiteDestination("3_AT")).toBe(false);
    expect(isCommercialSiteDestination("FINANCEIRO")).toBe(false);
  });

  it("gera mensagem de encerramento natural no site com primeiro nome ou fallback limpo", () => {
    expect(buildSiteToWhatsappClosingMessage("Carlos Eduardo")).toContain("Perfeito, Carlos!");
    expect(buildSiteToWhatsappClosingMessage("Visitante do site")).toStartWith("Perfeito! Já reuni");
    expect(buildSiteToWhatsappClosingMessage("5514999999999")).toStartWith("Perfeito! Já reuni");
    expect(buildSiteToWhatsappClosingMessage(null)).toContain("WhatsApp");
  });

  it("contratos de integração: zero card CWR durante o site e disparo pós-triagem antes de criar card", () => {
    const root = path.resolve(import.meta.dir, "..");
    const sdrEngine = readFileSync(path.join(root, "src/lib/valentina/sdr-engine.ts"), "utf8");
    const approvalStore = readFileSync(
      path.join(root, "src/lib/triage/industrial-approval-store.ts"),
      "utf8",
    );
    const handoffSvc = readFileSync(
      path.join(root, "src/lib/livechat/site-whatsapp-handoff.ts"),
      "utf8",
    );
    const cwrCrm = readFileSync(path.join(root, "src/lib/triage/industrial-cwr-crm.ts"), "utf8");

    // 1. sdr-engine não cria card CWR na 1ª resposta de conversa do site
    expect(sdrEngine).toContain("!isSiteConversationId(conversationId)");
    expect(sdrEngine).toContain("dispatchSiteTriageToWhatsApp");

    // 2. prepareIndustrialApproval não cria card CWR em fallback de conversa do site
    expect(approvalStore).toContain("isSiteConversationId(key.conversationId)");

    // 3. No handoff Site → WhatsApp, o template Meta é disparado ANTES da criação do card no CRM
    const sendIdx = handoffSvc.indexOf("outboundQueue.enqueueAndSend(");
    const dealIdx = handoffSvc.indexOf("await ensureSiteDealOnWhatsappHandoff(");
    expect(sendIdx).toBeGreaterThan(0);
    expect(dealIdx).toBeGreaterThan(sendIdx);

    // 4. Card criado pela ponte Site → WhatsApp carrega origem 'livechat' / 'Chat Site' e separa operacionais
    expect(cwrCrm).toContain("ensureSiteDealOnWhatsappHandoff");
    expect(cwrCrm).toContain('entryChannel: "livechat"');
    expect(cwrCrm).toContain('normalizedKey === "FINANCEIRO" || normalizedKey === "3_AT" || normalizedKey === "POS_VENDA"');

    // 5. WhatsApp herda collectedData em awaiting_approval e o site fecha como continued_to_whatsapp
    expect(handoffSvc).toContain('handoffStatus: "awaiting_approval"');
    expect(handoffSvc).toContain('handoffStatus: "continued_to_whatsapp"');
    expect(handoffSvc).toContain('notLike(conversations.id, "conv-lc-%")');
  });
});
