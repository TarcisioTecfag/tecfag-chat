import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  analyzeMetaUnsupportedMessage,
  describeNonMediaMetaMessage,
  extractMetaUnsupportedDetails,
  isMetaUnsupportedMessage,
} from "../src/lib/whatsapp/meta-message-text";

test("extractMetaUnsupportedDetails captura subtipo e erro 131051 sem afetar tipos suportados", () => {
  assert.equal(extractMetaUnsupportedDetails({ type: "text", text: { body: "Oi" } }), null);
  assert.equal(extractMetaUnsupportedDetails({ type: "image", image: { id: "123" } }), null);
  assert.equal(extractMetaUnsupportedDetails({ type: "reaction", reaction: { emoji: "👍" } }), null);
  assert.equal(extractMetaUnsupportedDetails({ type: "request_welcome" }), null);
  assert.equal(
    extractMetaUnsupportedDetails({ type: "system", system: { body: "Cliente mudou de número" } }),
    null,
  );

  const generic = extractMetaUnsupportedDetails({
    type: "unsupported",
    errors: [
      {
        code: 131051,
        title: "Message type unknown",
        message: "Message type unknown",
        error_data: { details: "Message type is currently not supported." },
      },
    ],
  });
  assert.deepEqual(generic, {
    rawType: "unsupported",
    subtype: null,
    errorCode: 131051,
    errorTitle: "Message type unknown",
    errorDetails: "Message type is currently not supported.",
  });

  const editDetails = extractMetaUnsupportedDetails({
    type: "unsupported",
    unsupported: { type: "edit" },
    errors: [{ code: "131051", title: "Unsupported message type" }],
  });
  assert.deepEqual(editDetails, {
    rawType: "unsupported",
    subtype: "edit",
    errorCode: 131051,
    errorTitle: "Unsupported message type",
    errorDetails: null,
  });
});

test("describeNonMediaMetaMessage traduz subtipos conhecidos e preserva fallback legado", () => {
  assert.equal(
    describeNonMediaMetaMessage({ type: "unsupported" }),
    '[Mensagem do tipo "unsupported" não suportada pelo painel]',
  );
  assert.equal(
    describeNonMediaMetaMessage({ type: "unsupported", unsupported: { type: "edit" } }),
    "[Mensagem editada pelo cliente — não exibida pela API oficial do WhatsApp]",
  );
  assert.equal(
    describeNonMediaMetaMessage({ type: "unsupported", unsupported: { type: "poll_creation" } }),
    "[Enquete do WhatsApp — formato não suportado pela API oficial]",
  );
  assert.equal(
    describeNonMediaMetaMessage({ type: "unsupported", unsupported: { type: "media_placeholder" } }),
    "[Mídia indisponível ou enviada em visualização única — bloqueada pela API oficial]",
  );
  assert.equal(
    describeNonMediaMetaMessage({ type: "system", system: { body: "Número atualizado" } }),
    "ℹ️ Número atualizado",
  );
  assert.equal(describeNonMediaMetaMessage({ type: "text", text: { body: "oi" } }), null);
});

test("analyzeMetaUnsupportedMessage explica mensagens legadas e novas para o atendente", () => {
  // Caso real já salvo no banco (como Bruno 5511986900005)
  const legacy = analyzeMetaUnsupportedMessage(
    '[Mensagem do tipo "unsupported" não suportada pelo painel]',
    null,
  );
  assert.ok(legacy);
  assert.equal(legacy.rawType, "unsupported");
  assert.equal(legacy.subtype, null);
  assert.ok(legacy.possibleCauses.some((c) => /Visualização Única/i.test(c)));
  assert.ok(legacy.possibleCauses.some((c) => /editou/i.test(c)));
  assert.ok(legacy.suggestedClientReply.includes("visualização única"));
  assert.equal(isMetaUnsupportedMessage('[Mensagem do tipo "unsupported" não suportada pelo painel]'), true);

  // Caso novo enriquecido com metaDetails.metaUnsupported
  const withDetails = analyzeMetaUnsupportedMessage(
    "[Mensagem editada pelo cliente — não exibida pela API oficial do WhatsApp]",
    {
      metaUnsupported: {
        rawType: "unsupported",
        subtype: "edit",
        errorCode: 131051,
        errorDetails: "Message type is currently not supported.",
      },
    },
  );
  assert.ok(withDetails);
  assert.equal(withDetails.subtype, "edit");
  assert.equal(withDetails.errorCode, 131051);
  assert.match(withDetails.badgeLabel, /Edição · API Meta #131051/);
  assert.match(withDetails.headline, /editou uma mensagem/i);
  assert.match(withDetails.technicalSummary, /Subtipo: edit/);

  // Não dispara falso positivo em mensagens comuns
  assert.equal(analyzeMetaUnsupportedMessage("Olá, meu CNPJ é 12.345.678/0001-90"), null);
  assert.equal(analyzeMetaUnsupportedMessage("O cliente disse unsupported no chat"), null);
  assert.equal(isMetaUnsupportedMessage(""), false);
});

test("pipeline backend e UI seguem regras de isolamento, resiliência e Design System", () => {
  const inboundCode = readFileSync(resolve("src/lib/whatsapp/inbound.ts"), "utf-8");
  const recoveryCode = readFileSync(resolve("src/lib/whatsapp/durable-recovery.ts"), "utf-8");
  const presenceCode = readFileSync(resolve("src/lib/whatsapp/meta-presence.ts"), "utf-8");
  const cardCode = readFileSync(resolve("src/components/chat/MetaUnsupportedNoticeCard.tsx"), "utf-8");

  assert.ok(inboundCode.includes("extractMetaUnsupportedDetails(rawPayload)"));
  assert.ok(inboundCode.includes("messageMetaDetails.metaUnsupported = metaUnsupported"));
  assert.ok(recoveryCode.includes("describeNonMediaMetaMessage(raw)"));
  assert.ok(presenceCode.includes("isMetaUnsupportedMessage(row.content"));

  // Design System: sem title= nativo, sem <select>, sem <input type="date">
  assert.ok(cardCode.includes("SystemTooltip"));
  assert.equal(/\btitle\s*=/.test(cardCode), false);
  assert.equal(/<select\b/i.test(cardCode), false);
  assert.equal(/type\s*=\s*["']date["']/i.test(cardCode), false);
  assert.ok(cardCode.includes("Aviso interno · só você vê"));
  assert.ok(cardCode.includes("O que pode ter sido"));
  assert.ok(cardCode.includes("Como avisar o cliente"));
  assert.ok(cardCode.includes("Preencher resposta"));
  assert.ok(cardCode.includes("Copiar aviso"));
});
