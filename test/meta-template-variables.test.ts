import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyVariableIndexes, isSupportedMetaTemplate, resolveMetaTemplateValues } from "../src/lib/whatsapp/meta-template-common";
import { validateMetaTemplateInput } from "../src/lib/whatsapp/meta-templates";

test("variáveis numeradas são identificadas na ordem de envio", () => {
  assert.deepEqual(bodyVariableIndexes("Olá {{2}}, aqui é {{1}}. {{2}}"), [1, 2]);
});

test("nomes vinculados vêm do servidor mesmo quando o cliente tenta substituí-los", () => {
  const result = resolveMetaTemplateValues(3, { "1": "customer_name", "2": "operator_name", "3": "manual" },
    [{ text: "Pessoa falsa" }, { text: "Operador falso" }, { text: "Pedido 123" }],
    { customerName: "Maria", operatorName: "João" });
  assert.deepEqual(result, ["Maria", "João", "Pedido 123"]);
});

test("um nome ausente bloqueia o envio", () => {
  assert.throws(() => resolveMetaTemplateValues(1, { "1": "customer_name" }, [{ text: "Pessoa falsa" }],
    { customerName: "", operatorName: "João" }), /Valor ausente/);
});

test("a criação exige exemplos para todas as variáveis e recusa marcadores incompatíveis", () => {
  const valid = { name: "retomar_atendimento", language: "pt_BR", category: "UTILITY",
    bodyText: "Olá {{1}}, aqui é {{2}}.", examples: ["Maria", "João"],
    bindings: { "1": "customer_name", "2": "operator_name" } };
  assert.equal(validateMetaTemplateInput(valid).bodyText, valid.bodyText);
  assert.throws(() => validateMetaTemplateInput({ ...valid, examples: ["Maria"] }), /exemplo/);
  assert.throws(() => validateMetaTemplateInput({ ...valid, bodyText: "Olá {{cliente}}" }), /numéricas/);
});

test("o chat valida templates aprovados compatíveis com botões, cabeçalhos e recusa variáveis nomeadas", () => {
  assert.equal(isSupportedMetaTemplate([{ type: "BODY" }], "Olá {{1}}"), true);
  assert.equal(isSupportedMetaTemplate([{ type: "BODY" }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sim" }] }], "Olá {{1}}"), true);
  assert.equal(isSupportedMetaTemplate([{ type: "HEADER", format: "IMAGE" }, { type: "BODY" }], "Olá {{1}}"), true);
  assert.equal(isSupportedMetaTemplate([{ type: "BODY" }], "Olá {{cliente}}"), false);
});
