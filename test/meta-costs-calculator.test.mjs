import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_META_TARIFF_SCHEDULE,
  evaluateMetaOutboundMessage,
  extractTemplateNameFromMessage,
  hasActive24hCustomerWindow,
} from "../src/lib/whatsapp/meta-costs-calculator.ts";

test("extractTemplateNameFromMessage extrai nome do template via metaDetails ou tag textual", () => {
  assert.equal(
    extractTemplateNameFromMessage("Olá!", { templateName: "boas_vindas_tecfag" }),
    "boas_vindas_tecfag",
  );
  assert.equal(
    extractTemplateNameFromMessage("[Template Meta: promo_outubro] Confira nossa oferta"),
    "promo_outubro",
  );
  assert.equal(extractTemplateNameFromMessage("Mensagem comum de atendimento"), null);
});

test("hasActive24hCustomerWindow identifica corretamente janela de 24h aberta pelo cliente", () => {
  const baseMs = Date.parse("2026-10-27T12:00:00Z");
  const inboundWithin24h = [baseMs - 2 * 60 * 60 * 1000]; // 2h antes
  const inboundExpired = [baseMs - 26 * 60 * 60 * 1000]; // 26h antes

  assert.equal(hasActive24hCustomerWindow(baseMs, inboundWithin24h), true);
  assert.equal(hasActive24hCustomerWindow(baseMs, inboundExpired), false);
  assert.equal(hasActive24hCustomerWindow(baseMs, []), false);
});

test("evaluateMetaOutboundMessage tarifa template MARKETING e isenta SERVICE na janela de 24h", () => {
  const templateMap = new Map([
    ["campanha_summit", "MARKETING"],
    ["aviso_pedido", "UTILITY"],
    ["codigo_otp", "AUTHENTICATION"],
  ]);
  const baseMs = Date.parse("2026-10-27T12:00:00Z");
  const inboundMap = new Map([["conv-1", [baseMs - 30 * 60 * 1000]]]);

  // 1. Template MARKETING é sempre tarifado ($0.0625 USD)
  const mkt = evaluateMetaOutboundMessage({
    msg: {
      id: "m1",
      conversationId: "conv-1",
      contactName: "Cliente A",
      contactPhone: "5511999999999",
      senderType: "agent",
      senderName: "Operador",
      content: "[Template Meta: campanha_summit] Convite especial",
      status: "delivered",
      metaDetails: { templateName: "campanha_summit" },
      sentAt: new Date(baseMs),
    },
    templateCategoryMap: templateMap,
    inboundTimestampsByConv: inboundMap,
    withinMonthlyFreeAllowance: true,
  });

  assert.equal(mkt.category, "MARKETING");
  assert.equal(mkt.billable, true);
  assert.equal(mkt.costUsd, DEFAULT_META_TARIFF_SCHEDULE.ratesUsd.MARKETING);
  assert.equal(mkt.costBrl, Number((0.0625 * 5.6).toFixed(6)));

  // 2. Template UTILITY enviado DENTRO da janela 24h aberta pelo cliente é GRÁTIS
  const utilInWindow = evaluateMetaOutboundMessage({
    msg: {
      id: "m2",
      conversationId: "conv-1",
      contactName: "Cliente A",
      contactPhone: "5511999999999",
      senderType: "agent",
      senderName: "Operador",
      content: "[Template Meta: aviso_pedido] Seu pedido saiu",
      status: "read",
      metaDetails: { templateName: "aviso_pedido" },
      sentAt: new Date(baseMs),
    },
    templateCategoryMap: templateMap,
    inboundTimestampsByConv: inboundMap,
    withinMonthlyFreeAllowance: true,
  });

  assert.equal(utilInWindow.category, "UTILITY");
  assert.equal(utilInWindow.billable, false);
  assert.equal(utilInWindow.costUsd, 0);
  assert.equal(utilInWindow.savedUsd, DEFAULT_META_TARIFF_SCHEDULE.ratesUsd.UTILITY);

  // 3. Template UTILITY enviado FORA da janela de 24h é TARIFADO ($0.0068 USD)
  const utilOutWindow = evaluateMetaOutboundMessage({
    msg: {
      id: "m3",
      conversationId: "conv-sem-janela",
      contactName: "Cliente B",
      contactPhone: "5511888888888",
      senderType: "agent",
      senderName: "Operador",
      content: "[Template Meta: aviso_pedido] Seu pedido saiu",
      status: "delivered",
      metaDetails: { templateName: "aviso_pedido" },
      sentAt: new Date(baseMs),
    },
    templateCategoryMap: templateMap,
    inboundTimestampsByConv: inboundMap,
    withinMonthlyFreeAllowance: true,
  });

  assert.equal(utilOutWindow.category, "UTILITY");
  assert.equal(utilOutWindow.billable, true);
  assert.equal(utilOutWindow.costUsd, DEFAULT_META_TARIFF_SCHEDULE.ratesUsd.UTILITY);

  // 4. Mensagem livre de atendimento (SERVICE) do operador ou bot SDR é GRÁTIS e contabiliza economia
  const serviceMsg = evaluateMetaOutboundMessage({
    msg: {
      id: "m4",
      conversationId: "conv-1",
      contactName: "Cliente A",
      contactPhone: "5511999999999",
      senderType: "bot",
      senderName: "Fagner SDR",
      content: "Perfeito! Qual é a produção por hora desejada?",
      status: "delivered",
      sentAt: new Date(baseMs),
    },
    templateCategoryMap: templateMap,
    inboundTimestampsByConv: inboundMap,
    withinMonthlyFreeAllowance: true,
  });

  assert.equal(serviceMsg.category, "SERVICE");
  assert.equal(serviceMsg.billable, false);
  assert.equal(serviceMsg.costUsd, 0);
  assert.equal(serviceMsg.originLabel, "Bot IA (SDR)");
  assert.ok(serviceMsg.savedBrl > 0);

  // 5. Mensagem com falha no envio nunca é cobrada
  const failedMsg = evaluateMetaOutboundMessage({
    msg: {
      id: "m5",
      conversationId: "conv-1",
      contactName: "Cliente A",
      contactPhone: "5511999999999",
      senderType: "agent",
      senderName: "Operador",
      content: "[Template Meta: campanha_summit] Convite",
      status: "failed",
      metaDetails: { templateName: "campanha_summit" },
      sentAt: new Date(baseMs),
    },
    templateCategoryMap: templateMap,
    inboundTimestampsByConv: inboundMap,
    withinMonthlyFreeAllowance: true,
  });

  assert.equal(failedMsg.billable, false);
  assert.equal(failedMsg.costUsd, 0);
  assert.equal(failedMsg.billingRule, "not_billed_failed");
});
