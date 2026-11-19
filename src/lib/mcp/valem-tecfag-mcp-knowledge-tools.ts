import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  crmActionHistory,
  knowledgeFiles,
  knowledgeFolders,
  operators,
} from "../../db/schema";
import {
  ensureTecfagManualsKnowledgePopulated,
  findPreExtractedManualContent,
  getKnowledgeBaseContext,
  invalidateKnowledgeCache,
} from "../valentina/knowledge-service";
import {
  MAX_KNOWLEDGE_BASE64_BYTES,
  MAX_KNOWLEDGE_CONTENT_CHARS,
  composeKnowledgeStoredContent,
  extractKnowledgeText,
  formatKnowledgeSizeLabel,
  parseKnowledgeStoredContent,
  removeKnowledgeMediaFileSafe,
  resolveKnowledgeFileType,
  writeKnowledgeMediaFileSafe,
} from "../valentina/knowledge-extract";
import type { McpToolDefinition, McpWriteActorContext } from "./valem-tecfag-mcp-write-tools";

const TENANT_ID_PROP = {
  type: "string",
  enum: ["tecfag", "valem"],
  default: "tecfag",
  description:
    "Tenant alvo ('tecfag' ou 'valem'). Ignorado quando a chave MCP está travada em um tenant.",
};

export const MCP_KNOWLEDGE_TOOLS: McpToolDefinition[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE BASE — LEITURA (4 TOOLS)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "list_knowledge_folders",
    access: "read",
    description:
      "Lista as pastas da Base de Conhecimento (Knowledge) da IA do tenant com caminho hierárquico completo, contagem de arquivos e subpastas. Use antes de criar, mover ou inserir arquivos.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        parentId: {
          type: "string",
          description:
            "Opcional: filtra apenas pastas filhas de uma pasta específica. Use '__root__' para listar apenas pastas da raiz.",
        },
        search: {
          type: "string",
          description: "Opcional: filtra pastas cujo nome ou caminho contenha este texto.",
        },
      },
    },
  },
  {
    name: "search_knowledge_files",
    access: "read",
    description:
      "Lista e pesquisa arquivos da Base de Conhecimento (Knowledge) por nome, pasta (incluindo subpastas), tipo, formato ou conteúdo textual extraído, sem retornar blobs base64 pesados.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        query: {
          type: "string",
          description: "Texto para buscar no nome do arquivo e (opcionalmente) no conteúdo extraído.",
        },
        folderId: {
          type: "string",
          description:
            "Opcional: ID da pasta para filtrar. Use '__root__' para arquivos sem pasta vinculada.",
        },
        includeSubfolders: {
          type: "boolean",
          default: true,
          description:
            "Quando folderId é informado, inclui arquivos das subpastas descendentes (padrão: true).",
        },
        type: {
          type: "string",
          enum: ["pdf", "word", "image", "txt", "md", "xlsx", "csv", "json"],
          description: "Opcional: filtra por tipo de arquivo.",
        },
        format: {
          type: "string",
          enum: ["embeddings", "real"],
          description: "Opcional: filtra por formato ('embeddings' ou 'real').",
        },
        searchInContent: {
          type: "boolean",
          default: true,
          description: "Quando true (padrão), 'query' também pesquisa dentro do texto extraído.",
        },
        limit: {
          type: "number",
          default: 50,
          description: "Máximo de arquivos retornados (1 a 200, padrão: 50).",
        },
        offset: {
          type: "number",
          default: 0,
          description: "Deslocamento para paginação (padrão: 0).",
        },
      },
    },
  },
  {
    name: "get_knowledge_file_content",
    access: "read",
    description:
      "Lê o conteúdo textual completo (com suporte a paginação por offset/maxChars) de um arquivo da Base de Conhecimento pelo 'fileId' ou por 'name'.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        fileId: {
          type: "string",
          description: "ID do arquivo (knowledge_files.id). Opcional se 'name' for informado.",
        },
        name: {
          type: "string",
          description: "Nome exato do arquivo (alternativa ao fileId).",
        },
        folderId: {
          type: "string",
          description: "Opcional: desambigua quando a busca for por 'name'.",
        },
        includeBase64: {
          type: "boolean",
          default: false,
          description: "Quando true, inclui também o payload base64 original (se houver).",
        },
        offset: {
          type: "number",
          default: 0,
          description: "Posição inicial em caracteres para leitura paginada (padrão: 0).",
        },
        maxChars: {
          type: "number",
          default: 50000,
          description: "Máximo de caracteres retornados nesta chamada (padrão: 50000, máx: 200000).",
        },
      },
    },
  },
  {
    name: "query_knowledge_rag",
    access: "read",
    description:
      "Consulta o motor RAG real da IA do tenant e retorna exatamente o contexto recuperado da Base de Conhecimento para uma pergunta ou modelo de máquina. Útil para auditar o que a IA enxerga.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        tenantId: TENANT_ID_PROP,
        query: {
          type: "string",
          description: "Pergunta, código de máquina ou termo para simular a recuperação RAG.",
        },
        maxChars: {
          type: "number",
          default: 30000,
          description: "Limite máximo de caracteres no retorno (padrão: 30000, máx: 120000).",
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE BASE — ESCRITA (6 TOOLS)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "create_knowledge_folder",
    access: "write",
    description:
      "[ESCRITA] Cria uma pasta (ou subpasta via parentId) na Base de Conhecimento da IA. Idempotente por padrão: se já existir pasta com mesmo nome no mesmo nível, reutiliza e retorna reused=true.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        tenantId: TENANT_ID_PROP,
        name: { type: "string", description: "Nome da pasta a criar." },
        parentId: {
          type: ["string", "null"],
          description: "ID da pasta pai (opcional; null ou omitido cria na raiz).",
        },
        allowDuplicateName: {
          type: "boolean",
          default: false,
          description: "Quando false (padrão), reutiliza pasta existente com mesmo nome no mesmo parentId.",
        },
        operatorId: { type: "string", description: "ID do operador autor para auditoria (opcional)." },
        actorName: { type: "string", description: "Nome legível do autor para auditoria (opcional)." },
      },
    },
  },
  {
    name: "update_knowledge_folder",
    access: "write",
    description:
      "[ESCRITA] Renomeia e/ou move uma pasta existente da Base de Conhecimento (inclusive para a raiz passando parentId=null), com proteção automática contra ciclos hierárquicos.",
    inputSchema: {
      type: "object",
      required: ["folderId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        folderId: { type: "string", description: "ID da pasta (knowledge_folders.id)." },
        name: { type: "string", description: "Novo nome da pasta (opcional)." },
        parentId: {
          type: ["string", "null"],
          description: "Novo ID de pasta pai, ou null para mover para a raiz (opcional).",
        },
        operatorId: { type: "string", description: "ID do operador autor para auditoria (opcional)." },
        actorName: { type: "string", description: "Nome legível do autor para auditoria (opcional)." },
      },
    },
  },
  {
    name: "delete_knowledge_folder",
    access: "write",
    description:
      "[ESCRITA] Remove uma pasta da Base de Conhecimento. Se contiver arquivos ou subpastas, exige recursive=true (apaga toda a subárvore e mídias) OU moveFilesToFolderId (realoca itens para outra pasta ou null para raiz antes de excluir).",
    inputSchema: {
      type: "object",
      required: ["folderId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        folderId: { type: "string", description: "ID da pasta a excluir." },
        recursive: {
          type: "boolean",
          default: false,
          description: "Quando true, exclui em cascata todas as subpastas e arquivos internos.",
        },
        moveFilesToFolderId: {
          type: ["string", "null"],
          description:
            "Alternativa segura ao recursive: realoca arquivos e subpastas diretas para este folderId (ou null para raiz) antes de apagar a pasta.",
        },
        operatorId: { type: "string", description: "ID do operador autor para auditoria (opcional)." },
        actorName: { type: "string", description: "Nome legível do autor para auditoria (opcional)." },
      },
    },
  },
  {
    name: "upsert_knowledge_file",
    access: "write",
    description:
      "[ESCRITA] Insere um novo arquivo na Base de Conhecimento (ou sobrescreve arquivo existente de mesmo nome na mesma pasta quando overwriteExisting=true). Aceita texto puro (content) e/ou arquivo binário em base64 (PDF, Word, Excel, CSV, TXT, MD, JSON ou imagem) com extração automática de texto e suporte a Formato Real.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        tenantId: TENANT_ID_PROP,
        name: {
          type: "string",
          description: "Nome do arquivo com extensão (ex: 'Manual_FR900.md', 'Tabela_Precos.txt', 'Catalogo.pdf').",
        },
        folderId: {
          type: ["string", "null"],
          description: "ID da pasta destino (opcional; null ou omitido salva na raiz).",
        },
        content: {
          type: "string",
          description: "Conteúdo textual direto do documento (máx. 200.000 caracteres).",
        },
        base64: {
          type: "string",
          description:
            "Opcional: conteúdo binário do arquivo codificado em base64 (aceita data URL ou base64 puro, máx. 15 MB) para extração de PDF/DOCX/XLSX/CSV/TXT ou upload de imagem.",
        },
        type: {
          type: "string",
          enum: ["pdf", "word", "image", "txt", "md", "xlsx", "csv", "json"],
          description: "Tipo do arquivo (opcional; inferido automaticamente pela extensão do nome).",
        },
        format: {
          type: "string",
          enum: ["embeddings", "real"],
          description:
            "Formato de armazenamento: 'embeddings' (padrão para textos/manuais) ou 'real' (salva mídia física; automático para imagens com base64).",
        },
        size: {
          type: "string",
          description: "Rótulo de tamanho (opcional; calculado automaticamente se omitido).",
        },
        overwriteExisting: {
          type: "boolean",
          default: true,
          description:
            "Quando true (padrão), atualiza arquivo existente com o mesmo nome na mesma pasta. Quando false, cria sempre um novo registro.",
        },
        operatorId: { type: "string", description: "ID do operador autor para auditoria (opcional)." },
        actorName: { type: "string", description: "Nome legível do autor para auditoria (opcional)." },
      },
    },
  },
  {
    name: "update_knowledge_file",
    access: "write",
    description:
      "[ESCRITA] Edita um arquivo existente da Base de Conhecimento por 'fileId': permite renomear, mover de pasta, substituir todo o texto (content), anexar texto (appendContent), fazer substituição cirúrgica de trecho (replaceTarget + replaceWith) ou substituir binário (base64), preservando automaticamente metadados de Formato Real.",
    inputSchema: {
      type: "object",
      required: ["fileId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        fileId: { type: "string", description: "ID do arquivo (knowledge_files.id)." },
        name: { type: "string", description: "Novo nome do arquivo (opcional)." },
        folderId: {
          type: ["string", "null"],
          description: "Novo ID da pasta destino, ou null para mover para a raiz (opcional).",
        },
        content: {
          type: "string",
          description: "Novo texto integral do arquivo (substitui o texto atual).",
        },
        appendContent: {
          type: "string",
          description: "Texto adicional anexado ao final do conteúdo atual (separado por quebra de linha).",
        },
        replaceTarget: {
          type: "string",
          description: "Trecho exato a localizar no texto atual para substituição cirúrgica (requer replaceWith).",
        },
        replaceWith: {
          type: "string",
          description: "Texto substituto para replaceTarget (pode ser string vazia para remover o trecho).",
        },
        replaceAll: {
          type: "boolean",
          default: false,
          description: "Quando true, substitui todas as ocorrências de replaceTarget (padrão: apenas a primeira).",
        },
        base64: {
          type: "string",
          description: "Novo conteúdo binário em base64 (re-extrai texto e atualiza mídia real se aplicável).",
        },
        type: {
          type: "string",
          enum: ["pdf", "word", "image", "txt", "md", "xlsx", "csv", "json"],
          description: "Novo tipo do arquivo (opcional).",
        },
        format: {
          type: "string",
          enum: ["embeddings", "real"],
          description: "Novo formato do arquivo (opcional).",
        },
        size: { type: "string", description: "Novo rótulo de tamanho (opcional)." },
        operatorId: { type: "string", description: "ID do operador autor para auditoria (opcional)." },
        actorName: { type: "string", description: "Nome legível do autor para auditoria (opcional)." },
      },
    },
  },
  {
    name: "delete_knowledge_file",
    access: "write",
    description:
      "[ESCRITA] Remove um arquivo ('fileId') ou lote de até 50 arquivos ('fileIds') da Base de Conhecimento do tenant, limpando também arquivos físicos de Formato Real e invalidando o cache da IA.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        fileId: { type: "string", description: "ID de um arquivo único a excluir." },
        fileIds: {
          type: "array",
          items: { type: "string" },
          maxItems: 50,
          description: "Lista de até 50 IDs de arquivos a excluir em lote.",
        },
        operatorId: { type: "string", description: "ID do operador autor para auditoria (opcional)." },
        actorName: { type: "string", description: "Nome legível do autor para auditoria (opcional)." },
      },
    },
  },
];

