#!/usr/bin/env node
/**
 * Testes de requisição manual para validação da Entrega 1.
 * Executar com: node test-requests.mjs
 *
 * Pré-requisito: servidor rodando em http://localhost:3000
 * Ajustar BASE_URL e VALID_SESSION_COOKIE conforme necessário.
 */

const BASE_URL = "http://localhost:3000";
// Cookie de sessão de um operador admin (obter após login)
const ADMIN_COOKIE = "session_token=SEU_TOKEN_ADMIN_AQUI";
// Cookie de sessão de um operador comum (não admin)
const OPERATOR_COOKIE = "session_token=SEU_TOKEN_OPERADOR_AQUI";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function req(method, path, opts = {}) {
  const { cookie, body } = opts;
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

async function run() {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  TESTES DE REQUISIÇÃO — Entrega 1 — Valem Chat");
  console.log("═══════════════════════════════════════════════════\n");

  // ── 1. /api/contacts ─────────────────────────────────────────────
  console.log("1. POST /api/contacts — sem sessão");
  {
    const r = await req("POST", "/api/contacts", {
      body: { name: "Teste Invasor", tenantId: "valem" },
    });
    assert("deve retornar 401", r.status === 401, `status=${r.status}`);
  }

  console.log("\n2. POST /api/contacts — com sessão válida");
  {
    const r = await req("POST", "/api/contacts", {
      cookie: ADMIN_COOKIE,
      body: { name: "Contato Teste Entrega1", phone: "5511999990000" },
    });
    assert("deve retornar 201", r.status === 201, `status=${r.status} body=${JSON.stringify(r.json)}`);
    assert("contactId presente", r.json?.contactId !== undefined);
  }

  // ── 2. /api/whatsapp/send — permissão de envio ───────────────────
  console.log("\n3. POST /api/whatsapp/send — sem sessão");
  {
    const r = await req("POST", "/api/whatsapp/send", {
      body: { conversationId: "conv-fake", text: "Invasor" },
    });
    assert("deve retornar 401", r.status === 401, `status=${r.status}`);
  }

  console.log("\n4. POST /api/whatsapp/send — conversa de outro operador (common operator)");
  {
    const r = await req("POST", "/api/whatsapp/send", {
      cookie: OPERATOR_COOKIE,
      body: { conversationId: "conv-de-outro-operador", text: "Teste" },
    });
    assert("deve retornar 403 ou 404", r.status === 403 || r.status === 404, `status=${r.status}`);
  }

  // ── 3. /api/operators — sem sessão ──────────────────────────────
  console.log("\n5. GET /api/operators — sem sessão");
  {
    const r = await req("GET", "/api/operators");
    assert("deve retornar 401", r.status === 401, `status=${r.status}`);
  }

  console.log("\n6. GET /api/operators — com sessão admin");
  {
    const r = await req("GET", "/api/operators", { cookie: ADMIN_COOKIE });
    assert("deve retornar 200", r.status === 200, `status=${r.status}`);
    assert("lista é array", Array.isArray(r.json), `body=${JSON.stringify(r.json)}`);
    if (Array.isArray(r.json) && r.json.length > 0) {
      assert("nenhum item tem passwordHash", r.json.every(op => op.passwordHash === undefined),
        "passwordHash encontrado: " + JSON.stringify(r.json.find(op => op.passwordHash)));
    }
  }

  console.log("\n7. POST /api/operators — operador comum tenta criar operador");
  {
    const r = await req("POST", "/api/operators", {
      cookie: OPERATOR_COOKIE,
      body: { id: "op-hack", name: "Invasor", email: "hack@test.com", password: "123" },
    });
    assert("deve retornar 403", r.status === 403, `status=${r.status}`);
  }

  // ── 4. /api/operators/profile — perfil próprio ──────────────────
  console.log("\n8. PATCH /api/operators/profile — sem sessão");
  {
    const r = await req("PATCH", "/api/operators/profile", {
      body: { name: "Invasor" },
    });
    assert("deve retornar 401", r.status === 401, `status=${r.status}`);
  }

  console.log("\n9. PATCH /api/operators/profile — operador comum atualiza nome");
  {
    const r = await req("PATCH", "/api/operators/profile", {
      cookie: OPERATOR_COOKIE,
      body: { name: "Nome Atualizado via Profile" },
    });
    assert("deve retornar 200", r.status === 200, `status=${r.status} body=${JSON.stringify(r.json)}`);
    assert("sem passwordHash na resposta", r.json?.passwordHash === undefined);
  }

  console.log("\n10. PATCH /api/operators/profile — tenta mudar role (deve ser ignorado)");
  {
    const r = await req("PATCH", "/api/operators/profile", {
      cookie: OPERATOR_COOKIE,
      body: { role: "admin" },
    });
    // O campo role é ignorado, mas a requisição falha por "nenhum campo de perfil fornecido"
    assert("deve retornar 400", r.status === 400, `status=${r.status}`);
  }

  // ── 5. /api/chats/tag-task — isolamento de tenant ────────────────
  console.log("\n11. POST /api/chats/tag-task — sem sessão");
  {
    const r = await req("POST", "/api/chats/tag-task", {
      body: { conversationId: "conv-fake", tagName: "teste", tenantId: "valem" },
    });
    assert("deve retornar 401", r.status === 401, `status=${r.status}`);
  }

  console.log("\n12. POST /api/chats/tag-task — conversa de outro tenant");
  {
    const r = await req("POST", "/api/chats/tag-task", {
      cookie: ADMIN_COOKIE,
      body: { conversationId: "conv-do-outro-tenant", tagName: "teste" },
    });
    assert("deve retornar 404", r.status === 404, `status=${r.status}`);
  }

  // ── 6. /api/gestao/overview — painel de gestão ──────────────────
  console.log("\n13. GET /api/gestao/overview — sem sessão");
  {
    const r = await req("GET", "/api/gestao/overview?tenantId=valem");
    assert("deve retornar 401", r.status === 401, `status=${r.status}`);
  }

  console.log("\n14. GET /api/gestao/overview — operador comum (não supervisor)");
  {
    const r = await req("GET", "/api/gestao/overview", { cookie: OPERATOR_COOKIE });
    assert("deve retornar 403", r.status === 403, `status=${r.status}`);
  }

  // ── 7. Webhook Meta — sem header de assinatura ──────────────────
  console.log("\n15. POST /api/webhooks/meta — sem x-hub-signature-256");
  {
    const r = await req("POST", "/api/webhooks/meta", {
      body: { entry: [{ changes: [{ value: { messages: [] } }] }] },
    });
    assert("deve retornar 401", r.status === 401, `status=${r.status}`);
  }

  console.log("\n16. POST /api/webhooks/meta — payload sem phone_number_id");
  {
    const res = await fetch(`${BASE_URL}/api/webhooks/meta`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": "sha256=invalido",
      },
      body: JSON.stringify({ entry: [{ changes: [{ value: { messages: [] } }] }] }),
    });
    const json = await res.json().catch(() => null);
    assert("deve retornar 400 (não 200 skipped)", res.status === 400, `status=${res.status}`);
  }

  // ── Resultado ────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log(`  RESULTADO: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════\n");

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error("Erro ao executar testes:", err);
  process.exit(1);
});
