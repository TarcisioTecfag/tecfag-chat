import assert from "node:assert/strict";
import test from "node:test";
import { resolveMetaSenderIdentity } from "../src/lib/whatsapp/meta-identity";

test("identifica mensagem sem telefone pelo BSUID e username", () => {
  const identity = resolveMetaSenderIdentity(
    { from_user_id: "BR.123ABC" },
    [{ user_id: "BR.123ABC", profile: { name: "Maria", username: "@maria.silva" } }],
  );
  assert.deepEqual(identity, {
    fromPhone: "",
    fromUserId: "BR.123ABC",
    whatsappUsername: "maria.silva",
    senderName: "Maria",
  });
});

test("associa pelo identificador e não pela posição de contacts", () => {
  const identity = resolveMetaSenderIdentity(
    { from: "5511999999999", from_user_id: "BR.2" },
    [
      { wa_id: "5521888888888", user_id: "BR.1", profile: { username: "outro" } },
      { wa_id: "5511999999999", user_id: "BR.2", profile: { username: "correto" } },
    ],
  );
  assert.equal(identity.fromUserId, "BR.2");
  assert.equal(identity.whatsappUsername, "correto");
});

test("rejeita identificadores conflitantes", () => {
  assert.throws(() => resolveMetaSenderIdentity(
    { from_user_id: "BR.2" },
    [{ user_id: "BR.1", profile: { username: "errado" } }],
  ));
});

test("mantém compatibilidade com webhook antigo baseado em telefone", () => {
  const identity = resolveMetaSenderIdentity(
    { from: "5511999999999" },
    [{ wa_id: "5511999999999", profile: { name: "Maria" } }],
  );
  assert.equal(identity.fromPhone, "5511999999999");
  assert.equal(identity.fromUserId, undefined);
  assert.equal(identity.whatsappUsername, undefined);
});