export const MCP_KNOWLEDGE_TOOL_LABELS_PT: Record<string, string> = {
  list_knowledge_folders: "Listar Pastas do Knowledge (Base de Conhecimento)",
  search_knowledge_files: "Pesquisar Arquivos do Knowledge (Base de Conhecimento)",
  get_knowledge_file_content: "Ler Conteúdo de Arquivo do Knowledge",
  query_knowledge_rag: "Consultar Contexto RAG do Knowledge",
  create_knowledge_folder: "Criar Pasta no Knowledge",
  update_knowledge_folder: "Editar / Mover Pasta no Knowledge",
  delete_knowledge_folder: "Excluir Pasta do Knowledge",
  upsert_knowledge_file: "Inserir / Atualizar Arquivo no Knowledge",
  update_knowledge_file: "Editar / Mover Arquivo no Knowledge",
  delete_knowledge_file: "Excluir Arquivo(s) do Knowledge",
};

const KNOWLEDGE_TOOL_NAMES = new Set(MCP_KNOWLEDGE_TOOLS.map((t) => t.name));

export function isKnowledgeMcpTool(name: string): boolean {
  return KNOWLEDGE_TOOL_NAMES.has(name);
}

function asTrimmedString(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  return trimmed.length ? trimmed : undefined;
}

