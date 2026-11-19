import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  crmActionHistory,
  knowledgeFiles,
  knowledgeFolders,
  tenants,
} from "../src/db/schema";
import {
  processMcpJsonRpcPayload,
  type McpAccessContext,
} from "../src/lib/mcp/valem-tecfag-mcp-core";
import {
  composeKnowledgeStoredContent,
  extractKnowledgeText,
  formatKnowledgeSizeLabel,
  parseKnowledgeStoredContent,
  resolveKnowledgeFileType,
} from "../src/lib/valentina/knowledge-extract";

function hasLocalPostgres(): boolean {
  if (!fs.existsSync(".env")) return false;
  const raw = fs.readFileSync(".env", "utf8");
  const m = raw.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m?.[1]) return false;
  try {
    const u = new URL(m[1]);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

const RUN_DB_TESTS = hasLocalPostgres();

function makeAccess(
  tenantId: "tecfag" | "valem",
  accessLevel: "read" | "read_write",
): McpAccessContext {
  return {
    authorized: true,
    lockedTenantId: tenantId,
    defaultTenantId: tenantId,
    authMode: tenantId === "valem" ? "token_valem" : "token_tecfag",
    accessLevel,
    keyId: `test-kb-${tenantId}-${accessLevel}`,
    keyLabel: `Chave KB ${tenantId}`,
    skipAuditLog: true,
  };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: "tecfag" | "valem" = "tecfag",
  accessLevel: "read" | "read_write" = "read_write",
) {
  const res = await processMcpJsonRpcPayload(
    {
      jsonrpc: "2.0",
      id: `kb-${name}-${crypto.randomUUID().slice(0, 6)}`,
      method: "tools/call",
      params: { name, arguments: args },
    },
    makeAccess(tenantId, accessLevel),
  );
  const isError = Boolean(res.body?.result?.isError);
  const text = String(res.body?.result?.content?.[0]?.text || "");
  if (isError) {
    return { isError: true as const, errorText: text, data: null as any };
  }
  return { isError: false as const, errorText: "", data: JSON.parse(text) };
}

describe("Knowledge Extract & Format Helpers (Unitário)", () => {
  it("separa e recompõe corretamente [FORMATO_REAL:...] + texto + [BASE64:...]", () => {
    const raw =
      "[FORMATO_REAL:/knowledge-media/kf-1.pdf] Manual técnico FR-900\n\n[BASE64:SGVsbG8=]";
    const parsed = parseKnowledgeStoredContent(raw);
    expect(parsed.mediaUrl).toBe("/knowledge-media/kf-1.pdf");
    expect(parsed.textContent).toBe("Manual técnico FR-900");
    expect(parsed.base64).toBe("SGVsbG8=");

    const recomposed = composeKnowledgeStoredContent({
      mediaUrl: parsed.mediaUrl,
      textContent: "Manual atualizado FR-900",
      base64: parsed.base64,
    });
    expect(recomposed).toBe(
      "[FORMATO_REAL:/knowledge-media/kf-1.pdf] Manual atualizado FR-900\n\n[BASE64:SGVsbG8=]",
    );
  });

  it("infere tipo de arquivo e formata rótulos de tamanho", () => {
    expect(resolveKnowledgeFileType("Manual_FR900.PDF")).toBe("pdf");
    expect(resolveKnowledgeFileType("Ficha.docx")).toBe("word");
    expect(resolveKnowledgeFileType("Foto_Maquina.PNG")).toBe("image");
    expect(resolveKnowledgeFileType("Tabela.xlsx")).toBe("xlsx");
    expect(resolveKnowledgeFileType("Guia.md")).toBe("md");
    expect(formatKnowledgeSizeLabel(512)).toBe("512 B");
    expect(formatKnowledgeSizeLabel(2048)).toBe("2 KB");
    expect(formatKnowledgeSizeLabel(1536 * 1024)).toBe("1.50 MB");
  });

  it("extrai texto UTF-8 de base64 (inclusive data URL) para .txt/.md/.json", async () => {
    const original = "# Política Comercial Tecfag\nGarantia de 12 meses para seladoras.";
    const b64 = `data:text/markdown;base64,${Buffer.from(original, "utf8").toString("base64")}`;
    const extracted = await extractKnowledgeText("politica.md", "md", b64, undefined);
    expect(extracted).toBe(original);
  });
});

describe.skipIf(!RUN_DB_TESTS)("Integração PostgreSQL — MCP Knowledge Base CRUD Completo", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const createdFolderIds: string[] = [];
  const createdFileIds: string[] = [];
  const valemFolderIds: string[] = [];

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values([
        { id: "tecfag", name: "Tecfag", slug: "tecfag", connectionType: "meta" },
        { id: "valem", name: "Valem", slug: "valem", connectionType: "baileys" },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    if (createdFileIds.length > 0) {
      await db.delete(knowledgeFiles).where(inArray(knowledgeFiles.id, createdFileIds));
    }
    if (createdFolderIds.length > 0) {
      await db.delete(knowledgeFolders).where(inArray(knowledgeFolders.id, createdFolderIds));
    }
    if (valemFolderIds.length > 0) {
      await db.delete(knowledgeFolders).where(inArray(knowledgeFolders.id, valemFolderIds));
    }
    await db
      .delete(crmActionHistory)
      .where(
        and(
          eq(crmActionHistory.tenantId, "tecfag"),
          eq(crmActionHistory.operatorName, `MCP (Chave KB tecfag)`),
        ),
      );
  });

  it("cria pastas/subpastas (idempotente), lista árvore, renomeia, move e bloqueia ciclos", async () => {
    const rootName = `KB-Root-${suffix}`;
    const childName = `KB-Sub-${suffix}`;

    const cRoot = await callTool("create_knowledge_folder", { name: rootName });
    expect(cRoot.isError).toBe(false);
    expect(cRoot.data.reused).toBe(false);
    const rootId = cRoot.data.folderId as string;
    createdFolderIds.push(rootId);

    // Idempotência no mesmo nível
    const cRootAgain = await callTool("create_knowledge_folder", { name: rootName });
    expect(cRootAgain.isError).toBe(false);
    expect(cRootAgain.data.reused).toBe(true);
    expect(cRootAgain.data.folderId).toBe(rootId);

    // Subpasta
    const cChild = await callTool("create_knowledge_folder", { name: childName, parentId: rootId });
    expect(cChild.isError).toBe(false);
    const childId = cChild.data.folderId as string;
    createdFolderIds.push(childId);

    // Listagem com path hierárquico (acesso somente leitura!)
    const listed = await callTool("list_knowledge_folders", { search: suffix }, "tecfag", "read");
    expect(listed.isError).toBe(false);
    expect(listed.data.totalFolders).toBe(2);
    const childEntry = listed.data.folders.find((f: any) => f.id === childId);
    expect(childEntry.path).toBe(`${rootName} / ${childName}`);
    expect(childEntry.depth).toBe(1);

    // Proteção contra ciclo (mover root para dentro da própria filha)
    const cycleAttempt = await callTool("update_knowledge_folder", {
      folderId: rootId,
      parentId: childId,
    });
    expect(cycleAttempt.isError).toBe(true);
    expect(cycleAttempt.errorText).toContain("Movimento inválido");

    // Renomear subpasta
    const renamed = await callTool("update_knowledge_folder", {
      folderId: childId,
      name: `${childName}-Renomeada`,
    });
    expect(renamed.isError).toBe(false);
    expect(renamed.data.folder.name).toBe(`${childName}-Renomeada`);
  });

  it("insere arquivos (texto e base64), busca, lê paginado, testa RAG, edita cirurgicamente e move", async () => {
    const folderRes = await callTool("create_knowledge_folder", { name: `KB-Docs-${suffix}` });
    const folderId = folderRes.data.folderId as string;
    createdFolderIds.push(folderId);

    const tokenUnico = `TEC_SELADORA_TESTE_${suffix.toUpperCase()}`;
    const upText = await callTool("upsert_knowledge_file", {
      name: `Manual_${suffix}.md`,
      folderId,
      content: `# Manual ${tokenUnico}\nPotência: 600W\nVoltagem: 220V\nGarantia: 6 meses`,
    });
    expect(upText.isError).toBe(false);
    expect(upText.data.updated).toBe(false);
    const fileId = upText.data.fileId as string;
    createdFileIds.push(fileId);

    // Arquivo via base64 + Formato Real
    const b64Payload = Buffer.from(`Especificação base64 ${tokenUnico}`, "utf8").toString("base64");
    const upBin = await callTool("upsert_knowledge_file", {
      name: `Ficha_${suffix}.txt`,
      folderId,
      base64: b64Payload,
      format: "real",
    });
    expect(upBin.isError).toBe(false);
    expect(upBin.data.file.format).toBe("real");
    expect(upBin.data.file.mediaUrl).toContain("/knowledge-media/");
    createdFileIds.push(upBin.data.fileId);

    // Pesquisa por conteúdo (chave somente leitura)
    const searched = await callTool(
      "search_knowledge_files",
      { query: tokenUnico, folderId },
      "tecfag",
      "read",
    );
    expect(searched.isError).toBe(false);
    expect(searched.data.totalMatched).toBe(2);

    // Leitura paginada
    const readChunk = await callTool(
      "get_knowledge_file_content",
      { fileId, offset: 0, maxChars: 100 },
      "tecfag",
      "read",
    );
    expect(readChunk.isError).toBe(false);
    expect(readChunk.data.content).toContain(tokenUnico);

    // Edição cirúrgica (replaceTarget + appendContent)
    const edited = await callTool("update_knowledge_file", {
      fileId,
      replaceTarget: "Garantia: 6 meses",
      replaceWith: "Garantia: 12 meses oficiais",
      appendContent: "Observação: Suporte técnico nacional.",
    });
    expect(edited.isError).toBe(false);

    const readAfter = await callTool("get_knowledge_file_content", { fileId }, "tecfag", "read");
    expect(readAfter.data.content).toContain("Garantia: 12 meses oficiais");
    expect(readAfter.data.content).toContain("Suporte técnico nacional.");

    // Consulta RAG real
    const rag = await callTool("query_knowledge_rag", { query: tokenUnico }, "tecfag", "read");
    expect(rag.isError).toBe(false);
    expect(rag.data.hasContext).toBe(true);
    expect(rag.data.context).toContain(tokenUnico);

    // Isolamento multi-tenant: tenant 'valem' não enxerga nem edita arquivo de 'tecfag'
    const crossRead = await callTool("get_knowledge_file_content", { fileId }, "valem", "read");
    expect(crossRead.isError).toBe(true);
    expect(crossRead.errorText).toContain("não encontrado");

    // Proteção ao apagar pasta não vazia sem recursive nem moveFilesToFolderId
    const denyDelete = await callTool("delete_knowledge_folder", { folderId });
    expect(denyDelete.isError).toBe(true);
    expect(denyDelete.errorText).toContain("não está vazia");

    // Exclusão em cascata da pasta + arquivos + mídia física
    const cascadeDelete = await callTool("delete_knowledge_folder", {
      folderId,
      recursive: true,
    });
    expect(cascadeDelete.isError).toBe(false);
    expect(cascadeDelete.data.deletedFilesCount).toBe(2);
    expect(cascadeDelete.data.deletedFoldersCount).toBe(1);
    expect(cascadeDelete.data.removedMediaFilesCount).toBe(1);
  }, 20_000);

  it("realoca arquivos ao excluir pasta com moveFilesToFolderId e remove arquivo via delete_knowledge_file", async () => {
    const fA = await callTool("create_knowledge_folder", { name: `KB-Origem-${suffix}` });
    const fB = await callTool("create_knowledge_folder", { name: `KB-Destino-${suffix}` });
    const folderAId = fA.data.folderId as string;
    const folderBId = fB.data.folderId as string;
    createdFolderIds.push(folderAId, folderBId);

    const up = await callTool("upsert_knowledge_file", {
      name: `Movivel_${suffix}.txt`,
      folderId: folderAId,
      content: "Conteúdo que deve sobreviver à exclusão da pasta origem.",
    });
    const fileId = up.data.fileId as string;
    createdFileIds.push(fileId);

    const moveDel = await callTool("delete_knowledge_folder", {
      folderId: folderAId,
      moveFilesToFolderId: folderBId,
    });
    expect(moveDel.isError).toBe(false);
    expect(moveDel.data.movedFilesCount).toBe(1);

    const checkFile = await callTool("get_knowledge_file_content", { fileId }, "tecfag", "read");
    expect(checkFile.isError).toBe(false);
    expect(checkFile.data.folderId).toBe(folderBId);

    const delFile = await callTool("delete_knowledge_file", { fileId });
    expect(delFile.isError).toBe(false);
    expect(delFile.data.deletedCount).toBe(1);
  });
});
