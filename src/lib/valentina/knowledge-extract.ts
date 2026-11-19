import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  KNOWLEDGE_MEDIA_DIR,
  findPreExtractedManualContent,
} from "./knowledge-service";

export const MAX_KNOWLEDGE_CONTENT_CHARS = 200_000;
export const MAX_KNOWLEDGE_BASE64_BYTES = 15 * 1024 * 1024; // 15 MB decodificado

export interface ParsedKnowledgeContent {
  mediaUrl: string | null;
  textContent: string;
  base64: string | null;
}

/**
 * Separa um campo `knowledge_files.content` em suas três partes estruturais:
 * - prefixo opcional `[FORMATO_REAL:/knowledge-media/...]`
 * - texto extraído/editável
 * - sufixo opcional `[BASE64:...]`
 */
export function parseKnowledgeStoredContent(rawContent?: string | null): ParsedKnowledgeContent {
  let remaining = String(rawContent || "");
  let mediaUrl: string | null = null;
  let base64: string | null = null;

  const base64MarkerIdx = remaining.indexOf("[BASE64:");
  if (base64MarkerIdx !== -1) {
    const afterMarker = remaining.slice(base64MarkerIdx + "[BASE64:".length);
    const closingIdx = afterMarker.lastIndexOf("]");
    base64 = closingIdx !== -1 ? afterMarker.slice(0, closingIdx) : afterMarker;
    remaining = remaining.slice(0, base64MarkerIdx);
  }

  const realMatch = remaining.match(/^\s*\[FORMATO_REAL:([^\]]+)\]\s*/);
  if (realMatch) {
    mediaUrl = realMatch[1].trim() || null;
    remaining = remaining.slice(realMatch[0].length);
  }

  return {
    mediaUrl,
    textContent: remaining.trim(),
    base64,
  };
}

/**
 * Recompõe `knowledge_files.content` preservando prefixo `[FORMATO_REAL:...]` e sufixo `[BASE64:...]`.
 */
export function composeKnowledgeStoredContent(parts: {
  mediaUrl?: string | null;
  textContent?: string | null;
  base64?: string | null;
}): string {
  const cleanText = String(parts.textContent || "")
    .replace(/\0/g, "")
    .trim()
    .slice(0, MAX_KNOWLEDGE_CONTENT_CHARS);
  const mediaUrl = parts.mediaUrl?.trim() || null;
  const base64 = parts.base64?.trim() || null;

  if (mediaUrl && base64 && !cleanText) {
    return `[FORMATO_REAL:${mediaUrl}][BASE64:${base64}]`;
  }

  let out = "";
  if (mediaUrl) {
    out = cleanText ? `[FORMATO_REAL:${mediaUrl}] ${cleanText}` : `[FORMATO_REAL:${mediaUrl}]`;
  } else {
    out = cleanText;
  }

  if (base64) {
    out = out ? `${out}\n\n[BASE64:${base64}]` : `[BASE64:${base64}]`;
  }

  return out;
}

/**
 * Formata bytes em rótulo legível para o campo `knowledge_files.size`.
 */
export function formatKnowledgeSizeLabel(byteLength: number): string {
  if (!Number.isFinite(byteLength) || byteLength <= 0) return "1 KB";
  if (byteLength < 1024) return `${Math.max(1, Math.round(byteLength))} B`;
  if (byteLength < 1024 * 1024) return `${(byteLength / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${(byteLength / (1024 * 1024)).toFixed(2).replace(/\.00$/, "")} MB`;
}

/**
 * Infere o `type` canônico do arquivo a partir do nome/extensão ou tipo informado.
 */
export function resolveKnowledgeFileType(fileName: string, requestedType?: string | null): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (requestedType && requestedType.trim()) {
    const t = requestedType.trim().toLowerCase();
    if (["pdf", "word", "image", "txt", "md", "xlsx", "csv", "json"].includes(t)) {
      return t;
    }
    if (t === "docx" || t === "doc") return "word";
    if (t === "xls") return "xlsx";
    if (["png", "jpg", "jpeg", "gif", "webp"].includes(t)) return "image";
  }

  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "word";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "csv") return "csv";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "json") return "json";
  return "txt";
}

/**
 * Extrai texto pesquisável de documentos (PDF, DOCX, XLSX/CSV, TXT/MD/JSON) a partir de
 * `rawContent` textual ou `base64` binário, mantendo compatibilidade integral com `/api/valentina/knowledge`.
 */
