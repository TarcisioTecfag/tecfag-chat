import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { formatSystemAnnotation } from "../src/lib/triage/format-system-annotation";
import {
  computeChannelBoundaryMarkers,
  isSiteOriginMessage,
} from "../src/lib/chat/message-channel-origin";
import { buildSiteToWhatsappClosingMessage } from "../src/lib/livechat/site-channel-policy";
import {
  computeSiteHandoffMirrorTimestamps,
  summarizeSiteTriageNote,
} from "../src/lib/livechat/site-whatsapp-handoff";

const root = path.resolve(import.meta.dir, "..");

describe("Melhorias UX Ponte Site → WhatsApp (Relatório, Divisória e Despedida no Histórico)", () => {
  it("Item 1: limpa Markdown quebrado (**, *, `, -, •) de notas legadas do Site e padroniza campos sem duplicidade", () => {
    const legacyNoteFromProduction = [
      "🌐 **Triagem concluída no Site e transferida para o WhatsApp**",
      "• **Template enviado:** `fagner_site_continuacao_v1`",
      "• **Fluxo/Destino:** Máquinas",
      "",
      "**Dados coletados no site:**",
      "- **EMAIL:** silvatarcisio2201@gmail.com",
      "- **EMPRESA:** ANNA KARLA BERNARDES LTDA",
      "- **TELEFONE:** 5514998364338",
      "- **CNPJ OU CPF:** 51.770.747/0001-60",
      "- **NOME COMPLETO:** Tarcisio Pereira Do Nascimento",
      "- **SETOR / FUNIL DE DESTINO:** Análise e revisão humana",
      "- **MÁQUINA / PEÇA / INTERESSE:** Seladora automática",
      "- **RAMO / O QUE EMBALA:** Pacotes de salgadinho",
      "- **VOLUME / PRODUÇÃO:** 300 pacotes por minuto",
    ].join("\n");

    const parsed = formatSystemAnnotation(legacyNoteFromProduction);

    expect(parsed.isSingleLine).toBe(false);
    expect(parsed.badgeTitle).toBe("Triagem do Site → WhatsApp");
    expect(parsed.variant).toBe("site_handoff");

    // Nenhum asterisco, crase ou bullet sobrando em labels ou valores
    for (const item of parsed.items) {
      expect(item.label).not.toMatch(/[\*`•]/);
      expect(item.value).not.toMatch(/[\*`]/);
      expect(item.label.toLowerCase()).not.toContain("dados coletados");
    }

    const byLabel = new Map(parsed.items.map((it) => [it.label, it]));
    // Fluxo/Destino ("Máquinas") tem prioridade sobre SETOR/FUNIL legado
    expect(byLabel.get("Destino")?.value).toBe("Máquinas");
    expect(byLabel.get("Cliente")?.value).toBe("Tarcisio Pereira Do Nascimento");
    expect(byLabel.get("CPF / CNPJ")?.value).toBe("51.770.747/0001-60");
    expect(byLabel.get("E-mail")?.value).toBe("silvatarcisio2201@gmail.com");
    expect(byLabel.get("Telefone")?.value).toBe("(14) 99836-4338");
    expect(byLabel.get("Empresa")?.value).toBe("ANNA KARLA BERNARDES LTDA");
    expect(byLabel.get("Interesse")?.value).toBe("Seladora automática");
    expect(byLabel.get("Aplicação")?.value).toBe("Pacotes de salgadinho");
    expect(byLabel.get("Produção")?.value).toBe("300 pacotes por minuto");
    expect(byLabel.get("Template")?.value).toBe("fagner_site_continuacao_v1");
    expect(byLabel.get("Template")?.isCode).toBe(true);
    expect(byLabel.get("Template")?.fullWidth).toBe(true);
  });

  it("Item 1: summarizeSiteTriageNote emite texto limpo e reflete quando o template não foi enviado por humano ativo", () => {
    const baseInput = {
      tenantId: "tecfag",
      siteConversationId: "conv-lc-test",
      siteFlowId: "fs-1",
      cycle: "2026-11-25T18:26:00.000Z",
      route: {
        subflow: "MAQUINAS",
        funnelStage: "comercial",
        targetFunnel: "Máquinas",
        needsReview: false,
        reason: "catalog_match",
      } as any,
      data: {
        "NOME COMPLETO": { value: "Tarcisio Pereira", status: "filled" as const },
        TELEFONE: { value: "5514998364338", status: "filled" as const },
        "MÁQUINA / PEÇA / INTERESSE": { value: "Seladora automática", status: "filled" as const },
      },
      clientName: "Tarcisio Pereira",
      companyName: "ANNA KARLA BERNARDES LTDA",
      contactId: "cont-1",
    };

    const sentNote = summarizeSiteTriageNote(baseInput, "fagner_site_continuacao_v1", true);
    expect(sentNote).not.toContain("**");
    expect(sentNote).not.toContain("`");
    const parsedSent = formatSystemAnnotation(sentNote);
    expect(parsedSent.variant).toBe("site_handoff");
    expect(parsedSent.items.find((i) => i.label === "Template")?.value).toBe(
      "fagner_site_continuacao_v1",
    );

    const humanActiveNote = summarizeSiteTriageNote(baseInput, "fagner_site_continuacao_v1", false);
    expect(humanActiveNote).not.toContain("fagner_site_continuacao_v1");
    expect(humanActiveNote).toContain("atendimento humano já ativo no WhatsApp");
    const parsedHuman = formatSystemAnnotation(humanActiveNote);
    expect(parsedHuman.items.find((i) => i.label === "Template")?.isCode).toBeUndefined();
  });

  it("Item 2: identifica mensagens do Site e calcula divisórias Site → WhatsApp com e sem showSystemInfo", () => {
    expect(isSiteOriginMessage({ id: "lcx-123", provider: "meta" })).toBe(true);
    expect(isSiteOriginMessage({ id: "msg-1", provider: "livechat" })).toBe(true);
    expect(
      isSiteOriginMessage({
        id: "msg-2",
        provider: "internal",
        metaDetails: { copiedFrom: { channel: "livechat" } },
      }),
    ).toBe(true);
    expect(isSiteOriginMessage({ id: "msg-3", provider: "meta" })).toBe(false);
    expect(
      isSiteOriginMessage({ id: "note-swa-1", senderType: "system", isInternalNote: true }),
    ).toBe(false);

    const withSystem = [
      { id: "wa-old", provider: "meta", senderType: "client" },
      { id: "lcx-1", provider: "livechat", senderType: "client" },
      { id: "lcx-close-1", provider: "livechat", senderType: "bot" },
      { id: "note-swa-1", provider: "internal", senderType: "system", isInternalNote: true },
      { id: "wa-template", provider: "meta", senderType: "bot" },
      { id: "wa-op", provider: "meta", senderType: "agent" },
    ];

    const markersWithSys = computeChannelBoundaryMarkers(withSystem, {
      id: "conv-wa-1",
      channel: "whatsapp",
    });
    expect(markersWithSys[0]).toEqual({
      isSiteOriginInWhatsapp: false,
      beforeDivider: null,
      afterDivider: null,
    });
    expect(markersWithSys[1]).toEqual({
      isSiteOriginInWhatsapp: true,
      beforeDivider: "site_start",
      afterDivider: null,
    });
    expect(markersWithSys[2]).toEqual({
      isSiteOriginInWhatsapp: true,
      beforeDivider: null,
      afterDivider: null,
    });
    expect(markersWithSys[3]).toEqual({
      isSiteOriginInWhatsapp: false,
      beforeDivider: null,
      afterDivider: null,
    });
    expect(markersWithSys[4]).toEqual({
      isSiteOriginInWhatsapp: false,
      beforeDivider: "whatsapp_start",
      afterDivider: null,
    });
    expect(markersWithSys[5].beforeDivider).toBeNull();

    // Mesmo com showSystemInfo desligado (note-swa filtrada fora), a divisória aparece exatamente na transição
    const withoutSystem = withSystem.filter((m) => m.senderType !== "system");
    const markersNoSys = computeChannelBoundaryMarkers(withoutSystem, {
      id: "conv-wa-1",
      channel: "whatsapp",
    });
    expect(markersNoSys[1].beforeDivider).toBe("site_start");
    expect(markersNoSys[3].beforeDivider).toBe("whatsapp_start");

    // Quando a conversa ainda termina no bloco do Site (sem mensagem de WhatsApp depois), marca o fim da triagem
    const siteAtEnd = [
      { id: "lcx-1", provider: "livechat", senderType: "client" },
      { id: "lcx-close-1", provider: "livechat", senderType: "bot" },
      { id: "note-swa-1", provider: "internal", senderType: "system", isInternalNote: true },
    ];
    const endMarkers = computeChannelBoundaryMarkers(siteAtEnd, {
      id: "conv-wa-1",
      channel: "whatsapp",
    });
    expect(endMarkers[0].beforeDivider).toBe("site_start");
    expect(endMarkers[2].afterDivider).toBe("site_end_pending_whatsapp");

    // Conversa nativa do site (conv-lc-*) ou chat interno valentina nunca gera divisórias Site→WhatsApp
    const pureSiteMarkers = computeChannelBoundaryMarkers(siteAtEnd, {
      id: "conv-lc-abc",
      channel: "livechat",
    });
    expect(pureSiteMarkers.every((m) => !m.isSiteOriginInWhatsapp && !m.beforeDivider && !m.afterDivider)).toBe(true);
  });

  it("Item 3: despedida deixa explícito que o próprio assistente chama no WhatsApp e espelha antes da nota e do template", () => {
    const defaultMsg = buildSiteToWhatsappClosingMessage("Tarcisio Pereira");
    expect(defaultMsg).toStartWith("Perfeito, Tarcisio! Já reuni");
    expect(defaultMsg).toContain("eu mesmo");
    expect(defaultMsg).toContain("WhatsApp");

    const activeHumanMsg = buildSiteToWhatsappClosingMessage("Tarcisio Pereira", {
      hasActiveHuman: true,
    });
    expect(activeHumanMsg).toStartWith("Perfeito, Tarcisio! Já reuni");
    expect(activeHumanMsg).toContain("já está aberto no WhatsApp");
    expect(activeHumanMsg).not.toContain("acabei de te chamar");

    // Ordem cronológica estrita com template enviado: site < despedida < relatório < template Meta
    const lastSiteMsgMs = Date.parse("2026-11-25T18:25:16.222Z");
    const templateSentAtMs = Date.parse("2026-11-25T18:26:28.000Z");
    const nowMs = Date.parse("2026-11-25T18:26:29.500Z");
    const ordered = computeSiteHandoffMirrorTimestamps({
      lastSiteMsgMs,
      templateSentAtMs,
      nowMs,
    });
    expect(ordered.closingSentAt.getTime()).toBeGreaterThan(lastSiteMsgMs);
    expect(ordered.summaryNoteSentAt.getTime()).toBeGreaterThan(ordered.closingSentAt.getTime());
    expect(ordered.summaryNoteSentAt.getTime()).toBeLessThan(templateSentAtMs);

    // Sem template (humano ativo): site < despedida < relatório
    const orderedNoTemplate = computeSiteHandoffMirrorTimestamps({
      lastSiteMsgMs,
      templateSentAtMs: null,
      nowMs,
    });
    expect(orderedNoTemplate.closingSentAt.getTime()).toBeGreaterThan(lastSiteMsgMs);
    expect(orderedNoTemplate.summaryNoteSentAt.getTime()).toBeGreaterThan(
      orderedNoTemplate.closingSentAt.getTime(),
    );

    // Contrato de espelhamento da despedida na ponte Site → WhatsApp + conformidade Design System
    const handoffSrc = readFileSync(
      path.join(root, "src/lib/livechat/site-whatsapp-handoff.ts"),
      "utf8",
    );
    expect(handoffSrc).toContain("lcx-close-");
    expect(handoffSrc).toContain("siteClosingMessage: true");
    expect(handoffSrc).toContain("sentAt: closingSentAt");
    expect(handoffSrc).toContain("sentAt: summaryNoteSentAt");

    const indicatorSrc = readFileSync(
      path.join(root, "src/components/chat/ChannelOriginIndicators.tsx"),
      "utf8",
    );
    expect(indicatorSrc).toContain("SystemTooltip");
    expect(indicatorSrc).not.toMatch(/\btitle=/);
    expect(indicatorSrc).not.toMatch(/\b(?:sky|emerald)-/);

    const annotationBubbleSrc = readFileSync(
      path.join(root, "src/components/chat/SystemAnnotationBubble.tsx"),
      "utf8",
    );
    expect(annotationBubbleSrc).toContain("SystemTooltip");
    expect(annotationBubbleSrc).not.toMatch(/\btitle=/);
    expect(annotationBubbleSrc).not.toMatch(/\b(?:sky|emerald)-/);
  });
});