function normalizeSearchText(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function buildFolderMaps(
  folders: Array<{ id: string; name: string; parentId: string | null; createdAt: Date }>,
) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const childrenByParent = new Map<string | null, string[]>();
  for (const f of folders) {
    const key = f.parentId && byId.has(f.parentId) ? f.parentId : null;
    const list = childrenByParent.get(key) || [];
    list.push(f.id);
    childrenByParent.set(key, list);
  }

  const getPathAndDepth = (folderId: string): { path: string; depth: number } => {
    const parts: string[] = [];
    const visited = new Set<string>();
    let curr: string | null = folderId;
    while (curr && !visited.has(curr)) {
      visited.add(curr);
      const node = byId.get(curr);
      if (!node) break;
      parts.unshift(node.name);
      curr = node.parentId && byId.has(node.parentId) ? node.parentId : null;
    }
    return { path: parts.join(" / "), depth: Math.max(0, parts.length - 1) };
  };

  const getDescendantIds = (rootFolderId: string): Set<string> => {
    const result = new Set<string>();
    const stack = [rootFolderId];
    while (stack.length > 0) {
      const curr = stack.pop()!;
      if (result.has(curr)) continue;
      result.add(curr);
      const children = childrenByParent.get(curr) || [];
      for (const childId of children) {
        if (!result.has(childId)) stack.push(childId);
      }
    }
    return result;
  };

  return { byId, childrenByParent, getPathAndDepth, getDescendantIds };
}

function normalizeBase64Payload(rawBase64: string): { cleanBase64: string; byteLength: number } {
  const trimmed = rawBase64.trim();
  const cleanBase64 = trimmed.includes(";base64,")
    ? trimmed.slice(trimmed.indexOf(";base64,") + ";base64,".length).trim()
    : trimmed;
  if (!cleanBase64) {
    throw new Error("Campo 'base64' está vazio.");
  }
  const approxBytes = Math.floor((cleanBase64.length * 3) / 4);
  if (approxBytes > MAX_KNOWLEDGE_BASE64_BYTES) {
    throw new Error(
      `Payload 'base64' excede o limite máximo de ${Math.round(MAX_KNOWLEDGE_BASE64_BYTES / (1024 * 1024))} MB.`,
    );
  }
  const buf = Buffer.from(cleanBase64, "base64");
  if (buf.length > MAX_KNOWLEDGE_BASE64_BYTES) {
    throw new Error(
      `Arquivo decodificado excede o limite máximo de ${Math.round(MAX_KNOWLEDGE_BASE64_BYTES / (1024 * 1024))} MB.`,
    );
  }
  return { cleanBase64, byteLength: buf.length };
}

async function resolveActor(
  tenantId: "tecfag" | "valem",
  args: Record<string, unknown>,
  actor: McpWriteActorContext,
): Promise<{ operatorId: string | null; actorName: string }> {
  const explicitOpId = asTrimmedString(args.operatorId);
  const explicitName = asTrimmedString(args.actorName);
  if (explicitOpId) {
    const [op] = await db
      .select({ id: operators.id, name: operators.name })
      .from(operators)
      .where(and(eq(operators.id, explicitOpId), eq(operators.tenantId, tenantId)))
      .limit(1);
    if (op) {
      return { operatorId: op.id, actorName: explicitName || op.name };
    }
  }
  const fallbackName = explicitName || `MCP (${actor.keyLabel || "API"})`;
  return { operatorId: null, actorName: fallbackName };
}

async function recordKnowledgeAudit(params: {
  tenantId: "tecfag" | "valem";
  operatorId: string | null;
  operatorName: string;
  action: string;
  entityType: "knowledge_folder" | "knowledge_file";
  itemCount: number;
  details: Record<string, unknown>;
  actor: McpWriteActorContext;
}) {
  try {
    await db.insert(crmActionHistory).values({
      id: crypto.randomUUID(),
      tenantId: params.tenantId,
      operatorId: params.operatorId,
      operatorName: params.operatorName,
      action: params.action,
      entityType: params.entityType,
      itemCount: params.itemCount,
      details: {
        ...params.details,
        source: "mcp",
        keyId: params.actor.keyId || null,
        keyLabel: params.actor.keyLabel || null,
      },
      createdAt: new Date(),
    });
  } catch (err) {
    console.warn("[mcp-knowledge] Falha ao gravar auditoria em crm_action_history:", err);
  }
}

function buildContentSnippet(text: string, query: string, maxLen = 280): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (!query) {
    return clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : clean;
  }
  const normText = normalizeSearchText(clean);
  const normQuery = normalizeSearchText(query);
  const idx = normText.indexOf(normQuery);
  if (idx === -1) {
    return clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : clean;
  }
  const start = Math.max(0, idx - 80);
  const end = Math.min(clean.length, idx + query.length + 180);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < clean.length ? "…" : "";
  return `${prefix}${clean.slice(start, end)}${suffix}`;
}

