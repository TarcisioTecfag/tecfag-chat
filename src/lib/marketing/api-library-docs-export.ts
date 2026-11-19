import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getAiPersona } from "../ai-persona";
import { MCP_TOOLS } from "../mcp/valem-tecfag-mcp-core";
import {
  buildCurlSnippet,
  buildEnvSnippet,
  buildNodeSnippet,
  buildPythonSnippet,
  getApiLibraryCatalog,
  type ApiCatalogEntry,
  type ApiParamDoc,
} from "./api-library-catalog";
import { MARKETING_SECTOR_LABELS } from "./crm-attribution";

export interface ApiLibraryExportOptions {
  tenantId: string;
  baseUrl: string;
  generatedAt?: Date;
}

interface NormalizedMcpEntry {
  entry: ApiCatalogEntry;
  liveInProduction: boolean;
}

const TOKEN_PLACEHOLDER = "<SEU_API_TOKEN>";

function formatSaoPauloTimestamp(date: Date): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * Converte caracteres Unicode fora da tabela WinAnsi (Windows-1252) em equivalentes
 * legíveis para que as fontes padrão embutidas do PDF (Helvetica / Courier) nunca
 * falhem ao renderizar acentuação em português ou símbolos técnicos.
 */
export function sanitizePdfText(input: string): string {
  const replaced = String(input ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/↔/g, "<->")
    .replace(/×/g, "x")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/≠/g, "!=")
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .replace(/·/g, "|")
    .replace(/–/g, "-")
    .replace(/—/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, " ");

  let out = "";
  for (const ch of replaced) {
    const code = ch.codePointAt(0) ?? 32;
    if (
      code === 10 ||
      (code >= 32 && code <= 126) ||
      (code >= 160 && code <= 255)
    ) {
      out += ch;
    }
  }
  return out;
}

function buildParamsFromMcpSchema(
  schema: Record<string, unknown> | undefined,
): ApiParamDoc[] {
  if (!schema || typeof schema !== "object") return [];
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const requiredSet = new Set(
    Array.isArray(schema.required) ? schema.required.map(String) : [],
  );

  return Object.entries(props)
    .filter(([key]) => key !== "tenantId")
    .map(([name, def]) => {
      const enumVals = Array.isArray(def.enum) ? def.enum.map(String) : null;
      const baseType = String(def.type ?? "string");
      const typeLabel = enumVals ? `enum (${enumVals.join(" | ")})` : baseType;
      return {
        name,
        location: "argument" as const,
        type: typeLabel,
        required: requiredSet.has(name),
        defaultValue:
          def.default !== undefined ? String(def.default) : undefined,
        description: String(def.description ?? "Parâmetro de entrada da ferramenta MCP."),
      };
    });
}

/**
 * Unifica o catálogo da Biblioteca de API com a lista viva `MCP_TOOLS` de `/api/mcp`,
 * garantindo 0 duplicatas e cobertura total de todas as rotas REST, ferramentas MCP e Webhooks.
 */
export function buildUnifiedLibraryInventory(tenantId: string): {
  restEntries: ApiCatalogEntry[];
  mcpEntries: NormalizedMcpEntry[];
  webhookEntries: ApiCatalogEntry[];
  liveMcpCount: number;
} {
  const catalog = getApiLibraryCatalog(tenantId);

  const dedupedCatalog: ApiCatalogEntry[] = [];
  const seenIds = new Set<string>();
  for (const entry of catalog) {
    const key = `${entry.kind}:${entry.id}:${entry.pathOrTool}`;
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    dedupedCatalog.push(entry);
  }

  const restEntries = dedupedCatalog.filter((e) => e.kind === "rest");
  const webhookEntries = dedupedCatalog.filter((e) => e.kind === "webhook");

  const catalogMcpByTool = new Map<string, ApiCatalogEntry>();
  for (const entry of dedupedCatalog) {
    if (entry.kind !== "mcp") continue;
    const toolKey = entry.mcpToolName || entry.pathOrTool;
    if (!catalogMcpByTool.has(toolKey)) {
      catalogMcpByTool.set(toolKey, entry);
    }
  }

  const liveToolNames = new Set(MCP_TOOLS.map((t) => t.name));
  const mcpEntries: NormalizedMcpEntry[] = [];
  const includedMcpTools = new Set<string>();

  // 1. Primeiro, TODAS as ferramentas reais ativas no servidor /api/mcp (MCP_TOOLS)
  for (const liveTool of MCP_TOOLS) {
    includedMcpTools.add(liveTool.name);
    const catalogMatch = catalogMcpByTool.get(liveTool.name);
    const schemaParams = buildParamsFromMcpSchema(
      liveTool.inputSchema as Record<string, unknown> | undefined,
    );

    if (catalogMatch) {
      // Mescla parâmetros do inputSchema real para nunca omitir nenhum argumento aceito pela ferramenta,
      // evitando duplicar rótulos agrupados do catálogo (ex: "sectorOrigin / sectorCurrent") quando já existem individualmente.
      const mergedParams: ApiParamDoc[] = [...schemaParams];
      const schemaNames = new Set(schemaParams.map((p) => p.name));
      for (const p of catalogMatch.params) {
        const parts = p.name
          .split("/")
          .map((s) => s.trim())
          .filter(Boolean);
        const alreadyCovered =
          schemaNames.has(p.name) ||
          (parts.length > 0 && parts.every((part) => schemaNames.has(part)));
        if (!alreadyCovered) mergedParams.push(p);
      }

      mcpEntries.push({
        liveInProduction: true,
        entry: {
          ...catalogMatch,
          params: mergedParams.length > 0 ? mergedParams : catalogMatch.params,
        },
      });
    } else {
      mcpEntries.push({
        liveInProduction: true,
        entry: {
          id: `mcp-live-${liveTool.name}`,
          kind: "mcp",
          categoryLabel: "Conector MCP · Ferramentas de IA",
          method: "MCP",
          pathOrTool: liveTool.name,
          mcpToolName: liveTool.name,
          mcpDefaultArgs: {},
          title: `MCP · ${liveTool.name}`,
          shortSummary: liveTool.description,
          detailedExplanation: liveTool.description,
          useCases: [
            `Acionar via JSON-RPC POST /api/mcp (tools/call -> ${liveTool.name}) ou GET /api/mcp?token=...&tool=${liveTool.name}`,
          ],
          params: schemaParams,
          responseFields: [
            {
              name: "result.content[0].text",
              type: "string (JSON)",
              description: "Payload JSON estruturado retornado pela ferramenta MCP.",
            },
          ],
          sampleResponsePayload: { tenantId, tool: liveTool.name, status: "ok" },
          supportsLivePlayground: true,
        },
      });
    }
  }

  // 2. Depois, ferramentas adicionais documentadas no catálogo (ex: ações de escrita/roadmap)
  for (const [toolKey, entry] of catalogMcpByTool.entries()) {
    if (includedMcpTools.has(toolKey)) continue;
    includedMcpTools.add(toolKey);
    mcpEntries.push({
      liveInProduction: liveToolNames.has(toolKey),
      entry,
    });
  }

  return {
    restEntries,
    mcpEntries,
    webhookEntries,
    liveMcpCount: MCP_TOOLS.length,
  };
}

/**
 * Gera a documentação completa em Markdown da Biblioteca de API REST, Conector MCP,
 * Webhooks e Regras Globais — usada na aba "Guia & Boas Práticas" e via `?format=md`.
 */
