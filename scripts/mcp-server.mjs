#!/usr/bin/env node
/**
 * PONTE STDIO OFICIAL — VALEM CHAT / TECFAG MCP (v2.0.0)
 *
 * Encaminha 100% do protocolo MCP JSON-RPC 2.0 (initialize, tools/list, tools/call,
 * ping, resources/list, prompts/list) via HTTP para o servidor oficial `/api/mcp`,
 * garantindo fonte única da verdade, isolamento multi-tenant, controle de permissão
 * por chave (Somente Leitura vs Leitura + Escrita) e auditoria centralizada.
 *
 * Variáveis de ambiente suportadas:
 *   - MCP_REMOTE_URL: URL completa do conector (ex: https://tecfagchat.up.railway.app/api/mcp?token=...)
 *   - MCP_TOKEN: token opcional caso MCP_REMOTE_URL não inclua ?token=
 *   - MCP_CLIENT_LABEL: rótulo amigável exibido na auditoria (ex: "Antigravity IDE")
 *   - MCP_TIMEOUT_MS: timeout por requisição em ms (padrão: 30000)
 */

import crypto from "node:crypto";

// Protege stdout (canal exclusivo JSON-RPC) contra logs acidentais
const rawStdoutWrite = process.stdout.write.bind(process.stdout);
console.log = (...args) => process.stderr.write(`[mcp-bridge] ${args.join(" ")}\n`);
console.info = (...args) => process.stderr.write(`[mcp-bridge] ${args.join(" ")}\n`);
console.warn = (...args) => process.stderr.write(`[mcp-bridge-warn] ${args.join(" ")}\n`);

const DEFAULT_REMOTE_MCP_URL =
  "https://tecfagchat.up.railway.app/api/mcp?token=mcp_tf_8f4e2a9c1d7b6e3f5a0c2d4e8b1f7a3c";

const REMOTE_MCP_URL = (process.env.MCP_REMOTE_URL || DEFAULT_REMOTE_MCP_URL).trim();
const MCP_TOKEN = (process.env.MCP_TOKEN || "").trim();
const REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.MCP_TIMEOUT_MS || 30_000) || 30_000);

const bridgeSessionId = crypto.randomUUID();
let useContentLengthFraming = false;
let detectedClientLabel =
  process.env.MCP_CLIENT_LABEL ||
  (process.env.ANTIGRAVITY_CLI_ALIAS ? "Antigravity IDE" : "Cliente MCP Local (Stdio)");

function sendJsonRpc(message) {
  const json = JSON.stringify(message);
  if (useContentLengthFraming) {
    const byteLength = Buffer.byteLength(json, "utf8");
    rawStdoutWrite(`Content-Length: ${byteLength}\r\n\r\n${json}`);
  } else {
    rawStdoutWrite(`${json}\n`);
  }
}

async function forwardToRemoteMcp(msg) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Mcp-Session-Id": bridgeSessionId,
    "x-mcp-client-name": detectedClientLabel,
    "x-mcp-bridge": detectedClientLabel,
  };
  if (MCP_TOKEN) {
    headers.Authorization = `Bearer ${MCP_TOKEN}`;
  }

  try {
    const res = await fetch(REMOTE_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(msg),
      signal: controller.signal,
    });

    if (res.status === 202 || res.status === 204) {
      return null;
    }

    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const remoteMessage =
        parsed?.error?.message ||
        parsed?.error ||
        `Erro HTTP ${res.status} ao comunicar com ${REMOTE_MCP_URL}`;
      return {
        jsonrpc: "2.0",
        id: msg.id ?? null,
        error: {
          code: res.status === 401 ? -32001 : -32000,
          message: String(remoteMessage),
        },
      };
    }

    return parsed;
  } catch (err) {
    const reason =
      err?.name === "AbortError"
        ? `Timeout (${REQUEST_TIMEOUT_MS}ms) ao chamar o servidor MCP remoto.`
        : err?.message || String(err);
    return {
      jsonrpc: "2.0",
      id: msg.id ?? null,
      error: {
        code: -32002,
        message: `Falha de conexão com o servidor MCP remoto: ${reason}`,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function handleJsonRpcMessage(msg) {
  if (!msg || typeof msg !== "object") return;

  if (msg.method === "initialize" && msg.params?.clientInfo?.name) {
    detectedClientLabel = `${msg.params.clientInfo.name}${
      msg.params.clientInfo.version ? ` v${msg.params.clientInfo.version}` : ""
    }`;
  }

  // Notificações JSON-RPC (sem id) são encaminhadas sem resposta em stdout
  if (msg.id === undefined || msg.id === null || String(msg.method || "").startsWith("notifications/")) {
    await forwardToRemoteMcp(msg);
    return;
  }

  if (msg.method === "ping") {
    sendJsonRpc({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }

  const response = await forwardToRemoteMcp(msg);
  if (response !== null && response !== undefined) {
    sendJsonRpc(response);
  }
}

let inputBuffer = Buffer.alloc(0);

function processInputBuffer() {
  while (inputBuffer.length > 0) {
    const asText = inputBuffer.toString("utf8");

    if (asText.startsWith("Content-Length:")) {
      useContentLengthFraming = true;
      const headerEnd = inputBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const headerText = inputBuffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!match) {
        inputBuffer = inputBuffer.subarray(headerEnd + 4);
        continue;
      }
      const contentLength = Number(match[1]);
      const messageEnd = headerEnd + 4 + contentLength;
      if (inputBuffer.length < messageEnd) return;

      const body = inputBuffer.subarray(headerEnd + 4, messageEnd).toString("utf8");
      inputBuffer = inputBuffer.subarray(messageEnd);
      try {
        const parsed = JSON.parse(body);
        void handleJsonRpcMessage(parsed);
      } catch (err) {
        process.stderr.write(`[mcp-bridge-parse-error] ${err?.message || err}\n`);
      }
      continue;
    }

    const newlineIdx = inputBuffer.indexOf("\n");
    if (newlineIdx === -1) return;

    const line = inputBuffer.subarray(0, newlineIdx).toString("utf8").trim();
    inputBuffer = inputBuffer.subarray(newlineIdx + 1);
    if (!line) continue;

    try {
      const parsed = JSON.parse(line);
      void handleJsonRpcMessage(parsed);
    } catch (err) {
      process.stderr.write(`[mcp-bridge-parse-error] ${err?.message || err}\n`);
    }
  }
}

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  processInputBuffer();
});

process.stdin.on("end", () => {
  process.exit(0);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