export async function executeKnowledgeMcpTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: "tecfag" | "valem",
  actor: McpWriteActorContext,
): Promise<unknown> {
  switch (name) {
    // ── 1. list_knowledge_folders ─────────────────────────────────────────────
    case "list_knowledge_folders": {
      if (tenantId === "tecfag") {
        void ensureTecfagManualsKnowledgePopulated(tenantId).catch(() => {});
      }

      const [folders, files] = await Promise.all([
        db
          .select()
          .from(knowledgeFolders)
          .where(eq(knowledgeFolders.tenantId, tenantId))
          .orderBy(asc(knowledgeFolders.name)),
        db
          .select({
            id: knowledgeFiles.id,
            folderId: knowledgeFiles.folderId,
          })
          .from(knowledgeFiles)
          .where(eq(knowledgeFiles.tenantId, tenantId)),
      ]);

      const { childrenByParent, getPathAndDepth } = buildFolderMaps(folders);
      const fileCountByFolder = new Map<string | null, number>();
      for (const f of files) {
        const key = f.folderId || null;
        fileCountByFolder.set(key, (fileCountByFolder.get(key) || 0) + 1);
      }

      const parentIdFilter = asTrimmedString(args.parentId);
      const searchFilter = asTrimmedString(args.search);
      const normSearch = searchFilter ? normalizeSearchText(searchFilter) : null;

      let mapped = folders.map((f) => {
        const { path: folderPath, depth } = getPathAndDepth(f.id);
        return {
          id: f.id,
          name: f.name,
          parentId: f.parentId,
          path: folderPath,
          depth,
          fileCount: fileCountByFolder.get(f.id) || 0,
          subFolderCount: (childrenByParent.get(f.id) || []).length,
          createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : String(f.createdAt),
        };
      });

      if (parentIdFilter) {
        if (parentIdFilter === "__root__") {
          mapped = mapped.filter((f) => !f.parentId);
        } else {
          mapped = mapped.filter((f) => f.parentId === parentIdFilter);
        }
      }

      if (normSearch) {
        mapped = mapped.filter(
          (f) =>
            normalizeSearchText(f.name).includes(normSearch) ||
            normalizeSearchText(f.path).includes(normSearch),
        );
      }

      mapped.sort((a, b) => a.path.localeCompare(b.path, "pt-BR"));

      return {
        tenantId,
        totalFolders: mapped.length,
        totalFilesInTenant: files.length,
        rootFilesCount: fileCountByFolder.get(null) || 0,
        folders: mapped,
      };
    }

    // ── 2. search_knowledge_files ─────────────────────────────────────────────
    case "search_knowledge_files": {
      const query = asTrimmedString(args.query) || "";
      const folderIdFilter = asTrimmedString(args.folderId);
      const includeSubfolders = args.includeSubfolders !== false;
      const typeFilter = asTrimmedString(args.type)?.toLowerCase();
      const formatFilter = asTrimmedString(args.format)?.toLowerCase();
      const searchInContent = args.searchInContent !== false;
      const limit = Math.min(200, Math.max(1, Number(args.limit) || 50));
      const offset = Math.max(0, Number(args.offset) || 0);

      const [folders, allFiles] = await Promise.all([
        db
          .select()
          .from(knowledgeFolders)
          .where(eq(knowledgeFolders.tenantId, tenantId)),
        db
          .select({
            id: knowledgeFiles.id,
            folderId: knowledgeFiles.folderId,
            name: knowledgeFiles.name,
            size: knowledgeFiles.size,
            type: knowledgeFiles.type,
            format: knowledgeFiles.format,
            content: knowledgeFiles.content,
            uploadedAt: knowledgeFiles.uploadedAt,
          })
          .from(knowledgeFiles)
          .where(eq(knowledgeFiles.tenantId, tenantId))
          .orderBy(desc(knowledgeFiles.uploadedAt)),
      ]);

      const { byId, getPathAndDepth, getDescendantIds } = buildFolderMaps(folders);
      let allowedFolderIds: Set<string> | null = null;
      if (folderIdFilter && folderIdFilter !== "__root__") {
        if (!byId.has(folderIdFilter)) {
          throw new Error(
            `Pasta '${folderIdFilter}' não encontrada na Base de Conhecimento do tenant '${tenantId}'.`,
          );
        }
        allowedFolderIds = includeSubfolders
          ? getDescendantIds(folderIdFilter)
          : new Set([folderIdFilter]);
      }

      const normQuery = query ? normalizeSearchText(query) : "";
      const matched: Array<{
        score: number;
        item: Record<string, unknown>;
      }> = [];

      for (const f of allFiles) {
        if (folderIdFilter === "__root__" && f.folderId !== null) continue;
        if (allowedFolderIds && (!f.folderId || !allowedFolderIds.has(f.folderId))) continue;
        if (typeFilter && f.type.toLowerCase() !== typeFilter) continue;
        if (formatFilter && f.format.toLowerCase() !== formatFilter) continue;

        const parsed = parseKnowledgeStoredContent(f.content);
        const folderNode = f.folderId ? byId.get(f.folderId) : undefined;
        const folderPath = f.folderId && folderNode ? getPathAndDepth(f.folderId).path : null;

        let score = 1;
        if (normQuery) {
          const nameMatch = normalizeSearchText(f.name).includes(normQuery);
          const pathMatch = folderPath ? normalizeSearchText(folderPath).includes(normQuery) : false;
          const contentMatch =
            searchInContent && parsed.textContent
              ? normalizeSearchText(parsed.textContent).includes(normQuery)
              : false;
          if (!nameMatch && !pathMatch && !contentMatch) continue;
          score = (nameMatch ? 10 : 0) + (pathMatch ? 4 : 0) + (contentMatch ? 3 : 0);
        }

        matched.push({
          score,
          item: {
            id: f.id,
            name: f.name,
            folderId: f.folderId,
            folderName: folderNode?.name ?? null,
            folderPath,
            size: f.size,
            type: f.type,
            format: f.format,
            mediaUrl: parsed.mediaUrl,
            hasBase64: Boolean(parsed.base64),
            contentLength: parsed.textContent.length,
            snippet: buildContentSnippet(parsed.textContent, query),
            uploadedAt:
              f.uploadedAt instanceof Date ? f.uploadedAt.toISOString() : String(f.uploadedAt),
          },
        });
      }

      if (normQuery) {
        matched.sort((a, b) => b.score - a.score);
      }

      const sliced = matched.slice(offset, offset + limit).map((m) => m.item);

      return {
        tenantId,
        query: query || null,
        folderId: folderIdFilter || null,
        totalMatched: matched.length,
        offset,
        limit,
        returnedCount: sliced.length,
        hasMore: offset + sliced.length < matched.length,
        files: sliced,
      };
    }

    // ── 3. get_knowledge_file_content ─────────────────────────────────────────
    case "get_knowledge_file_content": {
      const fileId = asTrimmedString(args.fileId);
      const fileName = asTrimmedString(args.name);
      const folderId = asTrimmedString(args.folderId);
      const includeBase64 = Boolean(args.includeBase64);
      const offset = Math.max(0, Number(args.offset) || 0);
      const maxChars = Math.min(
        MAX_KNOWLEDGE_CONTENT_CHARS,
        Math.max(100, Number(args.maxChars) || 50_000),
      );

      if (!fileId && !fileName) {
        throw new Error("Informe 'fileId' ou 'name' para ler um arquivo do Knowledge.");
      }

      const conditions = [eq(knowledgeFiles.tenantId, tenantId)];
      if (fileId) {
        conditions.push(eq(knowledgeFiles.id, fileId));
      } else if (fileName) {
        conditions.push(eq(knowledgeFiles.name, fileName));
        if (folderId === "__root__") {
          conditions.push(isNull(knowledgeFiles.folderId));
        } else if (folderId) {
          conditions.push(eq(knowledgeFiles.folderId, folderId));
        }
      }

      const [file] = await db
        .select()
        .from(knowledgeFiles)
        .where(and(...conditions))
        .limit(1);

      if (!file) {
        throw new Error(
          `Arquivo '${fileId || fileName}' não encontrado na Base de Conhecimento do tenant '${tenantId}'.`,
        );
      }

      const parsed = parseKnowledgeStoredContent(file.content);
      let textContent = parsed.textContent;

      // Auto-recuperação de manuais pré-extraídos caso o texto do PDF esteja vazio
      if (textContent.trim().length < 50 && tenantId === "tecfag") {
        const recovered = findPreExtractedManualContent(file.name);
        if (recovered && recovered.length > 50) {
          textContent = recovered.slice(0, MAX_KNOWLEDGE_CONTENT_CHARS);
          const updatedRaw = composeKnowledgeStoredContent({
            mediaUrl: parsed.mediaUrl,
            textContent,
            base64: parsed.base64,
          });
          await db
            .update(knowledgeFiles)
            .set({ content: updatedRaw })
            .where(and(eq(knowledgeFiles.id, file.id), eq(knowledgeFiles.tenantId, tenantId)))
            .catch(() => {});
          invalidateKnowledgeCache(tenantId);
        }
      }

      let folderName: string | null = null;
      if (file.folderId) {
        const [folder] = await db
          .select({ name: knowledgeFolders.name })
          .from(knowledgeFolders)
          .where(
            and(eq(knowledgeFolders.id, file.folderId), eq(knowledgeFolders.tenantId, tenantId)),
          )
          .limit(1);
        folderName = folder?.name ?? null;
      }

      const totalChars = textContent.length;
      const chunk = textContent.slice(offset, offset + maxChars);

      const response: Record<string, unknown> = {
        tenantId,
        fileId: file.id,
        name: file.name,
        folderId: file.folderId,
        folderName,
        size: file.size,
        type: file.type,
        format: file.format,
        mediaUrl: parsed.mediaUrl,
        hasBase64: Boolean(parsed.base64),
        uploadedAt:
          file.uploadedAt instanceof Date ? file.uploadedAt.toISOString() : String(file.uploadedAt),
        totalChars,
        offset,
        returnedChars: chunk.length,
        hasMore: offset + chunk.length < totalChars,
        content: chunk,
      };

      if (includeBase64) {
        response.base64 = parsed.base64;
      }

      return response;
    }

    // ── 4. query_knowledge_rag ────────────────────────────────────────────────
    case "query_knowledge_rag": {
      const query = asTrimmedString(args.query);
      if (!query) {
        throw new Error("Campo obrigatório 'query' não informado.");
      }
      const maxChars = Math.min(120_000, Math.max(500, Number(args.maxChars) || 30_000));
      const fullContext = await getKnowledgeBaseContext(tenantId, query);
      const truncated = fullContext.length > maxChars;
      const context = truncated ? fullContext.slice(0, maxChars) : fullContext;

      return {
        tenantId,
        query,
        totalChars: fullContext.length,
        returnedChars: context.length,
        truncated,
        hasContext: context.trim().length > 0,
        context,
      };
    }

    // ── 5. create_knowledge_folder ────────────────────────────────────────────
    case "create_knowledge_folder": {
      const folderName = asTrimmedString(args.name);
      if (!folderName) {
        throw new Error("Campo obrigatório 'name' não informado.");
      }
      const rawParentId = args.parentId;
      const parentId =
        rawParentId === null || rawParentId === undefined || rawParentId === ""
          ? null
          : String(rawParentId).trim();
      const allowDuplicateName = Boolean(args.allowDuplicateName);

      if (parentId) {
        const [parent] = await db
          .select({ id: knowledgeFolders.id })
          .from(knowledgeFolders)
          .where(and(eq(knowledgeFolders.id, parentId), eq(knowledgeFolders.tenantId, tenantId)))
          .limit(1);
        if (!parent) {
          throw new Error(
            `Pasta pai '${parentId}' não encontrada na Base de Conhecimento do tenant '${tenantId}'.`,
          );
        }
      }

      if (!allowDuplicateName) {
        const siblings = await db
          .select()
          .from(knowledgeFolders)
          .where(
            and(
              eq(knowledgeFolders.tenantId, tenantId),
              parentId ? eq(knowledgeFolders.parentId, parentId) : isNull(knowledgeFolders.parentId),
            ),
          );
        const existing = siblings.find(
          (f) => f.name.trim().toLowerCase() === folderName.toLowerCase(),
        );
        if (existing) {
          return {
            success: true,
            tenantId,
            reused: true,
            folderId: existing.id,
            folder: {
              id: existing.id,
              name: existing.name,
              parentId: existing.parentId,
              createdAt:
                existing.createdAt instanceof Date
                  ? existing.createdAt.toISOString()
                  : String(existing.createdAt),
            },
          };
        }
      }

      const folderId = `f-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
      const now = new Date();
      await db.insert(knowledgeFolders).values({
        id: folderId,
        tenantId,
        name: folderName,
        parentId,
        createdAt: now,
      });

      invalidateKnowledgeCache(tenantId);

      const resolvedActor = await resolveActor(tenantId, args, actor);
      await recordKnowledgeAudit({
        tenantId,
        operatorId: resolvedActor.operatorId,
        operatorName: resolvedActor.actorName,
        action: "create_knowledge_folder",
        entityType: "knowledge_folder",
        itemCount: 1,
        details: { folderId, name: folderName, parentId },
        actor,
      });

      return {
        success: true,
        tenantId,
        reused: false,
        folderId,
        folder: {
          id: folderId,
          name: folderName,
          parentId,
          createdAt: now.toISOString(),
        },
      };
    }

    // ── 6. update_knowledge_folder ────────────────────────────────────────────
    case "update_knowledge_folder": {
      const folderId = asTrimmedString(args.folderId);
      if (!folderId) {
        throw new Error("Campo obrigatório 'folderId' não informado.");
      }

      const hasNameUpdate = args.name !== undefined;
      const hasParentUpdate = args.parentId !== undefined;
      if (!hasNameUpdate && !hasParentUpdate) {
        throw new Error("Informe pelo menos 'name' ou 'parentId' para atualizar a pasta.");
      }

      const allFolders = await db
        .select()
        .from(knowledgeFolders)
        .where(eq(knowledgeFolders.tenantId, tenantId));

      const { byId, getDescendantIds } = buildFolderMaps(allFolders);
      const current = byId.get(folderId);
      if (!current) {
        throw new Error(
          `Pasta '${folderId}' não encontrada na Base de Conhecimento do tenant '${tenantId}'.`,
        );
      }

      const nextName = hasNameUpdate ? asTrimmedString(args.name) : current.name;
      if (!nextName) {
        throw new Error("O campo 'name' não pode ficar vazio.");
      }

      let nextParentId: string | null = current.parentId;
      if (hasParentUpdate) {
        if (args.parentId === null || args.parentId === "") {
          nextParentId = null;
        } else {
          const candidateParent = String(args.parentId).trim();
          if (!byId.has(candidateParent)) {
            throw new Error(
              `Pasta pai destino '${candidateParent}' não encontrada na Base de Conhecimento do tenant '${tenantId}'.`,
            );
          }
          const descendants = getDescendantIds(folderId);
          if (descendants.has(candidateParent)) {
            throw new Error(
              `Movimento inválido: não é possível mover a pasta '${folderId}' para dentro de si mesma ou de uma subpasta descendente ('${candidateParent}').`,
            );
          }
          nextParentId = candidateParent;
        }
      }

      await db
        .update(knowledgeFolders)
        .set({
          name: nextName,
          parentId: nextParentId,
        })
        .where(and(eq(knowledgeFolders.id, folderId), eq(knowledgeFolders.tenantId, tenantId)));

      invalidateKnowledgeCache(tenantId);

      const resolvedActor = await resolveActor(tenantId, args, actor);
      await recordKnowledgeAudit({
        tenantId,
        operatorId: resolvedActor.operatorId,
        operatorName: resolvedActor.actorName,
        action: "update_knowledge_folder",
        entityType: "knowledge_folder",
        itemCount: 1,
        details: {
          folderId,
          previousName: current.name,
          name: nextName,
          previousParentId: current.parentId,
          parentId: nextParentId,
        },
        actor,
      });

      return {
        success: true,
        tenantId,
        folderId,
        previousName: current.name,
        previousParentId: current.parentId,
        folder: {
          id: folderId,
          name: nextName,
          parentId: nextParentId,
        },
      };
    }

    // ── 7. delete_knowledge_folder ────────────────────────────────────────────
    case "delete_knowledge_folder": {
      const folderId = asTrimmedString(args.folderId);
      if (!folderId) {
        throw new Error("Campo obrigatório 'folderId' não informado.");
      }
      const recursive = Boolean(args.recursive);
      const hasMoveTarget = args.moveFilesToFolderId !== undefined;

      const allFolders = await db
        .select()
        .from(knowledgeFolders)
        .where(eq(knowledgeFolders.tenantId, tenantId));
      const { byId, getDescendantIds } = buildFolderMaps(allFolders);

      const target = byId.get(folderId);
      if (!target) {
        throw new Error(
          `Pasta '${folderId}' não encontrada na Base de Conhecimento do tenant '${tenantId}'.`,
        );
      }

      const subtreeFolderIds = Array.from(getDescendantIds(folderId));
      const directSubFolders = allFolders.filter((f) => f.parentId === folderId);
      const subtreeFiles = await db
        .select({
          id: knowledgeFiles.id,
          name: knowledgeFiles.name,
          folderId: knowledgeFiles.folderId,
          content: knowledgeFiles.content,
        })
        .from(knowledgeFiles)
        .where(
          and(
            eq(knowledgeFiles.tenantId, tenantId),
            inArray(knowledgeFiles.folderId, subtreeFolderIds),
          ),
        );

      const directFiles = subtreeFiles.filter((f) => f.folderId === folderId);

      if ((subtreeFiles.length > 0 || directSubFolders.length > 0) && !recursive && !hasMoveTarget) {
        throw new Error(
          `A pasta '${target.name}' (${folderId}) não está vazia (${subtreeFiles.length} arquivo(s) e ${subtreeFolderIds.length - 1} subpasta(s)). Passe recursive=true para excluir tudo em cascata ou moveFilesToFolderId (ID de outra pasta ou null para raiz) para preservar os itens.`,
        );
      }

      const resolvedActor = await resolveActor(tenantId, args, actor);

      if (hasMoveTarget) {
        let destFolderId: string | null = null;
        if (args.moveFilesToFolderId !== null && args.moveFilesToFolderId !== "") {
          const candidateDest = String(args.moveFilesToFolderId).trim();
          if (!byId.has(candidateDest)) {
            throw new Error(
              `Pasta destino '${candidateDest}' não encontrada na Base de Conhecimento do tenant '${tenantId}'.`,
            );
          }
          if (subtreeFolderIds.includes(candidateDest)) {
            throw new Error(
              `Pasta destino inválida: '${candidateDest}' é a própria pasta ou uma subpasta dela.`,
            );
          }
          destFolderId = candidateDest;
        }

        await db.transaction(async (tx) => {
          if (directFiles.length > 0) {
            await tx
              .update(knowledgeFiles)
              .set({ folderId: destFolderId })
              .where(
                and(
                  eq(knowledgeFiles.tenantId, tenantId),
                  eq(knowledgeFiles.folderId, folderId),
                ),
              );
          }
          if (directSubFolders.length > 0) {
            await tx
              .update(knowledgeFolders)
              .set({ parentId: destFolderId })
              .where(
                and(
                  eq(knowledgeFolders.tenantId, tenantId),
                  eq(knowledgeFolders.parentId, folderId),
                ),
              );
          }
          await tx
            .delete(knowledgeFolders)
            .where(and(eq(knowledgeFolders.id, folderId), eq(knowledgeFolders.tenantId, tenantId)));
        });

        invalidateKnowledgeCache(tenantId);

        await recordKnowledgeAudit({
          tenantId,
          operatorId: resolvedActor.operatorId,
          operatorName: resolvedActor.actorName,
          action: "delete_knowledge_folder",
          entityType: "knowledge_folder",
          itemCount: 1,
          details: {
            deletedFolder: { id: target.id, name: target.name },
            movedFilesCount: directFiles.length,
            movedSubFoldersCount: directSubFolders.length,
            moveFilesToFolderId: destFolderId,
          },
          actor,
        });

        return {
          success: true,
          tenantId,
          deletedFolderId: target.id,
          deletedFolderName: target.name,
          mode: "move_and_delete",
          movedFilesCount: directFiles.length,
          movedSubFoldersCount: directSubFolders.length,
          moveFilesToFolderId: destFolderId,
          deletedFilesCount: 0,
          deletedFoldersCount: 1,
        };
      }

      // Exclusão vazia ou recursiva em cascata
      await db.transaction(async (tx) => {
        if (subtreeFiles.length > 0) {
          await tx
            .delete(knowledgeFiles)
            .where(
              and(
                eq(knowledgeFiles.tenantId, tenantId),
                inArray(knowledgeFiles.folderId, subtreeFolderIds),
              ),
            );
        }
        await tx
          .delete(knowledgeFolders)
          .where(
            and(
              eq(knowledgeFolders.tenantId, tenantId),
              inArray(knowledgeFolders.id, subtreeFolderIds),
            ),
          );
      });

      let removedMediaFilesCount = 0;
      for (const f of subtreeFiles) {
        const parsed = parseKnowledgeStoredContent(f.content);
        if (parsed.mediaUrl && (await removeKnowledgeMediaFileSafe(parsed.mediaUrl))) {
          removedMediaFilesCount += 1;
        }
      }

      invalidateKnowledgeCache(tenantId);

      await recordKnowledgeAudit({
        tenantId,
        operatorId: resolvedActor.operatorId,
        operatorName: resolvedActor.actorName,
        action: "delete_knowledge_folder",
        entityType: "knowledge_folder",
        itemCount: subtreeFiles.length + subtreeFolderIds.length,
        details: {
          deletedFolder: { id: target.id, name: target.name },
          deletedFolderIds: subtreeFolderIds,
          deletedFilesCount: subtreeFiles.length,
          removedMediaFilesCount,
          recursive,
        },
        actor,
      });

      return {
        success: true,
        tenantId,
        deletedFolderId: target.id,
        deletedFolderName: target.name,
        mode: recursive ? "recursive" : "empty",
        deletedFoldersCount: subtreeFolderIds.length,
        deletedFilesCount: subtreeFiles.length,
        removedMediaFilesCount,
      };
    }

    // ── 8. upsert_knowledge_file ──────────────────────────────────────────────
    case "upsert_knowledge_file": {
      const rawName = asTrimmedString(args.name);
      if (!rawName) {
        throw new Error("Campo obrigatório 'name' não informado.");
      }

      const rawContent = typeof args.content === "string" ? args.content : undefined;
      const rawBase64 = typeof args.base64 === "string" ? args.base64 : undefined;
      const overwriteExisting = args.overwriteExisting !== false;

      let cleanBase64: string | null = null;
      let decodedByteLength = 0;
      if (rawBase64 && rawBase64.trim()) {
        const parsedB64 = normalizeBase64Payload(rawBase64);
        cleanBase64 = parsedB64.cleanBase64;
        decodedByteLength = parsedB64.byteLength;
      }

      const effectiveType = resolveKnowledgeFileType(rawName, asTrimmedString(args.type));
      const isImageFile = effectiveType === "image";

      if (!rawContent?.trim() && !cleanBase64) {
        const preExtracted =
          effectiveType === "pdf" ? findPreExtractedManualContent(rawName) : null;
        if (!preExtracted) {
          throw new Error(
            "Informe 'content' (texto) ou 'base64' (arquivo binário) para inserir o arquivo na Base de Conhecimento.",
          );
        }
      }

      let validFolderId: string | null = null;
      if (args.folderId !== undefined && args.folderId !== null && args.folderId !== "") {
        const candidateFolderId = String(args.folderId).trim();
        const [folder] = await db
          .select({ id: knowledgeFolders.id })
          .from(knowledgeFolders)
          .where(
            and(
              eq(knowledgeFolders.id, candidateFolderId),
              eq(knowledgeFolders.tenantId, tenantId),
            ),
          )
          .limit(1);
        if (!folder) {
          throw new Error(
            `Pasta '${candidateFolderId}' não encontrada na Base de Conhecimento do tenant '${tenantId}'.`,
          );
        }
        validFolderId = folder.id;
      }

      const requestedFormat = asTrimmedString(args.format)?.toLowerCase();
      const effectiveFormat =
        isImageFile && cleanBase64
          ? "real"
          : requestedFormat === "real" || requestedFormat === "embeddings"
            ? requestedFormat
            : "embeddings";

      let existingFile: { id: string; folderId: string | null; name: string } | undefined;
      if (overwriteExisting) {
        const existingCandidates = await db
          .select({
            id: knowledgeFiles.id,
            folderId: knowledgeFiles.folderId,
            name: knowledgeFiles.name,
          })
          .from(knowledgeFiles)
          .where(and(eq(knowledgeFiles.tenantId, tenantId), eq(knowledgeFiles.name, rawName)));
        existingFile =
          existingCandidates.find((c) => (c.folderId || null) === validFolderId) ||
          (isImageFile ? existingCandidates[0] : undefined);
      }

      const fileId =
        existingFile?.id || `kf-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

      let mediaUrl: string | null = null;
      if (effectiveFormat === "real" && (cleanBase64 || rawContent)) {
        try {
          mediaUrl = await writeKnowledgeMediaFileSafe({
            fileId,
            fileName: rawName,
            fileType: effectiveType,
            base64: cleanBase64,
            content: rawContent,
          });
        } catch (err: any) {
          console.warn(`[mcp-knowledge] Aviso ao gravar mídia real (${fileId}):`, err?.message);
        }
      }

      let extractedText = "";
      if (!(effectiveFormat === "real" && isImageFile && cleanBase64 && !rawContent?.trim())) {
        extractedText = await extractKnowledgeText(
          rawName,
          effectiveType,
          cleanBase64,
          rawContent,
        );
      }

      const storedContent = composeKnowledgeStoredContent({
        mediaUrl,
        textContent: extractedText,
        base64: effectiveFormat === "real" && isImageFile ? cleanBase64 : null,
      });

      const computedBytes =
        decodedByteLength > 0
          ? decodedByteLength
          : Buffer.byteLength(rawContent || extractedText || "", "utf8");
      const effectiveSize = asTrimmedString(args.size) || formatKnowledgeSizeLabel(computedBytes);
      const now = new Date();

      if (existingFile) {
        await db
          .update(knowledgeFiles)
          .set({
            folderId: validFolderId,
            name: rawName,
            size: effectiveSize,
            type: effectiveType,
            format: effectiveFormat,
            content: storedContent,
            uploadedAt: now,
          })
          .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.tenantId, tenantId)));
      } else {
        await db.insert(knowledgeFiles).values({
          id: fileId,
          tenantId,
          folderId: validFolderId,
          name: rawName,
          size: effectiveSize,
          type: effectiveType,
          format: effectiveFormat,
          content: storedContent,
          uploadedAt: now,
        });
      }

      invalidateKnowledgeCache(tenantId);

      const resolvedActor = await resolveActor(tenantId, args, actor);
      await recordKnowledgeAudit({
        tenantId,
        operatorId: resolvedActor.operatorId,
        operatorName: resolvedActor.actorName,
        action: existingFile ? "update_knowledge_file" : "create_knowledge_file",
        entityType: "knowledge_file",
        itemCount: 1,
        details: {
          fileId,
          name: rawName,
          folderId: validFolderId,
          type: effectiveType,
          format: effectiveFormat,
          extractedChars: extractedText.length,
          updated: Boolean(existingFile),
        },
        actor,
      });

      return {
        success: true,
        tenantId,
        updated: Boolean(existingFile),
        fileId,
        file: {
          id: fileId,
          name: rawName,
          folderId: validFolderId,
          size: effectiveSize,
          type: effectiveType,
          format: effectiveFormat,
          mediaUrl,
          extractedChars: extractedText.length,
          uploadedAt: now.toISOString(),
        },
      };
    }

    // ── 9. update_knowledge_file ──────────────────────────────────────────────
    case "update_knowledge_file": {
      const fileId = asTrimmedString(args.fileId);
      if (!fileId) {
        throw new Error("Campo obrigatório 'fileId' não informado.");
      }

      const hasMutation =
        args.name !== undefined ||
        args.folderId !== undefined ||
        args.content !== undefined ||
        args.appendContent !== undefined ||
        args.replaceTarget !== undefined ||
        args.base64 !== undefined ||
        args.type !== undefined ||
        args.format !== undefined ||
        args.size !== undefined;

      if (!hasMutation) {
        throw new Error(
          "Informe pelo menos um campo para editar (name, folderId, content, appendContent, replaceTarget/replaceWith, base64, type, format ou size).",
        );
      }

      if (args.replaceTarget !== undefined && args.replaceWith === undefined) {
        throw new Error("Ao usar 'replaceTarget', informe também 'replaceWith'.");
      }

      const [existing] = await db
        .select()
        .from(knowledgeFiles)
        .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.tenantId, tenantId)))
        .limit(1);

      if (!existing) {
        throw new Error(
          `Arquivo '${fileId}' não encontrado na Base de Conhecimento do tenant '${tenantId}'.`,
        );
      }

      const nextName = args.name !== undefined ? asTrimmedString(args.name) : existing.name;
      if (!nextName) {
        throw new Error("O campo 'name' não pode ficar vazio.");
      }

      let nextFolderId: string | null = existing.folderId;
      if (args.folderId !== undefined) {
        if (args.folderId === null || args.folderId === "") {
          nextFolderId = null;
        } else {
          const candidateFolderId = String(args.folderId).trim();
          const [folder] = await db
            .select({ id: knowledgeFolders.id })
            .from(knowledgeFolders)
            .where(
              and(
                eq(knowledgeFolders.id, candidateFolderId),
                eq(knowledgeFolders.tenantId, tenantId),
              ),
            )
            .limit(1);
          if (!folder) {
            throw new Error(
              `Pasta destino '${candidateFolderId}' não encontrada na Base de Conhecimento do tenant '${tenantId}'.`,
            );
          }
          nextFolderId = folder.id;
        }
      }

      const nextType =
        args.type !== undefined
          ? resolveKnowledgeFileType(nextName, String(args.type))
          : existing.type;

      const requestedFormat = asTrimmedString(args.format)?.toLowerCase();
      const nextFormat =
        requestedFormat === "real" || requestedFormat === "embeddings"
          ? requestedFormat
          : existing.format;

      const parsed = parseKnowledgeStoredContent(existing.content);
      let nextMediaUrl = parsed.mediaUrl;
      let nextBase64 = parsed.base64;
      let nextText = parsed.textContent;
      let decodedByteLength = 0;

      if (typeof args.base64 === "string" && args.base64.trim()) {
        const parsedB64 = normalizeBase64Payload(args.base64);
        decodedByteLength = parsedB64.byteLength;
        const extractedFromBin = await extractKnowledgeText(
          nextName,
          nextType,
          parsedB64.cleanBase64,
          typeof args.content === "string" ? args.content : undefined,
        );
        if (nextFormat === "real" || nextType === "image") {
          nextMediaUrl = await writeKnowledgeMediaFileSafe({
            fileId,
            fileName: nextName,
            fileType: nextType,
            base64: parsedB64.cleanBase64,
            content: extractedFromBin,
          });
          nextBase64 = nextType === "image" ? parsedB64.cleanBase64 : null;
        }
        nextText = extractedFromBin;
      } else if (args.content !== undefined) {
        nextText = String(args.content ?? "").slice(0, MAX_KNOWLEDGE_CONTENT_CHARS);
      }

      if (args.replaceTarget !== undefined) {
        const targetStr = String(args.replaceTarget);
        const replaceWithStr = String(args.replaceWith ?? "");
        if (!targetStr) {
          throw new Error("'replaceTarget' não pode ser string vazia.");
        }
        if (!nextText.includes(targetStr)) {
          throw new Error(
            `Trecho informado em 'replaceTarget' não encontrado no conteúdo atual do arquivo '${existing.name}'.`,
          );
        }
        nextText = args.replaceAll
          ? nextText.split(targetStr).join(replaceWithStr)
          : nextText.replace(targetStr, replaceWithStr);
        nextText = nextText.slice(0, MAX_KNOWLEDGE_CONTENT_CHARS);
      }

      if (args.appendContent !== undefined && String(args.appendContent).length > 0) {
        const toAppend = String(args.appendContent);
        nextText = nextText ? `${nextText}\n\n${toAppend}` : toAppend;
        nextText = nextText.slice(0, MAX_KNOWLEDGE_CONTENT_CHARS);
      }

      if (nextFormat === "embeddings") {
        nextMediaUrl = null;
        nextBase64 = null;
      } else if (nextFormat === "real" && !nextMediaUrl && nextText) {
        nextMediaUrl = await writeKnowledgeMediaFileSafe({
          fileId,
          fileName: nextName,
          fileType: nextType,
          content: nextText,
        });
      }

      const nextStoredContent = composeKnowledgeStoredContent({
        mediaUrl: nextMediaUrl,
        textContent: nextText,
        base64: nextBase64,
      });

      const nextSize =
        asTrimmedString(args.size) ||
        (decodedByteLength > 0
          ? formatKnowledgeSizeLabel(decodedByteLength)
          : args.content !== undefined ||
              args.appendContent !== undefined ||
              args.replaceTarget !== undefined
            ? formatKnowledgeSizeLabel(Buffer.byteLength(nextText, "utf8"))
            : existing.size);

      const now = new Date();
      await db
        .update(knowledgeFiles)
        .set({
          name: nextName,
          folderId: nextFolderId,
          type: nextType,
          format: nextFormat,
          size: nextSize,
          content: nextStoredContent,
          uploadedAt: now,
        })
        .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.tenantId, tenantId)));

      invalidateKnowledgeCache(tenantId);

      const updatedFields: string[] = [];
      if (nextName !== existing.name) updatedFields.push("name");
      if ((nextFolderId || null) !== (existing.folderId || null)) updatedFields.push("folderId");
      if (nextType !== existing.type) updatedFields.push("type");
      if (nextFormat !== existing.format) updatedFields.push("format");
      if (nextStoredContent !== (existing.content || "")) updatedFields.push("content");
      if (nextSize !== existing.size) updatedFields.push("size");

      const resolvedActor = await resolveActor(tenantId, args, actor);
      await recordKnowledgeAudit({
        tenantId,
        operatorId: resolvedActor.operatorId,
        operatorName: resolvedActor.actorName,
        action: "update_knowledge_file",
        entityType: "knowledge_file",
        itemCount: 1,
        details: {
          fileId,
          name: nextName,
          folderId: nextFolderId,
          updatedFields,
          contentLength: nextText.length,
        },
        actor,
      });

      return {
        success: true,
        tenantId,
        fileId,
        updatedFields,
        file: {
          id: fileId,
          name: nextName,
          folderId: nextFolderId,
          size: nextSize,
          type: nextType,
          format: nextFormat,
          mediaUrl: nextMediaUrl,
          contentLength: nextText.length,
          uploadedAt: now.toISOString(),
        },
      };
    }

    // ── 10. delete_knowledge_file ─────────────────────────────────────────────
    case "delete_knowledge_file": {
      const singleId = asTrimmedString(args.fileId);
      const batchIds = Array.isArray(args.fileIds)
        ? args.fileIds
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter(Boolean)
        : [];
      const ids = Array.from(new Set([...(singleId ? [singleId] : []), ...batchIds]));

      if (ids.length === 0) {
        throw new Error("Informe 'fileId' ou 'fileIds' (array de IDs) para excluir arquivo(s).");
      }
      if (ids.length > 50) {
        throw new Error("Limite máximo de 50 arquivos por chamada em 'delete_knowledge_file'.");
      }

      const targets = await db
        .select({
          id: knowledgeFiles.id,
          name: knowledgeFiles.name,
          folderId: knowledgeFiles.folderId,
          content: knowledgeFiles.content,
        })
        .from(knowledgeFiles)
        .where(and(eq(knowledgeFiles.tenantId, tenantId), inArray(knowledgeFiles.id, ids)));

      if (targets.length === 0) {
        throw new Error(
          `Nenhum arquivo encontrado no tenant '${tenantId}' para o(s) ID(s) informado(s).`,
        );
      }

      const foundIds = targets.map((t) => t.id);
      const notFoundIds = ids.filter((id) => !foundIds.includes(id));

      await db
        .delete(knowledgeFiles)
        .where(and(eq(knowledgeFiles.tenantId, tenantId), inArray(knowledgeFiles.id, foundIds)));

      let removedMediaFilesCount = 0;
      for (const t of targets) {
        const parsed = parseKnowledgeStoredContent(t.content);
        if (parsed.mediaUrl && (await removeKnowledgeMediaFileSafe(parsed.mediaUrl))) {
          removedMediaFilesCount += 1;
        }
      }

      invalidateKnowledgeCache(tenantId);

      const resolvedActor = await resolveActor(tenantId, args, actor);
      await recordKnowledgeAudit({
        tenantId,
        operatorId: resolvedActor.operatorId,
        operatorName: resolvedActor.actorName,
        action: "delete_knowledge_file",
        entityType: "knowledge_file",
        itemCount: targets.length,
        details: {
          files: targets.map((t) => ({ id: t.id, name: t.name, folderId: t.folderId })),
          removedMediaFilesCount,
        },
        actor,
      });

      return {
        success: true,
        tenantId,
        deletedCount: targets.length,
        deletedFileIds: foundIds,
        deletedFiles: targets.map((t) => ({ id: t.id, name: t.name, folderId: t.folderId })),
        notFoundIds,
        removedMediaFilesCount,
      };
    }

    default:
      throw new Error(`Ferramenta de Knowledge desconhecida: '${name}'.`);
  }
}