export function buildCompleteApiLibraryMarkdown(
  options: ApiLibraryExportOptions,
): string {
  const { tenantId } = options;
  const cleanBase = options.baseUrl.replace(/\/+$/, "");
  const persona = getAiPersona(tenantId);
  const companyLabel = tenantId === "valem" ? "Valem" : "Tecfag";
  const generatedStr = formatSaoPauloTimestamp(options.generatedAt ?? new Date());
  const inventory = buildUnifiedLibraryInventory(tenantId);

  const lines: string[] = [];

  lines.push(
    `# Biblioteca Oficial de APIs, Conector MCP (${persona.name}) & Webhooks — ${companyLabel}`,
  );
  lines.push("");
  lines.push(`- **Empresa / Silo Isolado:** ${persona.company} (\`tenant_id = "${tenantId}"\`)`);
  lines.push(`- **Assistente IA / Persona:** ${persona.name}`);
  lines.push(`- **Base URL do Servidor:** \`${cleanBase}\``);
  lines.push(`- **Emitido em (BRT):** ${generatedStr}`);
  lines.push(
    `- **Cobertura Total:** ${inventory.restEntries.length} rotas API REST · ${inventory.mcpEntries.length} ferramentas MCP (${inventory.liveMcpCount} ativas em \`/api/mcp\`) · ${inventory.webhookEntries.length} webhooks/canais em tempo real`,
  );
  lines.push("");
  lines.push(
    "> **Nota de Segurança:** Todos os exemplos deste documento usam o placeholder `<SEU_API_TOKEN>`. Gere ou copie sua chave real na aba **Configurações → Biblioteca de API** ou **Conector MCP** e armazene-a exclusivamente em arquivo `.env` (nunca em repositórios Git).",
  );
  lines.push("");

  // 1. ARQUITETURA & REGRAS GLOBAIS
  lines.push("## 1. Arquitetura, Autenticação & Regras Globais");
  lines.push("");
  lines.push("### 1.1 Autenticação e Isolamento Multi-Tenant");
  lines.push(
    `- Envie o cabeçalho \`Authorization: Bearer ${TOKEN_PLACEHOLDER}\` (ou \`x-api-key: ${TOKEN_PLACEHOLDER}\`) em todas as chamadas REST e MCP.`,
  );
  lines.push(
    `- Cada chave pertence estritamente ao silo \`${tenantId}\`. O servidor trava o \`tenant_id\` pela chave — tentativas de consultar outro tenant retornam \`403 Forbidden\`.`,
  );
  lines.push("- Exemplo de arquivo `.env` recomendado:");
  lines.push("```dotenv");
  lines.push(
    buildEnvSnippet({
      tenantId,
      baseUrl: cleanBase,
      token: TOKEN_PLACEHOLDER,
    }),
  );
  lines.push("```");
  lines.push("");

  lines.push("### 1.2 Paginação Determinística & Extração Incremental");
  lines.push(
    "- Todas as rotas em massa aceitam `limit` (padrão `200`, máximo `1000`) e `cursor` (`base64url`), ordenados de forma determinística por `(updated_at, id)`.",
  );
  lines.push(
    "- Enquanto `pagination.has_more === true`, envie `cursor=pagination.next_cursor` na próxima requisição sem duplicar nem pular registros.",
  );
  lines.push(
    "- Após a carga inicial completa, use `updated_since=YYYY-MM-DD` (ou ISO 8601) para extrair apenas registros criados ou atualizados desde a última sincronização.",
  );
  lines.push("");

  lines.push("### 1.3 Regras Canônicas de Negócio (Paridade REST = MCP)");
  lines.push(
    "- **Regra Única de Venda (`win = true`):** Considera vendas efetivas tanto `status = 'won'` quanto negociações abertas em etapas comerciais `FECHAMENTO` ou `VENDA CONCLUÍDA` (excluindo etapas administrativas de Suporte/Financeiro).",
  );
  lines.push(
    "- **Setor de Origem (`sector_origin`) vs. Setor Atual (`sector_current`):** O card nasce em `pre_venda` no SDR e trava permanentemente `sector_origin` no 1º setor comercial definitivo, enquanto `sector_current` acompanha movimentações futuras.",
  );
  lines.push(
    "- **Taxonomia de Origens:** `deal_source_name` segue o padrão RD (`Busca Paga | Google`, `Busca Paga | Meta`, etc.); `campaign_name` registra o ponto de conversão (formulário/LP/CTWA); `entry_channel` isola a porta técnica (`rd_webhook`, `whatsapp`, `whatsapp_sdr`, `site_chat`, `manual`, `import_rd`).",
  );
  lines.push(
    "- **Filtros Padrão:** `include_tests = false` (exclui cards de teste), `include_legacy = true` (preserva histórico migrado do RD com `id_rd`) e `messages_metadata_only = true` em `/messages` (omissão de texto para velocidade; passe `include_content=true` se necessário).",
  );
  lines.push("");

  lines.push("### 1.4 Dicionário Oficial de Setores");
  lines.push("| Código | Descrição |");
  lines.push("| --- | --- |");
  for (const [code, label] of Object.entries(MARKETING_SECTOR_LABELS)) {
    lines.push(`| \`${code}\` | ${label} |`);
  }
  lines.push("");

  lines.push("### 1.5 Códigos HTTP & Tratamento de Erros");
  lines.push("| Código | Significado | Ação Recomendada |");
  lines.push("| --- | --- | --- |");
  lines.push("| `200 OK` / `201` / `202` | Requisição concluída ou aceita | Processar payload JSON normalmente |");
  lines.push("| `400 Bad Request` | Parâmetro inválido ou campo obrigatório ausente | Revisar query/body conforme especificação |");
  lines.push("| `401 Unauthorized` | Token ausente, inválido ou chave pausada/revogada | Verificar `.env` e status da chave em Conector MCP |");
  lines.push("| `403 Forbidden` | Tentativa de acesso a outro tenant ou permissão insuficiente | Conferir escopo do token / papel `admin` |");
  lines.push("| `404 Not Found` | Recurso ou `dealId`/`conversationId` inexistente no tenant | Confirmar ID dentro do tenant autenticado |");
  lines.push("| `429 Too Many Requests` | Limite de taxa excedido | Aplicar backoff exponencial e reduzir paralelismo |");
  lines.push("| `500 Internal Server Error` | Erro inesperado no servidor | Repetir com retry e consultar auditoria/logs |");
  lines.push("");

  // 2. API REST
  lines.push(`## 2. API REST v1 (\`/api/v1/marketing/*\`) — ${inventory.restEntries.length} Rotas`);
  lines.push("");
  for (const entry of inventory.restEntries) {
    lines.push(`### ${entry.method} \`${entry.pathOrTool}\` — ${entry.title}`);
    lines.push("");
    lines.push(entry.shortSummary);
    lines.push("");
    lines.push(entry.detailedExplanation);
    lines.push("");
    if (entry.businessRules?.length) {
      lines.push("**Regras de Negócio:**");
      for (const rule of entry.businessRules) lines.push(`- ${rule}`);
      lines.push("");
    }
    if (entry.params.length) {
      lines.push("**Parâmetros:**");
      lines.push("| Parâmetro | Local | Tipo | Obrigatório | Descrição |");
      lines.push("| --- | --- | --- | --- | --- |");
      for (const p of entry.params) {
        lines.push(
          `| \`${p.name}\` | ${p.location} | \`${p.type}\` | ${p.required ? "Sim" : "Não"}${p.defaultValue ? ` (padrão: ${p.defaultValue})` : ""} | ${p.description} |`,
        );
      }
      lines.push("");
    }
    if (entry.responseFields.length) {
      lines.push("**Campos de Retorno:**");
      for (const f of entry.responseFields) {
        lines.push(`- \`${f.name}\` (\`${f.type}\`): ${f.description}`);
      }
      lines.push("");
    }
    lines.push("**Exemplo cURL:**");
    lines.push("```bash");
    lines.push(buildCurlSnippet({ entry, baseUrl: cleanBase, token: TOKEN_PLACEHOLDER }));
    lines.push("```");
    lines.push("");
    lines.push("**Exemplo Python:**");
    lines.push("```python");
    lines.push(
      buildPythonSnippet({
        entry,
        tenantId,
        baseUrl: cleanBase,
        token: TOKEN_PLACEHOLDER,
        useEnvVars: true,
      }),
    );
    lines.push("```");
    lines.push("");
    lines.push("**Exemplo de Resposta (`200 OK`):**");
    lines.push("```json");
    lines.push(JSON.stringify(entry.sampleResponsePayload, null, 2));
    lines.push("```");
    lines.push("");
  }

  // 3. CONECTOR MCP
  lines.push(`## 3. Conector MCP (\`/api/mcp\`) — ${inventory.mcpEntries.length} Ferramentas`);
  lines.push("");
  lines.push("### 3.1 Protocolo, Transportes e Configuração em Clientes IA");
  lines.push(
    `- **Endpoint Único:** \`${cleanBase}/api/mcp\` (suporta **Streamable HTTP** via \`POST\`, **SSE** via \`GET\` com \`Accept: text/event-stream\` e **Consulta Direta** via \`GET /api/mcp?token=${TOKEN_PLACEHOLDER}&tool=<nome_da_ferramenta>\`).`,
  );
  lines.push(
    "- **Métodos JSON-RPC 2.0:** `initialize`, `notifications/initialized`, `tools/list`, `tools/call` e `ping`.",
  );
  lines.push(
    "- **Autenticação MCP:** Header `Authorization: Bearer <TOKEN>`, header `x-mcp-token: <TOKEN>` ou query `?token=<TOKEN>`.",
  );
  lines.push("");
  lines.push("**Configuração para Claude / Antigravity / Cursor (MCP HTTP/SSE):**");
  lines.push("```json");
  lines.push(
    JSON.stringify(
      {
        mcpServers: {
          [`${tenantId}-crm`]: {
            url: `${cleanBase}/api/mcp?token=${TOKEN_PLACEHOLDER}`,
          },
        },
      },
      null,
      2,
    ),
  );
  lines.push("```");
  lines.push("");

  for (const { entry, liveInProduction } of inventory.mcpEntries) {
    const statusTag = liveInProduction
      ? "Ativo em Produção (`/api/mcp`)"
      : "Catálogo / Ação de Escrita";
    lines.push(`### MCP \`${entry.mcpToolName || entry.pathOrTool}\` — ${entry.title}`);
    lines.push(`- **Status:** ${statusTag}`);
    lines.push("");
    lines.push(entry.shortSummary);
    lines.push("");
    if (entry.detailedExplanation !== entry.shortSummary) {
      lines.push(entry.detailedExplanation);
      lines.push("");
    }
    if (entry.params.length) {
      lines.push("**Argumentos:**");
      lines.push("| Argumento | Tipo | Obrigatório | Descrição |");
      lines.push("| --- | --- | --- | --- |");
      for (const p of entry.params) {
        lines.push(
          `| \`${p.name}\` | \`${p.type}\` | ${p.required ? "Sim" : "Não"}${p.defaultValue ? ` (padrão: ${p.defaultValue})` : ""} | ${p.description} |`,
        );
      }
      lines.push("");
    }
    lines.push("**Exemplo JSON-RPC (cURL):**");
    lines.push("```bash");
    lines.push(buildCurlSnippet({ entry, baseUrl: cleanBase, token: TOKEN_PLACEHOLDER }));
    lines.push("```");
    lines.push("");
    lines.push("**Exemplo de Resposta:**");
    lines.push("```json");
    lines.push(JSON.stringify(entry.sampleResponsePayload, null, 2));
    lines.push("```");
    lines.push("");
  }

  // 4. WEBHOOKS & CANAIS EM TEMPO REAL
  lines.push(
    `## 4. Webhooks & Canais em Tempo Real — ${inventory.webhookEntries.length} Endpoints`,
  );
  lines.push("");
  for (const entry of inventory.webhookEntries) {
    lines.push(`### ${entry.method} \`${entry.pathOrTool}\` — ${entry.title}`);
    lines.push("");
    lines.push(entry.shortSummary);
    lines.push("");
    lines.push(entry.detailedExplanation);
    lines.push("");
    if (entry.businessRules?.length) {
      lines.push("**Regras de Operação:**");
      for (const rule of entry.businessRules) lines.push(`- ${rule}`);
      lines.push("");
    }
    if (entry.params.length) {
      lines.push("**Parâmetros / Headers:**");
      for (const p of entry.params) {
        lines.push(
          `- \`${p.name}\` (${p.location} · \`${p.type}\`${p.required ? " · obrigatório" : ""}): ${p.description}`,
        );
      }
      lines.push("");
    }
    if (entry.sampleRequestPayload) {
      lines.push("**Exemplo de Payload Enviado (Request JSON):**");
      lines.push("```json");
      lines.push(JSON.stringify(entry.sampleRequestPayload, null, 2));
      lines.push("```");
      lines.push("");
    }
    lines.push("**Exemplo de Resposta:**");
    lines.push("```json");
    lines.push(JSON.stringify(entry.sampleResponsePayload, null, 2));
    lines.push("```");
    lines.push("");
  }

  // 5. BOAS PRÁTICAS & CRUZAMENTO ERP
  lines.push("## 5. Boas Práticas de Integração, Cruzamento ERP & Segurança");
  lines.push("");
  lines.push(
    "1. **Carga Inicial vs. Incremental:** Faça a primeira extração com `limit=1000` percorrendo `pagination.next_cursor` até `has_more = false`. Em rotinas agendadas (ex: 09h/18h), passe `updated_since` com margem de 1 dia e faça upsert pelo `id`.",
  );
  lines.push(
    "2. **Chaves de Cruzamento CRM x ERP x Mídia Paga:** Utilize nesta ordem de precedência: `id_rd` (Link CRM), `organization_cnpj` (apenas dígitos), `contacts_emails` (minúsculas) e `contacts_phones_last9` (últimos 9 dígitos do WhatsApp).",
  );
  lines.push(
    "3. **Auditoria & Rotação de Chaves:** Crie uma chave nomeada separada para cada consumidor (ex: `BI PowerBI`, `Marketing - Python 09h`, `Claude Diretoria`) para auditar latência/uso individualmente e revogar sem derrubar outras integrações.",
  );
  lines.push(
    "4. **Validação de Webhooks:** Em webhooks de saída (`Webhook Hub`), valide sempre o header `X-Webhook-Signature` usando HMAC-SHA256 com o `secret` da subscrição; na Meta Cloud API, o servidor valida `X-Hub-Signature-256`; no RD Marketing, rotacione a URL imediatamente em caso de exposição.",
  );
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR DE GERAÇÃO DE PDF BINÁRIO (pdf-lib — A4, Multi-Página, Zero Dependências Nativas)
// ═══════════════════════════════════════════════════════════════════════════

const PAGE_W = 595.28; // A4 width in pt
const PAGE_H = 841.89; // A4 height in pt
const MARGIN_X = 40;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const TOP_Y = PAGE_H - 52;
const BOTTOM_Y = 48;

const COLOR = {
  ink: rgb(0.08, 0.1, 0.14),
  muted: rgb(0.38, 0.42, 0.5),
  lightMuted: rgb(0.56, 0.6, 0.68),
  brand: rgb(0.82, 0.15, 0.2), // Crimson Tecfag/Valem
  brandDark: rgb(0.1, 0.12, 0.17),
  border: rgb(0.84, 0.87, 0.91),
  surface: rgb(0.96, 0.97, 0.985),
  codeBg: rgb(0.11, 0.13, 0.18),
  codeText: rgb(0.92, 0.95, 0.98),
  white: rgb(1, 1, 1),
  emeraldBg: rgb(0.9, 0.98, 0.94),
  emeraldText: rgb(0.04, 0.5, 0.3),
  amberBg: rgb(1, 0.96, 0.87),
  amberText: rgb(0.65, 0.36, 0.02),
  violetBg: rgb(0.95, 0.92, 1),
  violetText: rgb(0.42, 0.16, 0.72),
  skyBg: rgb(0.9, 0.96, 1),
  skyText: rgb(0.05, 0.42, 0.68),
};

interface PdfWriterState {
  doc: PDFDocument;
  pages: PDFPage[];
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
  headerTitle: string;
  sectionLabel: string;
}

function wrapTextToLines(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const safe = sanitizePdfText(text);
  const rawParagraphs = safe.split("\n");
  const result: string[] = [];

  for (const paragraph of rawParagraphs) {
    if (paragraph.trim() === "") {
      result.push("");
      continue;
    }

    const words = paragraph.split(" ");
    let current = "";

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) {
          result.push(current);
          current = "";
        }
        // Palavra/URL/token maior que a largura disponível -> quebra por caractere
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let chunk = "";
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, size) <= maxWidth) {
              chunk += ch;
            } else {
              if (chunk) result.push(chunk);
              chunk = ch;
            }
          }
          current = chunk;
        } else {
          current = word;
        }
      }
    }
    if (current) result.push(current);
  }

  return result;
}