export async function extractKnowledgeText(
  name: string,
  type: string,
  base64?: string | null,
  rawContent?: string | null,
): Promise<string> {
  if (rawContent && rawContent.trim().length > 0 && !rawContent.startsWith("[Documento ")) {
    return rawContent.trim().slice(0, MAX_KNOWLEDGE_CONTENT_CHARS);
  }

  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  if (base64) {
    try {
      const normalizedBase64 = base64.includes(";base64,")
        ? base64.slice(base64.indexOf(";base64,") + ";base64,".length)
        : base64;
      const buf = Buffer.from(normalizedBase64, "base64");

      if (type === "pdf" || ext === "pdf") {
        try {
          const pdfParsePkg = await import("pdf-parse");
          let extractedText = "";

          if ((pdfParsePkg as any).PDFParse) {
            const ParserClass = (pdfParsePkg as any).PDFParse;
            if (typeof ParserClass.setWorker === "function") {
              const workerCandidates = [
                path.resolve(process.cwd(), "node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs"),
                path.resolve(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
              ];
              for (const candidate of workerCandidates) {
                if (fs.existsSync(candidate)) {
                  ParserClass.setWorker(pathToFileURL(candidate).href);
                  break;
                }
              }
            }
            const parser = new ParserClass({ data: buf });
            const result = await parser.getText();
            extractedText = result.text || "";
            try {
              await parser.destroy();
            } catch {}
          } else if (typeof pdfParsePkg === "function") {
            const result = await (pdfParsePkg as any)(buf);
            extractedText = result.text || "";
          } else if (typeof (pdfParsePkg as any).default === "function") {
            const result = await (pdfParsePkg as any).default(buf);
            extractedText = result.text || "";
          }

          const cleaned = extractedText
            .replace(/\0/g, "")
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
            .replace(/-- \d+ of \d+ --/g, "")
            .trim();

          if (cleaned.length > 20) {
            return cleaned.slice(0, MAX_KNOWLEDGE_CONTENT_CHARS);
          }
        } catch (err: any) {
          console.warn(`[knowledge-extract] Erro ao extrair texto do PDF ${name}:`, err?.message);
        }

        const preExtracted = findPreExtractedManualContent(name);
        if (preExtracted && preExtracted.length > 20) {
          return preExtracted.slice(0, MAX_KNOWLEDGE_CONTENT_CHARS);
        }
      }

      if (type === "word" || ext === "docx" || ext === "doc") {
        try {
          const mammoth = await import("mammoth");
          const result = await mammoth.extractRawText({ buffer: buf });
          const cleaned = (result.value || "").replace(/\0/g, "").trim();
          if (cleaned.length > 20) {
            return cleaned.slice(0, MAX_KNOWLEDGE_CONTENT_CHARS);
          }
        } catch (err: any) {
          console.warn(`[knowledge-extract] Erro ao extrair texto do Word ${name}:`, err?.message);
        }
      }

      if (type === "xlsx" || type === "csv" || ext === "xlsx" || ext === "xls" || ext === "csv") {
        try {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(buf, { type: "buffer" });
          const texts: string[] = [];
          for (const sheetName of wb.SheetNames) {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
            texts.push(`[Planilha/Aba: ${sheetName}]\n${csv}`);
          }
          const joined = texts.join("\n\n").trim();
          if (joined.length > 10) {
            return joined.slice(0, MAX_KNOWLEDGE_CONTENT_CHARS);
          }
        } catch (err: any) {
          console.warn(`[knowledge-extract] Erro ao extrair planilha ${name}:`, err?.message);
        }
      }

      if (type === "txt" || type === "md" || type === "json" || ext === "txt" || ext === "md" || ext === "json") {
        try {
          const text = buf.toString("utf-8").replace(/\0/g, "").trim();
          if (text.length > 0) {
            return text.slice(0, MAX_KNOWLEDGE_CONTENT_CHARS);
          }
        } catch (err: any) {
          console.warn(`[knowledge-extract] Erro ao extrair texto puro ${name}:`, err?.message);
        }
      }
    } catch (err: any) {
      console.warn(`[knowledge-extract] Erro geral ao processar base64 de ${name}:`, err?.message);
    }
  }

  if (type === "pdf" || ext === "pdf") {
    const preExtracted = findPreExtractedManualContent(name);
    if (preExtracted && preExtracted.length > 20) {
      return preExtracted.slice(0, MAX_KNOWLEDGE_CONTENT_CHARS);
    }
  }

  return (rawContent || "").slice(0, MAX_KNOWLEDGE_CONTENT_CHARS);
}

/**
 * Grava arquivo físico em `public/knowledge-media` para itens em Formato Real.
 */
export async function writeKnowledgeMediaFileSafe(params: {
  fileId: string;
  fileName: string;
  fileType: string;
  base64?: string | null;
  content?: string | null;
}): Promise<string | null> {
  const extRaw = params.fileName.split(".").pop()?.toLowerCase() ?? "";
  const safeExt = /^[a-z0-9]{1,8}$/.test(extRaw)
    ? extRaw
    : params.fileType === "image"
      ? "jpg"
      : "txt";
  const safeId = params.fileId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) return null;

  const safeFileName = `${safeId}.${safeExt}`;
  const resolvedBase = path.resolve(KNOWLEDGE_MEDIA_DIR);
  const targetPath = path.resolve(resolvedBase, safeFileName);
  if (!targetPath.startsWith(resolvedBase + path.sep)) {
    return null;
  }

  if (!fs.existsSync(resolvedBase)) {
    await fs.promises.mkdir(resolvedBase, { recursive: true });
  }

  const normalizedBase64 = params.base64
    ? params.base64.includes(";base64,")
      ? params.base64.slice(params.base64.indexOf(";base64,") + ";base64,".length)
      : params.base64
    : null;

  const buf = normalizedBase64
    ? Buffer.from(normalizedBase64, "base64")
    : Buffer.from(params.content || "", "utf-8");

  await fs.promises.writeFile(targetPath, buf);
  return `/knowledge-media/${safeFileName}`;
}

/**
 * Remove com segurança (anti path-traversal) o arquivo físico correspondente a uma `mediaUrl` em `/knowledge-media/...`.
 */
export async function removeKnowledgeMediaFileSafe(mediaUrl?: string | null): Promise<boolean> {
  if (!mediaUrl || !mediaUrl.startsWith("/knowledge-media/")) return false;
  const baseName = path.basename(mediaUrl);
  if (!baseName || baseName === "." || baseName === "..") return false;

  const resolvedBase = path.resolve(KNOWLEDGE_MEDIA_DIR);
  const targetPath = path.resolve(resolvedBase, baseName);
  if (!targetPath.startsWith(resolvedBase + path.sep)) return false;

  try {
    if (fs.existsSync(targetPath)) {
      await fs.promises.unlink(targetPath);
      return true;
    }
  } catch {
    // Não falha a remoção do registro no banco caso o arquivo físico já não exista
  }
  return false;
}
