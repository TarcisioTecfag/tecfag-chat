// @ts-expect-error bun:test is provided by Bun runtime
import { describe, expect, it } from "bun:test";
import {
  parseHttpByteRange,
  reassembleBufferFromBase64Chunks,
  resolveDealFileMimeType,
  splitBufferIntoBase64Chunks,
} from "../deal-file-storage";
import {
  ensureDownloadParamOnFileUrl,
  stripDownloadParamFromFileUrl,
} from "../../../components/crm/DealFilePreviewModal";

describe("CRM Deal File Durable Storage & HTTP Range Streaming", () => {
  it("divide e remonta binários grandes (ex: vídeo MP4 em múltiplos blocos) byte a byte mesmo fora de ordem", () => {
    const original = Buffer.alloc(5 * 1024 * 1024 + 321); // ~5MB + bytes quebrados
    for (let i = 0; i < original.length; i += 1) {
      original[i] = (i * 31 + 17) & 0xff;
    }

    const chunks = splitBufferIntoBase64Chunks(original, 2 * 1024 * 1024);
    expect(chunks.length).toBe(3);
    expect(chunks[0].byteLength).toBe(2 * 1024 * 1024);
    expect(chunks[1].byteLength).toBe(2 * 1024 * 1024);
    expect(chunks[2].byteLength).toBe(1024 * 1024 + 321);

    // Embaralha a ordem para garantir que reassemble ordena estritamente por chunkIndex
    const shuffled = [chunks[2], chunks[0], chunks[1]];
    const restored = reassembleBufferFromBase64Chunks(shuffled);

    expect(restored.length).toBe(original.length);
    expect(restored.equals(original)).toBe(true);
  });

  it("interpreta cabeçalhos HTTP Range (RFC 9110) para streaming e avanço de vídeos MP4", () => {
    const total = 8_309_653; // Tamanho exato do 1794321310006.mp4

    expect(parseHttpByteRange(null, total)).toEqual({ kind: "none" });
    expect(parseHttpByteRange("bytes=0-1023", total)).toEqual({
      kind: "valid",
      start: 0,
      end: 1023,
      chunkLength: 1024,
    });
    expect(parseHttpByteRange("bytes=8300000-", total)).toEqual({
      kind: "valid",
      start: 8_300_000,
      end: 8_309_652,
      chunkLength: 9653,
    });
    // Suffix range usado por players MP4 para ler o átomo moov no fim do arquivo
    expect(parseHttpByteRange("bytes=-500", total)).toEqual({
      kind: "valid",
      start: 8_309_153,
      end: 8_309_652,
      chunkLength: 500,
    });
    expect(parseHttpByteRange("bytes=9000000-9000100", total)).toEqual({
      kind: "unsatisfiable",
    });
  });

  it("normaliza MIME types quando o navegador envia vazio ou application/octet-stream", () => {
    expect(resolveDealFileMimeType("1794321310006.mp4", "")).toBe("video/mp4");
    expect(resolveDealFileMimeType("1794249255998.png", "application/octet-stream")).toBe("image/png");
    expect(resolveDealFileMimeType("proposta.pdf", "application/pdf")).toBe("application/pdf");
  });

  it("alterna URLs de visualização inline (player de vídeo) e download forçado (?download=1)", () => {
    const dlUrl = "/api/crm/deals/deal-123/files/dfile-456?download=1";
    const inlineUrl = stripDownloadParamFromFileUrl(dlUrl);
    expect(inlineUrl).toBe("/api/crm/deals/deal-123/files/dfile-456");
    expect(ensureDownloadParamOnFileUrl(inlineUrl)).toBe(dlUrl);
    expect(ensureDownloadParamOnFileUrl(dlUrl)).toBe(dlUrl);
  });
});
