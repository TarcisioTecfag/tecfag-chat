import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildSiteToWhatsappClosingMessage,
  isCommercialSiteDestination,
  parseSiteChannelSettings,
} from "../src/lib/livechat/site-channel-policy";
import {
  MCP_TOOLS,
  formatMcpToolLabel,
  summarizeMcpToolResult,
} from "../src/lib/mcp/valem-tecfag-mcp-core";
import {
  MCP_SITE_CHANNEL_TOOLS,
  executeSiteChannelMcpTool,
  isSiteChannelMcpTool,
} from "../src/lib/mcp/valem-tecfag-mcp-site-channel-tools";
import { getApiLibraryCatalog } from "../src/lib/marketing/api-library-catalog";

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

  it("expõe get_site_channel_config (read) e update_site_channel_config (write) no MCP, catálogo e bloqueia tenant não-industrial", async () => {
    expect(isSiteChannelMcpTool("get_site_channel_config")).toBe(true);
    expect(isSiteChannelMcpTool("update_site_channel_config")).toBe(true);
    expect(isSiteChannelMcpTool("other_tool")).toBe(false);

    const getDef = MCP_SITE_CHANNEL_TOOLS.find((t) => t.name === "get_site_channel_config");
    const updDef = MCP_SITE_CHANNEL_TOOLS.find((t) => t.name === "update_site_channel_config");
    expect(getDef?.access).toBe("read");
    expect(updDef?.access).toBe("write");

    // Registradas em MCP_TOOLS do servidor /api/mcp
    const toolNames = new Set(MCP_TOOLS.map((t) => t.name));
    expect(toolNames.has("get_site_channel_config")).toBe(true);
    expect(toolNames.has("update_site_channel_config")).toBe(true);

    // Labels em PT e resumos de auditoria
    expect(formatMcpToolLabel("get_site_channel_config")).toContain("Canal Site");
    expect(formatMcpToolLabel("update_site_channel_config")).toContain("Canal Site");
    expect(
      summarizeMcpToolResult("update_site_channel_config", {
        siteChannelEnabled: true,
        siteWhatsappTemplateId: "1157917813601928",
        activeTemplate: { name: "fagner_site_continuacao_v1" },
      }),
    ).toContain("fagner_site_continuacao_v1");

    // Documentadas na Biblioteca de API
    const catalog = getApiLibraryCatalog("tecfag");
    expect(catalog.some((e) => e.mcpToolName === "get_site_channel_config")).toBe(true);
    expect(catalog.some((e) => e.mcpToolName === "update_site_channel_config")).toBe(true);

    // Bloqueio estrito no perfil não-industrial (valem)
    await expect(
      executeSiteChannelMcpTool("get_site_channel_config", {}, "valem"),
    ).rejects.toThrow("indisponível para o tenant 'valem'");
    await expect(
      executeSiteChannelMcpTool(
        "update_site_channel_config",
        { siteWhatsappTemplateId: "1157917813601928" },
        "valem",
      ),
    ).rejects.toThrow("indisponível para o tenant 'valem'");
  });
});
