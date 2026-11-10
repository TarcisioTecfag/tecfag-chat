import fs from "fs";
import path from "path";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { crmDealFileChunks, mediaFiles } from "../../db/schema";

export const CRM_FILE_CHUNK_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB por bloco no PostgreSQL

export interface Base64ChunkDescriptor {
  chunkIndex: number;
  chunkBase64: string;
  byteLength: number;
}

export type ParsedHttpByteRange =
  | { kind: "none" }
  | { kind: "unsatisfiable" }
  | { kind: "valid"; start: number; end: number; chunkLength: number };

const EXTENSION_MIME_FALLBACKS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  json: "application/json",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
};

/**
 * Normaliza o MIME type garantindo que fotos, vídeos e PDFs nunca caiam em application/octet-stream
 * quando o navegador ou SO não envia Content-Type explícito no upload.
 */
export function resolveDealFileMimeType(fileName: string, providedMimeType?: string | null): string {
  const cleanMime = (providedMimeType || "").trim().toLowerCase();
  if (cleanMime && cleanMime !== "application/octet-stream") {
    return cleanMime;
  }
  const ext = (fileName.split(".").pop() || "").trim().toLowerCase();
  return EXTENSION_MIME_FALLBACKS[ext] || "application/octet-stream";
}

/**
 * Divide um Buffer binário em blocos codificados em Base64 para gravação segura no PostgreSQL
 * sem estourar limites de memória ou tamanho de pacote em vídeos/arquivos de até 100 MB.
 */
export function splitBufferIntoBase64Chunks(
  buffer: Buffer,
  chunkSizeBytes = CRM_FILE_CHUNK_SIZE_BYTES
): Base64ChunkDescriptor[] {
  if (!buffer || buffer.length === 0) return [];
  const safeChunkSize = Math.max(64 * 1024, chunkSizeBytes);
  const chunks: Base64ChunkDescriptor[] = [];

  let chunkIndex = 0;
  for (let offset = 0; offset < buffer.length; offset += safeChunkSize) {
    const slice = buffer.subarray(offset, Math.min(offset + safeChunkSize, buffer.length));
    chunks.push({
      chunkIndex,
      chunkBase64: slice.toString("base64"),
      byteLength: slice.length,
    });
    chunkIndex += 1;
  }

  return chunks;
}

/**
 * Remonta o Buffer original a partir dos blocos Base64 ordenados por chunkIndex.
 */
export function reassembleBufferFromBase64Chunks(
  chunks: Array<{ chunkIndex: number; chunkBase64: string }>
): Buffer {
  if (!chunks || chunks.length === 0) return Buffer.alloc(0);
  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  return Buffer.concat(ordered.map((c) => Buffer.from(c.chunkBase64, "base64")));
}

/**
 * Faz o parse de cabeçalhos HTTP `Range: bytes=...` conforme RFC 9110 para streaming de vídeos MP4 e downloads retomáveis.
 */
export function parseHttpByteRange(
  rangeHeader: string | null | undefined,
  totalSize: number
): ParsedHttpByteRange {
  if (!rangeHeader || !rangeHeader.trim().toLowerCase().startsWith("bytes=")) {
    return { kind: "none" };
  }
  if (totalSize <= 0) {
    return { kind: "unsatisfiable" };
  }

  // Caso haja múltiplos ranges separados por vírgula, servimos o arquivo completo com 200 OK
  const spec = rangeHeader.trim().slice(6).trim();
  if (!spec || spec.includes(",")) {
    return { kind: "none" };
  }

  const dashIdx = spec.indexOf("-");
  if (dashIdx === -1) {
    return { kind: "unsatisfiable" };
  }

  const rawStart = spec.slice(0, dashIdx).trim();
  const rawEnd = spec.slice(dashIdx + 1).trim();

  // Suffix range: bytes=-500 (últimos 500 bytes)
  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { kind: "unsatisfiable" };
    }
    const start = Math.max(0, totalSize - suffixLength);
    const end = totalSize - 1;
    return { kind: "valid", start, end, chunkLength: end - start + 1 };
  }

  const start = Number.parseInt(rawStart, 10);
  if (!Number.isFinite(start) || start < 0 || start >= totalSize) {
    return { kind: "unsatisfiable" };
  }

  let end = totalSize - 1;
  if (rawEnd) {
    const parsedEnd = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(parsedEnd) || parsedEnd < start) {
      return { kind: "unsatisfiable" };
    }
    end = Math.min(parsedEnd, totalSize - 1);
  }

  return {
    kind: "valid",
    start,
    end,
    chunkLength: end - start + 1,
  };
}