function wrapCodeLines(
  code: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const safe = sanitizePdfText(code);
  const out: string[] = [];
  for (const rawLine of safe.split("\n")) {
    if (rawLine.length === 0) {
      out.push("");
      continue;
    }
    if (font.widthOfTextAtSize(rawLine, size) <= maxWidth) {
      out.push(rawLine);
      continue;
    }
    let chunk = "";
    for (const ch of rawLine) {
      if (font.widthOfTextAtSize(chunk + ch, size) <= maxWidth) {
        chunk += ch;
      } else {
        out.push(chunk);
        chunk = "  " + ch;
      }
    }
    if (chunk) out.push(chunk);
  }
  return out;
}

function addPage(state: PdfWriterState): void {
  const page = state.doc.addPage([PAGE_W, PAGE_H]);
  state.pages.push(page);
  state.page = page;
  state.y = TOP_Y;

  // Cabeçalho discreto em páginas internas (índice > 0)
  if (state.pages.length > 1) {
    page.drawLine({
      start: { x: MARGIN_X, y: PAGE_H - 34 },
      end: { x: PAGE_W - MARGIN_X, y: PAGE_H - 34 },
      thickness: 0.6,
      color: COLOR.border,
    });
    page.drawText(sanitizePdfText(state.headerTitle), {
      x: MARGIN_X,
      y: PAGE_H - 28,
      size: 7.5,
      font: state.bold,
      color: COLOR.muted,
    });
    const secText = sanitizePdfText(state.sectionLabel);
    const secW = state.regular.widthOfTextAtSize(secText, 7.5);
    page.drawText(secText, {
      x: PAGE_W - MARGIN_X - secW,
      y: PAGE_H - 28,
      size: 7.5,
      font: state.regular,
      color: COLOR.lightMuted,
    });
  }
}

