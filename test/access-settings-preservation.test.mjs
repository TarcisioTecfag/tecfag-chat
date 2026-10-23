import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadAccessSource } from "./helpers/access-harness.mjs";
import { captureAccessSnapshot } from "../scripts/access-control-snapshot.mjs";

const { mergeGroupPermissions, resolvePermissionAliases } = loadAccessSource("src/lib/access-control/group-settings.ts");
const { validatePermissionPatch } = loadAccessSource("src/lib/access-control/group-validation.ts");
const { groupRevision } = loadAccessSource("src/lib/access-control/group-revision.ts");
const { normalizeGroupPermissions, DEFAULT_DENY_PERMISSIONS, ROLE_PRESETS } = loadAccessSource("src/lib/rbac.ts");
const { strictAccessEnabled } = loadAccessSource("src/lib/access-control/rollout.ts");

describe("preservação de configurações de acesso", () => {
  it("ativação estrita exige lista explícita de tenants; não aceita wildcard ou prefixo", () => {
    assert.equal(strictAccessEnabled("tenant-a", ""), false);
    assert.equal(strictAccessEnabled("tenant-a", "*"), false);
    assert.equal(strictAccessEnabled("tenant-a", "tenant-ab"), false);
    assert.equal(strictAccessEnabled("tenant-a", "tenant-b, tenant-a"), true);
  });
  it("edita uma permissão sem remover campos legados/desconhecidos", () => {
    const before = { chat: { canCaptureChat: true, legacyFlag: false }, futureCategory: { field: [1, 2] } };
    const copy = structuredClone(before);
    const after = mergeGroupPermissions(before, { chat: { canCaptureChat: false } });
    assert.deepEqual(before, copy);
    assert.deepEqual(after, { ...before, chat: { canCaptureChat: false, legacyFlag: false } });
  });
  it("preserva campo desconhecido inalterado, mas recusa concessão desconhecida nova", () => {
    const existing = { chat: { canCaptureChat: true, future: false }, external: { value: true } };
    assert.equal(validatePermissionPatch(existing, existing), null);
    assert.match(validatePermissionPatch({ chat: { future: true } }, existing), /desconhecida/);
    assert.match(validatePermissionPatch({ external: { value: false } }, existing), /inválida/);
  });
  it("negativas explícitas vencem aliases e não são substituídas por default", () => {
    const raw = { views: { wallet: false, wallets: true }, settings: { canAccessWhatsappSettings: false } };
    const resolved = resolvePermissionAliases(raw);
    assert.equal(resolved.views.wallet, false);
    assert.equal(resolved.settings.canManageWhatsapp, false);
    assert.equal(raw.settings.canManageWhatsapp, undefined);
  });
  it("normalizar grupo existente preserva cada valor canônico explicitamente configurado", () => {
    for (const [name, preset] of Object.entries(ROLE_PRESETS)) {
      const expected = structuredClone(preset.permissions);
      const actual = normalizeGroupPermissions({ id: `fixture-${name}`, name, permissions: expected });
      for (const [category, values] of Object.entries(expected)) {
        for (const [key, value] of Object.entries(values)) assert.equal(actual[category][key], value, `${name}.${category}.${key}`);
      }
    }
  });
  it("grupo ausente nega direitos e não modifica o conjunto de negação compartilhado", () => {
    const result = normalizeGroupPermissions(null);
    assert.equal(result.security.canManageUsers, false);
    result.views.chat = true;
    assert.equal(DEFAULT_DENY_PERMISSIONS.views.chat, false);
  });
  it("revisão permanece estável após serialização e muda se qualquer configuração mudar", () => {
    const group = { id: "g", tenantId: "tenant-a", permissions: { views: { chat: false } }, createdAt: new Date("2026-01-01") };
    assert.equal(groupRevision(group), groupRevision(JSON.parse(JSON.stringify(group))));
    assert.notEqual(groupRevision(group), groupRevision({ ...group, permissions: { views: { chat: true } } }));
  });
  it("rejeita tipos indevidos, escopo inválido e chaves de protótipo", () => {
    for (const patch of [null, [], { chat: { canCaptureChat: "false" } }, { contacts: { contactScope: "anything" } }, JSON.parse('{"__proto__":{"polluted":true}}')]) {
      assert.ok(validatePermissionPatch(patch));
    }
  });
  it("backup usa transação somente leitura, filtra cada consulta e exclui credenciais", async () => {
    const queries = [];
    const sql = { begin: async (options, fn) => {
      assert.match(options, /read only/);
      return fn(async (parts, ...values) => {
        const query = parts.join("?"); queries.push(query);
        if (query.includes("information_schema")) return [{ column_name: "permissions" }];
        assert.deepEqual(values, ["tenant-fixture"]);
        assert.match(query, /WHERE tenant_id =/);
        assert.doesNotMatch(query, /password_hash|token_hash|\bemail\b|\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
        if (query.includes("access_groups")) return [{ id: "g", permissions: { chat: { canCaptureChat: false } } }];
        if (query.includes("FROM operators")) return [{ id: "op", groupId: "g" }];
        return [];
      });
    } };
    const snapshot = await captureAccessSnapshot(sql, "tenant-fixture");
    assert.equal(queries.length, 4);
    assert.equal(snapshot.groups[0].permissions.chat.canCaptureChat, false);
    assert.deepEqual(snapshot.review.orphanOperatorIds, []);
    assert.match(snapshot.sha256, /^[a-f0-9]{64}$/);
  });
});