/**
 * Persiste o conteúdo binário de um arquivo do CRM em blocos no PostgreSQL, isolado por tenantId.
 */
export async function persistDealFileBinaryChunks(
  executor: Pick<typeof db, "insert" | "delete">,
  tenantId: string,
  fileId: string,
  buffer: Buffer
): Promise<void> {
  if (!buffer || buffer.length === 0) return;

  await executor
    .delete(crmDealFileChunks)
    .where(and(eq(crmDealFileChunks.tenantId, tenantId), eq(crmDealFileChunks.fileId, fileId)));

  const chunks = splitBufferIntoBase64Chunks(buffer);
  for (const chunk of chunks) {
    await executor.insert(crmDealFileChunks).values({
      id: `${fileId}:${chunk.chunkIndex}`,
      fileId,
      tenantId,
      chunkIndex: chunk.chunkIndex,
      chunkBase64: chunk.chunkBase64,
      byteLength: chunk.byteLength,
      createdAt: new Date(),
    });
  }
}

export function buildDefaultDealFileCachePath(
  tenantId: string,
  dealId: string,
  fileId: string,
  fileName: string
): string {
  const safeName = (fileName || "arquivo").replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(process.cwd(), "uploads", "crm", tenantId, dealId, `${fileId}_${safeName}`);
}

/**
 * Grava o arquivo no disco local como cache rápido sem falhar caso o filesystem do container seja restrito.
 */
export async function writeDealFileLocalCache(
  tenantId: string,
  dealId: string,
  fileId: string,
  fileName: string,
  buffer: Buffer,
  preferredPath?: string | null
): Promise<string> {
  const fallbackPath = buildDefaultDealFileCachePath(tenantId, dealId, fileId, fileName);
  const targetPath = preferredPath
    ? path.isAbsolute(preferredPath)
      ? preferredPath
      : path.resolve(process.cwd(), preferredPath)
    : fallbackPath;

  try {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, buffer);
    return targetPath;
  } catch (err) {
    console.warn(`[CRM Files] Aviso ao gravar cache em disco para ${fileId}:`, err);
    return targetPath;
  }
}

type ResolvedDealFileSource =
  | { kind: "disk"; diskPath: string; totalSize: number }
  | { kind: "buffer"; buffer: Buffer; totalSize: number };

/**
 * Localiza o binário do arquivo:
 * 1) Cache rápido em disco local (uploads/crm/...);
 * 2) Autocura a partir dos blocos persistidos no PostgreSQL (crm_deal_file_chunks);
 * 3) Fallback cruzado em media_files (caso o mesmo arquivo tenha vindo do chat do mesmo tenant).
 */
export async function resolveDealFileSource(
  tenantId: string,
  file: {
    id: string;
    dealId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    storagePath: string;
    metadata?: any;
  }
): Promise<ResolvedDealFileSource | null> {
  const candidates: string[] = [];
  if (file.storagePath) {
    candidates.push(
      path.isAbsolute(file.storagePath)
        ? file.storagePath
        : path.resolve(process.cwd(), file.storagePath)
    );
  }
  candidates.push(buildDefaultDealFileCachePath(tenantId, file.dealId, file.id, file.fileName));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const stats = fs.statSync(candidate);
        if (stats.isFile() && stats.size > 0) {
          return { kind: "disk", diskPath: candidate, totalSize: stats.size };
        }
      }
    } catch {
      // Continua para o banco caso o acesso ao disco falhe
    }
  }

  // 2. Busca blocos persistidos em definitivo no PostgreSQL (crm_deal_file_chunks)
  const storedChunks = await db
    .select({
      chunkIndex: crmDealFileChunks.chunkIndex,
      chunkBase64: crmDealFileChunks.chunkBase64,
    })
    .from(crmDealFileChunks)
    .where(and(eq(crmDealFileChunks.tenantId, tenantId), eq(crmDealFileChunks.fileId, file.id)))
    .orderBy(asc(crmDealFileChunks.chunkIndex));

  if (storedChunks.length > 0) {
    const buffer = reassembleBufferFromBase64Chunks(storedChunks);
    if (buffer.length > 0) {
      const warmedPath = await writeDealFileLocalCache(
        tenantId,
        file.dealId,
        file.id,
        file.fileName,
        buffer,
        file.storagePath
      );
      if (fs.existsSync(warmedPath)) {
        return { kind: "disk", diskPath: warmedPath, totalSize: buffer.length };
      }
      return { kind: "buffer", buffer, totalSize: buffer.length };
    }
  }

  // 3. Fallback cruzado em media_files do próprio tenant (para arquivos oriundos do WhatsApp/Chat)
  const linkedMediaId =
    typeof file.metadata?.mediaMessageId === "string" ? file.metadata.mediaMessageId : null;

  const [matchedMedia] = linkedMediaId
    ? await db
        .select({ base64Data: mediaFiles.base64Data })
        .from(mediaFiles)
        .where(and(eq(mediaFiles.tenantId, tenantId), eq(mediaFiles.id, linkedMediaId)))
        .limit(1)
    : await db
        .select({ base64Data: mediaFiles.base64Data })
        .from(mediaFiles)
        .where(
          and(
            eq(mediaFiles.tenantId, tenantId),
            eq(mediaFiles.fileName, file.fileName),
            eq(mediaFiles.fileSize, file.fileSize)
          )
        )
        .limit(1);

  if (matchedMedia?.base64Data) {
    const buffer = Buffer.from(matchedMedia.base64Data, "base64");
    if (buffer.length > 0) {
      try {
        await persistDealFileBinaryChunks(db, tenantId, file.id, buffer);
      } catch (backfillErr) {
        console.warn(`[CRM Files] Aviso ao retropreencher crm_deal_file_chunks (${file.id}):`, backfillErr);
      }
      const warmedPath = await writeDealFileLocalCache(
        tenantId,
        file.dealId,
        file.id,
        file.fileName,
        buffer,
        file.storagePath
      );
      if (fs.existsSync(warmedPath)) {
        return { kind: "disk", diskPath: warmedPath, totalSize: buffer.length };
      }
      return { kind: "buffer", buffer, totalSize: buffer.length };
    }
  }

  return null;
}