function ensureSpace(state: PdfWriterState, neededHeight: number): void {
  if (state.y - neededHeight < BOTTOM_Y) {
    addPage(state);
  }
}

function drawParagraph(
  state: PdfWriterState,
  text: string,
  opts?: {
    size?: number;
    font?: PDFFont;
    color?: ReturnType<typeof rgb>;
    indent?: number;
    lineHeight?: number;
    spaceAfter?: number;
  },
): void {
  const size = opts?.size ?? 9;
  const font = opts?.font ?? state.regular;
  const color = opts?.color ?? COLOR.ink;
  const indent = opts?.indent ?? 0;
  const lineHeight = opts?.lineHeight ?? size * 1.42;
  const lines = wrapTextToLines(text, font, size, CONTENT_W - indent);

  for (const line of lines) {
    ensureSpace(state, lineHeight);
    if (line.length > 0) {
      state.page.drawText(line, {
        x: MARGIN_X + indent,
        y: state.y - size,
        size,
        font,
        color,
      });
    }
    state.y -= lineHeight;
  }
  if (opts?.spaceAfter) {
    state.y -= opts.spaceAfter;
  }
}

function drawSectionBanner(
  state: PdfWriterState,
  numberLabel: string,
  title: string,
  subtitle: string,
): void {
  state.sectionLabel = `${numberLabel}. ${title}`;
  ensureSpace(state, 56);
  state.y -= 6;
  const boxH = 42;
  state.page.drawRectangle({
    x: MARGIN_X,
    y: state.y - boxH,
    width: CONTENT_W,
    height: boxH,
    color: COLOR.brandDark,
  });
  state.page.drawRectangle({
    x: MARGIN_X,
    y: state.y - boxH,
    width: 4,
    height: boxH,
    color: COLOR.brand,
  });
  state.page.drawText(sanitizePdfText(`${numberLabel}. ${title}`), {
    x: MARGIN_X + 12,
    y: state.y - 18,
    size: 12,
    font: state.bold,
    color: COLOR.white,
  });
  state.page.drawText(sanitizePdfText(subtitle), {
    x: MARGIN_X + 12,
    y: state.y - 33,
    size: 8,
    font: state.regular,
    color: rgb(0.78, 0.82, 0.88),
  });
  state.y -= boxH + 12;
}

function drawSubHeading(state: PdfWriterState, title: string): void {
  ensureSpace(state, 24);
  state.y -= 4;
  state.page.drawText(sanitizePdfText(title), {
    x: MARGIN_X,
    y: state.y - 10,
    size: 10.5,
    font: state.bold,
    color: COLOR.brandDark,
  });
  state.page.drawLine({
    start: { x: MARGIN_X, y: state.y - 14 },
    end: { x: MARGIN_X + CONTENT_W, y: state.y - 14 },
    thickness: 0.7,
    color: COLOR.border,
  });
  state.y -= 20;
}

function drawBulletList(state: PdfWriterState, items: string[]): void {
  for (const item of items) {
    const lines = wrapTextToLines(item, state.regular, 8.6, CONTENT_W - 14);
    const lineHeight = 12.2;
    ensureSpace(state, lineHeight);
    state.page.drawText("-", {
      x: MARGIN_X + 4,
      y: state.y - 8.6,
      size: 8.6,
      font: state.bold,
      color: COLOR.brand,
    });
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) ensureSpace(state, lineHeight);
      state.page.drawText(lines[i], {
        x: MARGIN_X + 14,
        y: state.y - 8.6,
        size: 8.6,
        font: state.regular,
        color: COLOR.ink,
      });
      state.y -= lineHeight;
    }
    state.y -= 1.5;
  }
  state.y -= 4;
}

function drawCodeBlock(
  state: PdfWriterState,
  label: string,
  code: string,
): void {
  const fontSize = 7.4;
  const lineH = 10.2;
  const padX = 8;
  const padY = 6;
  const wrapped = wrapCodeLines(code, state.mono, fontSize, CONTENT_W - padX * 2);

  ensureSpace(state, 26 + lineH);

  // Label acima do bloco
  state.page.drawText(sanitizePdfText(label), {
    x: MARGIN_X,
    y: state.y - 8,
    size: 7.8,
    font: state.bold,
    color: COLOR.muted,
  });
  state.y -= 12;

  // Renderiza o bloco paginando fatias caso seja longo
  let idx = 0;
  while (idx < wrapped.length) {
    const availH = state.y - BOTTOM_Y - padY * 2;
    const maxLinesFit = Math.max(1, Math.floor(availH / lineH));
    const slice = wrapped.slice(idx, idx + maxLinesFit);
    const boxH = slice.length * lineH + padY * 2;

    state.page.drawRectangle({
      x: MARGIN_X,
      y: state.y - boxH,
      width: CONTENT_W,
      height: boxH,
      color: COLOR.codeBg,
      borderColor: COLOR.border,
      borderWidth: 0.4,
    });

    let lineY = state.y - padY - fontSize;
    for (const line of slice) {
      if (line.length > 0) {
        state.page.drawText(line, {
          x: MARGIN_X + padX,
          y: lineY,
          size: fontSize,
          font: state.mono,
          color: COLOR.codeText,
        });
      }
      lineY -= lineH;
    }

    state.y -= boxH + 6;
    idx += slice.length;
    if (idx < wrapped.length) {
      addPage(state);
    }
  }
}

function drawTable(
  state: PdfWriterState,
  headers: string[],
  rows: string[][],
  colWidths: number[],
): void {
  const fontSize = 7.8;
  const lineH = 10.6;
  const padX = 5;
  const padY = 4;

  const drawHeaderRow = () => {
    const headerH = 18;
    ensureSpace(state, headerH + 16);
    state.page.drawRectangle({
      x: MARGIN_X,
      y: state.y - headerH,
      width: CONTENT_W,
      height: headerH,
      color: COLOR.surface,
      borderColor: COLOR.border,
      borderWidth: 0.5,
    });
    let x = MARGIN_X;
    for (let c = 0; c < headers.length; c++) {
      state.page.drawText(sanitizePdfText(headers[c]), {
        x: x + padX,
        y: state.y - 12,
        size: 7.6,
        font: state.bold,
        color: COLOR.brandDark,
      });
      x += colWidths[c];
    }
    state.y -= headerH;
  };

  drawHeaderRow();

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const cellLines = row.map((cell, c) =>
      wrapTextToLines(
        cell,
        c === 0 ? state.monoBold : state.regular,
        fontSize,
        colWidths[c] - padX * 2,
      ),
    );
    const maxLines = Math.max(1, ...cellLines.map((l) => l.length));
    const rowH = maxLines * lineH + padY * 2;

    if (state.y - rowH < BOTTOM_Y) {
      addPage(state);
      drawHeaderRow();
    }

    state.page.drawRectangle({
      x: MARGIN_X,
      y: state.y - rowH,
      width: CONTENT_W,
      height: rowH,
      color: r % 2 === 1 ? COLOR.surface : COLOR.white,
      borderColor: COLOR.border,
      borderWidth: 0.35,
    });

    let x = MARGIN_X;
    for (let c = 0; c < row.length; c++) {
      const cellFont = c === 0 ? state.monoBold : state.regular;
      const cellColor = c === 0 ? COLOR.brandDark : COLOR.ink;
      let ty = state.y - padY - fontSize;
      for (const line of cellLines[c]) {
        if (line.length > 0) {
          state.page.drawText(line, {
            x: x + padX,
            y: ty,
            size: fontSize,
            font: cellFont,
            color: cellColor,
          });
        }
        ty -= lineH;
      }
      x += colWidths[c];
    }
    state.y -= rowH;
  }

  state.y -= 8;
}

function getMethodColors(method: ApiCatalogEntry["method"]) {
  switch (method) {
    case "GET":
      return { bg: COLOR.emeraldBg, fg: COLOR.emeraldText };
    case "POST":
      return { bg: COLOR.amberBg, fg: COLOR.amberText };
    case "MCP":
      return { bg: COLOR.violetBg, fg: COLOR.violetText };
    case "WS":
      return { bg: COLOR.skyBg, fg: COLOR.skyText };
  }
}

function drawEntryHeaderCard(
  state: PdfWriterState,
  entry: ApiCatalogEntry,
  statusBadge?: string,
): void {
  const titleLines = wrapTextToLines(entry.title, state.bold, 10.5, CONTENT_W - 16);
  const pathText =
    entry.kind === "mcp"
      ? `POST /api/mcp  ->  tools/call("${entry.mcpToolName || entry.pathOrTool}")`
      : `${entry.method} ${entry.pathOrTool}`;
  const pathLines = wrapTextToLines(pathText, state.monoBold, 8.2, CONTENT_W - 80);
  const boxH = 22 + titleLines.length * 13 + pathLines.length * 11;

  ensureSpace(state, boxH + 44);
  state.y -= 4;

  state.page.drawRectangle({
    x: MARGIN_X,
    y: state.y - boxH,
    width: CONTENT_W,
    height: boxH,
    color: COLOR.surface,
    borderColor: COLOR.border,
    borderWidth: 0.7,
  });

  // Badge método
  const mc = getMethodColors(entry.method);
  const badgeW = 36;
  const badgeH = 14;
  state.page.drawRectangle({
    x: MARGIN_X + 8,
    y: state.y - 19,
    width: badgeW,
    height: badgeH,
    color: mc.bg,
    borderColor: mc.fg,
    borderWidth: 0.5,
  });
  const methodW = state.monoBold.widthOfTextAtSize(entry.method, 7.6);
  state.page.drawText(entry.method, {
    x: MARGIN_X + 8 + (badgeW - methodW) / 2,
    y: state.y - 14.5,
    size: 7.6,
    font: state.monoBold,
    color: mc.fg,
  });

  // Path ou ferramenta ao lado do badge
  let py = state.y - 14.5;
  for (const pl of pathLines) {
    state.page.drawText(pl, {
      x: MARGIN_X + 50,
      y: py,
      size: 8.2,
      font: state.monoBold,
      color: COLOR.brandDark,
    });
    py -= 11;
  }

  // Badge opcional de status (ex: ATIVO EM /api/mcp)
  if (statusBadge) {
    const safeBadge = sanitizePdfText(statusBadge);
    const bw = state.bold.widthOfTextAtSize(safeBadge, 7) + 10;
    const isLive = statusBadge.includes("ATIVO");
    state.page.drawRectangle({
      x: MARGIN_X + CONTENT_W - bw - 8,
      y: state.y - 19,
      width: bw,
      height: 14,
      color: isLive ? COLOR.emeraldBg : COLOR.amberBg,
      borderColor: isLive ? COLOR.emeraldText : COLOR.amberText,
      borderWidth: 0.4,
    });
    state.page.drawText(safeBadge, {
      x: MARGIN_X + CONTENT_W - bw - 3,
      y: state.y - 14.5,
      size: 7,
      font: state.bold,
      color: isLive ? COLOR.emeraldText : COLOR.amberText,
    });
  }

  // Título
  let ty = state.y - 22 - pathLines.length * 11 + 3;
  for (const tl of titleLines) {
    state.page.drawText(tl, {
      x: MARGIN_X + 8,
      y: ty,
      size: 10.5,
      font: state.bold,
      color: COLOR.ink,
    });
    ty -= 13;
  }

  state.y -= boxH + 8;
}