function readSourceSlice(source: ResolvedDealFileSource, start: number, end: number): Uint8Array {
  const length = end - start + 1;
  if (source.kind === "buffer") {
    return new Uint8Array(source.buffer.subarray(start, end + 1));
  }
  const fd = fs.openSync(source.diskPath, "r");
  try {
    const sliceBuf = Buffer.allocUnsafe(length);
    const bytesRead = fs.readSync(fd, sliceBuf, 0, length, start);
    return new Uint8Array(bytesRead === length ? sliceBuf : sliceBuf.subarray(0, bytesRead));
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Constrói a resposta HTTP completa para visualização inline, streaming de vídeo MP4 (206 Partial Content),
 * checagem prévia via HEAD ou download forçado (?download=1).
 */
export async function buildDealFileHttpResponse(params: {
  request: Request;
  tenantId: string;
  file: {
    id: string;
    dealId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    storagePath: string;
    metadata?: any;
  };
  isDownload: boolean;
  corsHeaders: Record<string, string>;
  headOnly?: boolean;
}): Promise<Response> {
  const { request, tenantId, file, isDownload, corsHeaders, headOnly = false } = params;
  const source = await resolveDealFileSource(tenantId, file);

  if (!source) {
    return new Response(
      JSON.stringify({
        error:
          "Arquivo físico indisponível: este anexo foi enviado antes da ativação da persistência permanente no banco e foi limpo na troca de container. Reenvie o arquivo para gravá-lo em definitivo.",
        code: "FILE_NOT_FOUND",
      }),
      {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const contentType = resolveDealFileMimeType(file.fileName, file.mimeType);
  const disposition = isDownload ? "attachment" : "inline";
  const safeAsciiName = (file.fileName || "arquivo").replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_");
  const encodedUtf8Name = encodeURIComponent(file.fileName || "arquivo");
  const baseHeaders: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": contentType,
    "Content-Disposition": `${disposition}; filename="${safeAsciiName}"; filename*=UTF-8''${encodedUtf8Name}`,
    "Cache-Control": "private, max-age=86400",
    "Accept-Ranges": "bytes",
  };

  if (headOnly) {
    return new Response(null, {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Length": String(source.totalSize),
      },
    });
  }

  const rangeResult = parseHttpByteRange(request.headers.get("range"), source.totalSize);
  if (rangeResult.kind === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes */${source.totalSize}`,
      },
    });
  }

  if (rangeResult.kind === "valid") {
    const slice = readSourceSlice(source, rangeResult.start, rangeResult.end);
    return new Response(slice, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${rangeResult.start}-${rangeResult.end}/${source.totalSize}`,
        "Content-Length": String(slice.byteLength),
      },
    });
  }

  const fullBody = readSourceSlice(source, 0, source.totalSize - 1);
  return new Response(fullBody, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(fullBody.byteLength),
    },
  });
}