function renderCatalogEntryDetails(
  state: PdfWriterState,
  entry: ApiCatalogEntry,
  options: {
    tenantId: string;
    baseUrl: string;
    statusBadge?: string;
    includeNodeSnippet?: boolean;
  },
): void {
  drawEntryHeaderCard(state, entry, options.statusBadge);

  drawParagraph(state, entry.shortSummary, {
    size: 8.8,
    font: state.bold,
    color: COLOR.ink,
    spaceAfter: 3,
  });

  if (entry.detailedExplanation && entry.detailedExplanation !== entry.shortSummary) {
    drawParagraph(state, entry.detailedExplanation, {
      size: 8.5,
      color: COLOR.muted,
      spaceAfter: 5,
    });
  }

  if (entry.useCases?.length) {
    drawParagraph(state, "Casos de Uso:", {
      size: 8.2,
      font: state.bold,
      color: COLOR.brandDark,
      spaceAfter: 2,
    });
    drawBulletList(state, entry.useCases);
  }

  if (entry.businessRules?.length) {
    drawParagraph(state, "Regras de Negócio:", {
      size: 8.2,
      font: state.bold,
      color: COLOR.brand,
      spaceAfter: 2,
    });
    drawBulletList(state, entry.businessRules);
  }

  if (entry.params.length > 0) {
    drawParagraph(state, "Parâmetros / Argumentos:", {
      size: 8.2,
      font: state.bold,
      color: COLOR.brandDark,
      spaceAfter: 3,
    });
    drawTable(
      state,
      ["Nome", "Local / Tipo", "Obrig.", "Descrição"],
      entry.params.map((p) => [
        p.name,
        `${p.location} | ${p.type}${p.defaultValue ? ` (padrão: ${p.defaultValue})` : ""}`,
        p.required ? "Sim" : "Não",
        p.example ? `${p.description} Ex: ${p.example}` : p.description,
      ]),
      [115, 118, 38, CONTENT_W - 271],
    );
  }

  if (entry.responseFields.length > 0) {
    drawParagraph(state, "Campos de Retorno JSON:", {
      size: 8.2,
      font: state.bold,
      color: COLOR.brandDark,
      spaceAfter: 3,
    });
    drawTable(
      state,
      ["Campo", "Tipo", "Significado"],
      entry.responseFields.map((f) => [f.name, f.type, f.description]),
      [145, 92, CONTENT_W - 237],
    );
  }

  // Exemplos de chamada
  const curl = buildCurlSnippet({
    entry,
    baseUrl: options.baseUrl,
    token: TOKEN_PLACEHOLDER,
  });
  drawCodeBlock(state, "Exemplo cURL:", curl);

  if (entry.kind === "rest" || entry.kind === "mcp") {
    const py = buildPythonSnippet({
      entry,
      tenantId: options.tenantId,
      baseUrl: options.baseUrl,
      token: TOKEN_PLACEHOLDER,
      useEnvVars: true,
    });
    drawCodeBlock(state, "Exemplo Python (requests + .env):", py);

    if (options.includeNodeSnippet) {
      const node = buildNodeSnippet({
        entry,
        tenantId: options.tenantId,
        baseUrl: options.baseUrl,
        token: TOKEN_PLACEHOLDER,
      });
      drawCodeBlock(state, "Exemplo Node.js / TypeScript:", node);
    }
  }

  if (entry.sampleRequestPayload) {
    drawCodeBlock(
      state,
      "Exemplo de Payload Recebido / Enviado (Request JSON):",
      JSON.stringify(entry.sampleRequestPayload, null, 2),
    );
  }

  drawCodeBlock(
    state,
    "Exemplo de Resposta (200 OK JSON):",
    JSON.stringify(entry.sampleResponsePayload, null, 2),
  );

  state.y -= 8;
}

/**
 * Gera o documento PDF binário completo (`application/pdf`) contendo TODA a Biblioteca
 * de API REST, Conector MCP (todas as ferramentas), Webhooks, Regras Globais, Setores
 * e Exemplos Prontos — 100% isolado pelo `tenantId` autenticado.
 */
export async function buildCompleteApiLibraryPdf(
  options: ApiLibraryExportOptions,
): Promise<Uint8Array> {
  const { tenantId } = options;
  const cleanBase = options.baseUrl.replace(/\/+$/, "");
  const persona = getAiPersona(tenantId);
  const companyLabel = tenantId === "valem" ? "Valem" : "Tecfag";
  const generatedStr = formatSaoPauloTimestamp(options.generatedAt ?? new Date());
  const inventory = buildUnifiedLibraryInventory(tenantId);

  const doc = await PDFDocument.create();
  doc.setTitle(
    sanitizePdfText(`Biblioteca Oficial de APIs, Conector MCP (${persona.name}) & Webhooks - ${companyLabel}`),
  );
  doc.setAuthor(sanitizePdfText(persona.company));
  doc.setSubject(
    sanitizePdfText("Documentação Técnica Completa: API REST v1, Conector MCP, Webhooks e Segurança Multi-Tenant"),
  );
  doc.setKeywords(["API REST", "MCP", "Webhooks", companyLabel, persona.name]);
  doc.setCreationDate(options.generatedAt ?? new Date());

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const monoBold = await doc.embedFont(StandardFonts.CourierBold);

  const state: PdfWriterState = {
    doc,
    pages: [],
    page: null as unknown as PDFPage,
    y: TOP_Y,
    regular,
    bold,
    mono,
    monoBold,
    headerTitle: `Biblioteca de API, MCP & Webhooks | ${companyLabel} (${persona.name})`,
    sectionLabel: "Capa",
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CAPA EXECUTIVA (PÁGINA 1)
  // ═══════════════════════════════════════════════════════════════════════════
  addPage(state);
  const cover = state.page;

  // Faixa superior escura da capa
  cover.drawRectangle({
    x: 0,
    y: PAGE_H - 255,
    width: PAGE_W,
    height: 255,
    color: COLOR.brandDark,
  });
  cover.drawRectangle({
    x: 0,
    y: PAGE_H - 260,
    width: PAGE_W,
    height: 5,
    color: COLOR.brand,
  });

  // Tag superior
  cover.drawRectangle({
    x: MARGIN_X,
    y: PAGE_H - 72,
    width: 218,
    height: 18,
    color: COLOR.brand,
  });
  cover.drawText(sanitizePdfText("DEVELOPER PORTAL | DOCUMENTAÇÃO OFICIAL"), {
    x: MARGIN_X + 8,
    y: PAGE_H - 66,
    size: 8,
    font: bold,
    color: COLOR.white,
  });

  // Título Principal
  const coverTitleLines = wrapTextToLines(
    `Biblioteca Completa de API REST, Conector MCP (${persona.name}) & Webhooks`,
    bold,
    22,
    CONTENT_W,
  );
  let cy = PAGE_H - 114;
  for (const line of coverTitleLines) {
    cover.drawText(line, {
      x: MARGIN_X,
      y: cy,
      size: 22,
      font: bold,
      color: COLOR.white,
    });
    cy -= 28;
  }

  cover.drawText(
    sanitizePdfText(
      `Referência técnica integral de integração, extração em massa, ferramentas IA e eventos em tempo real — ${persona.company}.`,
    ),
    {
      x: MARGIN_X,
      y: cy - 6,
      size: 9.5,
      font: regular,
      color: rgb(0.8, 0.84, 0.9),
    },
  );

  // Cards de resumo numérico (4 colunas)
  const kpis = [
    { label: "ROTAS API REST", value: String(inventory.restEntries.length), sub: "/api/v1/marketing/*" },
    { label: "FERRAMENTAS MCP IA", value: String(inventory.mcpEntries.length), sub: `${inventory.liveMcpCount} ativas em /api/mcp` },
    { label: "WEBHOOKS & WS", value: String(inventory.webhookEntries.length), sub: "Entrada, Saída & Site" },
    { label: "SETORES OFICIAIS", value: String(Object.keys(MARKETING_SECTOR_LABELS).length), sub: "Dicionário Canônico" },
  ];
  const cardGap = 10;
  const cardW = (CONTENT_W - cardGap * 3) / 4;
  const cardTopY = PAGE_H - 290;
  const cardH = 66;

  for (let i = 0; i < kpis.length; i++) {
    const x = MARGIN_X + i * (cardW + cardGap);
    cover.drawRectangle({
      x,
      y: cardTopY - cardH,
      width: cardW,
      height: cardH,
      color: COLOR.surface,
      borderColor: COLOR.border,
      borderWidth: 0.8,
    });
    cover.drawText(sanitizePdfText(kpis[i].label), {
      x: x + 8,
      y: cardTopY - 16,
      size: 6.8,
      font: bold,
      color: COLOR.muted,
    });
    cover.drawText(kpis[i].value, {
      x: x + 8,
      y: cardTopY - 40,
      size: 20,
      font: bold,
      color: COLOR.brand,
    });
    cover.drawText(sanitizePdfText(kpis[i].sub), {
      x: x + 8,
      y: cardTopY - 56,
      size: 7,
      font: regular,
      color: COLOR.muted,
    });
  }

  // Quadro de metadados do ambiente
  const metaY = cardTopY - cardH - 24;
  const metaH = 106;
  cover.drawRectangle({
    x: MARGIN_X,
    y: metaY - metaH,
    width: CONTENT_W,
    height: metaH,
    color: COLOR.white,
    borderColor: COLOR.border,
    borderWidth: 0.8,
  });
  const metaRows: [string, string][] = [
    ["Silo Multi-Tenant:", `${persona.company} (tenant_id = "${tenantId}")`],
    ["Persona IA Vinculada:", `${persona.name} (Conector MCP & Triagem SDR)`],
    ["Base URL do Servidor:", cleanBase],
    ["Data/Hora de Emissão:", `${generatedStr} (America/Sao_Paulo)`],
    ["Segurança de Credenciais:", "Tokens reais omitidos (<SEU_API_TOKEN>) para compartilhamento seguro."],
  ];
  let my = metaY - 19;
  for (const [k, v] of metaRows) {
    cover.drawText(sanitizePdfText(k), {
      x: MARGIN_X + 12,
      y: my,
      size: 8.5,
      font: bold,
      color: COLOR.brandDark,
    });
    cover.drawText(sanitizePdfText(v), {
      x: MARGIN_X + 148,
      y: my,
      size: 8.5,
      font: k.includes("URL") ? mono : regular,
      color: COLOR.ink,
    });
    my -= 18;
  }

  // Sumário Estruturado na Capa
  state.y = metaY - metaH - 26;
  drawSubHeading(state, "Sumário Completo do Documento");
  drawBulletList(state, [
    "Seção 1: Arquitetura Multi-Tenant, Autenticação Bearer/x-api-key, Paginação por Cursor, Regras Canônicas de Venda, Dicionário Oficial de Setores e Códigos HTTP.",
    `Seção 2: API REST v1 (/api/v1/marketing/*) — Todas as ${inventory.restEntries.length} rotas documentadas com parâmetros, campos JSON, exemplos cURL, Python, Node.js e respostas.`,
    `Seção 3: Conector MCP (/api/mcp) — Protocolo JSON-RPC 2.0, Streamable HTTP, SSE, Query Direta, configuração Claude/Antigravity/Cursor e todas as ${inventory.mcpEntries.length} ferramentas MCP.`,
    `Seção 4: Webhooks & Canais em Tempo Real — Todos os ${inventory.webhookEntries.length} endpoints (RD Station Marketing Conversões e Jornada, Meta Cloud API/CTWA, WebSocket LiveChat e Webhook Hub HMAC).`,
    "Seção 5: Boas Práticas de Sincronização Incremental, Cruzamento CRM x ERP x Mídia Paga e Checklist de Segurança.",
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SEÇÃO 1 — ARQUITETURA, AUTENTICAÇÃO & REGRAS GLOBAIS
  // ═══════════════════════════════════════════════════════════════════════════
  state.sectionLabel = "1. Arquitetura, Autenticação & Regras Globais";
  addPage(state);
  drawSectionBanner(
    state,
    "1",
    "Arquitetura, Autenticação & Regras Globais",
    `Silo isolado ${companyLabel}, autenticação por chave, paginação determinística e dicionário oficial`,
  );

  drawSubHeading(state, "1.1 Autenticação, Silo Multi-Tenant & Variáveis de Ambiente");
  drawBulletList(state, [
    `Envie Authorization: Bearer ${TOKEN_PLACEHOLDER} (ou x-api-key: ${TOKEN_PLACEHOLDER}) em todas as requisições REST e MCP.`,
    `O token trava automaticamente o tenant_id = "${tenantId}" no servidor. Qualquer tentativa de consultar outro tenant retorna HTTP 403 Forbidden.`,
    "As rotas REST (/api/v1/marketing/*) e o Conector MCP (/api/mcp) compartilham exatamente o mesmo motor canônico de dados para garantir 100% de paridade numérica.",
  ]);

  drawCodeBlock(
    state,
    "Arquivo .env recomendado (nunca versionar no Git):",
    buildEnvSnippet({ tenantId, baseUrl: cleanBase, token: TOKEN_PLACEHOLDER }),
  );

  drawSubHeading(state, "1.2 Paginação Determinística & Extração Incremental");
  drawBulletList(state, [
    "Todas as rotas de listagem em massa suportam até limit=1000 registros por página (padrão 200), ordenados deterministicamente por (updated_at, id).",
    "Enquanto pagination.has_more for true, envie cursor=pagination.next_cursor na chamada seguinte — sem risco de duplicar ou pular registros durante atualizações concorrentes.",
    "Use updated_since=YYYY-MM-DD (ou ISO 8601) para sincronizações incrementais rápidas de poucos segundos.",
  ]);

  drawSubHeading(state, "1.3 Regras Canônicas de Negócio");
  drawBulletList(state, [
    "Regra Única de Venda (win = true): inclui status='won' e negociações abertas posicionadas nas etapas comerciais FECHAMENTO ou VENDA CONCLUÍDA (excluindo etapas administrativas de Suporte/Financeiro).",
    "Setor Imutável (sector_origin) vs. Atual (sector_current): nasce pre_venda no SDR e trava permanentemente no 1º setor comercial definitivo (semi_industrial, personnalite, projetos, pecas).",
    "Taxonomia de Origens: deal_source_name padronizada igual ao RD (Busca Paga | Google, Busca Paga | Meta, etc.); campaign_name guarda o ponto de conversão (formulário/LP/CTWA); entry_channel isola a porta técnica.",
    "Filtros Padrão: include_tests=false (exclui testes automaticamente), include_legacy=true (preserva arquivo histórico migrado do RD com id_rd) e metadata_only=true em /messages.",
  ]);

  drawSubHeading(state, "1.4 Dicionário Oficial de Setores (sector_origin / sector_current)");
  drawTable(
    state,
    ["Código Oficial", "Rótulo Legível"],
    Object.entries(MARKETING_SECTOR_LABELS).map(([code, label]) => [code, label]),
    [180, CONTENT_W - 180],
  );

  drawSubHeading(state, "1.5 Códigos HTTP & Tratamento de Erros");
  drawTable(
    state,
    ["Código", "Significado", "Ação Recomendada"],
    [
      ["200 / 201 / 202", "Sucesso / Aceito", "Processar corpo JSON normalmente."],
      ["400 Bad Request", "Parâmetro inválido", "Verificar formatos de data (YYYY-MM-DD) e obrigatórios."],
      ["401 Unauthorized", "Token inválido ou pausado", "Conferir .env e status da chave em Conector MCP."],
      ["403 Forbidden", "Cross-tenant / sem permissão", "Confirmar que a chave pertence ao tenant correto."],
      ["404 Not Found", "Registro inexistente", "Validar se o ID existe no tenant autenticado."],
      ["429 Too Many Req.", "Limite de taxa atingido", "Aplicar backoff exponencial entre requisições."],
      ["500 Server Error", "Erro interno inesperado", "Aplicar retry e verificar logs/auditoria do servidor."],
    ],
    [95, 145, CONTENT_W - 240],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // SEÇÃO 2 — TODAS AS ROTAS API REST (/api/v1/marketing/*)
  // ═══════════════════════════════════════════════════════════════════════════
  state.sectionLabel = `2. API REST v1 (/api/v1/marketing/*) — ${inventory.restEntries.length} Rotas`;
  addPage(state);
  drawSectionBanner(
    state,
    "2",
    `API REST v1 (/api/v1/marketing/*) — ${inventory.restEntries.length} Rotas`,
    "Extração em massa de negociações, etapas, contatos, conversas, mensagens, atividades, triagens, metas e auditoria",
  );

  drawTable(
    state,
    ["Rota REST", "Método", "Finalidade"],
    inventory.restEntries.map((e) => [e.pathOrTool, e.method, e.title]),
    [190, 46, CONTENT_W - 236],
  );

  for (const entry of inventory.restEntries) {
    renderCatalogEntryDetails(state, entry, {
      tenantId,
      baseUrl: cleanBase,
      includeNodeSnippet: true,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEÇÃO 3 — CONECTOR MCP (/api/mcp — JSON-RPC 2.0, HTTP & SSE)
  // ═══════════════════════════════════════════════════════════════════════════
  state.sectionLabel = `3. Conector MCP (/api/mcp) — ${inventory.mcpEntries.length} Ferramentas IA`;
  addPage(state);
  drawSectionBanner(
    state,
    "3",
    `Conector MCP (/api/mcp) — ${inventory.mcpEntries.length} Ferramentas IA`,
    `Protocolo JSON-RPC 2.0, Streamable HTTP, SSE e catálogo integral de ferramentas (${persona.name})`,
  );

  drawSubHeading(state, "3.1 Protocolo, Transportes e Configuração em Clientes de IA");
  drawBulletList(state, [
    `Endpoint Único: ${cleanBase}/api/mcp — suporta Streamable HTTP (POST), Server-Sent Events / SSE (GET com Accept: text/event-stream) e Execução Direta via GET (?token=...&tool=<nome>).`,
    "Métodos JSON-RPC 2.0 aceitos: initialize, notifications/initialized, tools/list, tools/call e ping.",
    "Autenticação aceita: header Authorization: Bearer <TOKEN>, header x-mcp-token: <TOKEN> ou query string ?token=<TOKEN>.",
    "Gestão de Sessão: o servidor retorna o cabeçalho Mcp-Session-Id (exposto via CORS) com TTL de 12h e revogação imediata quando uma chave é pausada ou rotacionada.",
  ]);

  drawCodeBlock(
    state,
    "Configuração JSON para Claude Desktop / Claude.ai / Antigravity IDE / Cursor:",
    JSON.stringify(
      {
        mcpServers: {
          [`${tenantId}-crm`]: {
            url: `${cleanBase}/api/mcp?token=${TOKEN_PLACEHOLDER}`,
          },
        },
      },
      null,
      2,
    ),
  );

  drawCodeBlock(
    state,
    "Descoberta de ferramentas via cURL (tools/list):",
    [
      `curl -X POST "${cleanBase}/api/mcp" \\`,
      `  -H "Authorization: Bearer ${TOKEN_PLACEHOLDER}" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
    ].join("\n"),
  );

  drawSubHeading(state, "3.2 Índice Completo de Ferramentas MCP");
  drawTable(
    state,
    ["Ferramenta MCP", "Status", "Resumo"],
    inventory.mcpEntries.map(({ entry, liveInProduction }) => [
      entry.mcpToolName || entry.pathOrTool,
      liveInProduction ? "Ativa (/api/mcp)" : "Catálogo / Escrita",
      entry.shortSummary,
    ]),
    [155, 88, CONTENT_W - 243],
  );

  for (const { entry, liveInProduction } of inventory.mcpEntries) {
    renderCatalogEntryDetails(state, entry, {
      tenantId,
      baseUrl: cleanBase,
      statusBadge: liveInProduction ? "ATIVO EM /api/mcp" : "CATALOGO / ESCRITA",
      includeNodeSnippet: false,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEÇÃO 4 — WEBHOOKS & CANAIS EM TEMPO REAL
  // ═══════════════════════════════════════════════════════════════════════════
  state.sectionLabel = `4. Webhooks & Canais em Tempo Real — ${inventory.webhookEntries.length} Endpoints`;
  addPage(state);
  drawSectionBanner(
    state,
    "4",
    `Webhooks & Canais em Tempo Real — ${inventory.webhookEntries.length} Endpoints`,
    "RD Station Marketing (Conversões e Jornada), Meta Cloud API (WhatsApp/CTWA), LiveChat WebSocket e Webhook Hub HMAC",
  );

  drawTable(
    state,
    ["Endpoint / Canal", "Proto.", "Finalidade"],
    inventory.webhookEntries.map((e) => [e.pathOrTool, e.method, e.title]),
    [195, 42, CONTENT_W - 237],
  );

  for (const entry of inventory.webhookEntries) {
    renderCatalogEntryDetails(state, entry, {
      tenantId,
      baseUrl: cleanBase,
      includeNodeSnippet: false,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEÇÃO 5 — BOAS PRÁTICAS, CRUZAMENTO ERP & SEGURANÇA
  // ═══════════════════════════════════════════════════════════════════════════
  state.sectionLabel = "5. Boas Práticas, Cruzamento ERP & Segurança";
  addPage(state);
  drawSectionBanner(
    state,
    "5",
    "Boas Práticas, Cruzamento ERP & Segurança",
    "Diretrizes operacionais para pipelines Python/BI, conciliação financeira e governança de chaves",
  );

  drawSubHeading(state, "5.1 Estratégia Recomendada de Extração (Carga Inicial + Incremental)");
  drawBulletList(state, [
    "1) Health-Check inicial: chame GET /api/v1/marketing/ para validar o token, confirmar tenant_id e carregar dinamicamente o sectors_dictionary.",
    "2) Carga histórica: execute paginação com limit=1000 usando cursor=pagination.next_cursor até has_more=false.",
    "3) Carga diária incremental: passe updated_since com janela de segurança de 24h (ex: ontem) e faça UPSERT pelo campo id no seu Data Warehouse / BI.",
    "4) Volumetria de mensagens: mantenha o padrão metadata_only=true em /messages para máxima performance; use /audit-batch (lotes de 15 a 50 leads) quando precisar da transcrição completa.",
  ]);

  drawSubHeading(state, "5.2 Chaves Oficiais de Cruzamento (CRM x ERP x Mídia Paga)");
  drawTable(
    state,
    ["Chave", "Origem", "Uso no Cruzamento"],
    [
      ["id_rd", "/deals & /deal-stage-history", "Match direto 1:1 com campo 'Link CRM' do ERP e histórico legado do RD."],
      ["organization_cnpj", "/deals & /contacts", "CNPJ/CPF normalizado (somente dígitos) para conciliação de NF-e no ERP."],
      ["contacts_emails", "/deals & /contacts", "Lista deduplicada em minúsculas para cruzamento com RD Station Marketing."],
      ["contacts_phones_last9", "/deals & /contacts", "Últimos 9 dígitos do WhatsApp para parear leads mesmo sem DDI/DDD igual."],
      ["click_id / utm_*", "/deals & /messages", "Atribuição de mídia paga (gclid, fbclid, ctwa_clid, utm_campaign)."],
    ],
    [125, 130, CONTENT_W - 255],
  );

  drawSubHeading(state, "5.3 Checklist de Segurança & Governança");
  drawBulletList(state, [
    "Crie uma chave individual nomeada para cada script, dashboard ou parceiro em Configurações -> Conector MCP.",
    "Nunca exponha tokens em código-fonte, repositórios Git, planilhas públicas ou mensagens; use exclusivamente variáveis de ambiente (.env).",
    "Monitore latência, volume e eventuais bloqueios (401/403) na tabela de auditoria do Conector MCP.",
    "Para Webhooks de Saída (Webhook Hub), valide obrigatoriamente a assinatura HMAC-SHA256 recebida no cabeçalho X-Webhook-Signature antes de processar o payload.",
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RODAPÉ COM NUMERAÇÃO DE PÁGINAS EM TODAS AS PÁGINAS
  // ═══════════════════════════════════════════════════════════════════════════
  const totalPages = state.pages.length;
  for (let i = 0; i < totalPages; i++) {
    const p = state.pages[i];
    p.drawLine({
      start: { x: MARGIN_X, y: 34 },
      end: { x: PAGE_W - MARGIN_X, y: 34 },
      thickness: 0.5,
      color: COLOR.border,
    });
    const leftFooter = sanitizePdfText(
      `Confidencial | ${persona.company} (Silo ${tenantId}) | Emitido em ${generatedStr}`,
    );
    p.drawText(leftFooter, {
      x: MARGIN_X,
      y: 22,
      size: 7.2,
      font: regular,
      color: COLOR.lightMuted,
    });
    const rightFooter = sanitizePdfText(`Página ${i + 1} de ${totalPages}`);
    const rw = bold.widthOfTextAtSize(rightFooter, 7.5);
    p.drawText(rightFooter, {
      x: PAGE_W - MARGIN_X - rw,
      y: 22,
      size: 7.5,
      font: bold,
      color: COLOR.muted,
    });
  }

  return doc.save();
}
