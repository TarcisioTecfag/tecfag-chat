import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Formatos de áudio aceitos pela WhatsApp Cloud API (mime base, sem parâmetros).
 * Qualquer outro (ex.: audio/webm gravado pelo navegador, audio/wav) precisa ser convertido.
 */
const META_SUPPORTED_AUDIO = new Set([
  "audio/aac",
  "audio/mp4",
  "audio/mpeg",
  "audio/amr",
  "audio/ogg",
]);

export const META_AUDIO_OUTPUT_MIME = "audio/ogg; codecs=opus";

export function metaAudioNeedsConversion(mimeType: string): boolean {
  const base = (mimeType || "").split(";")[0].trim().toLowerCase();
  return !META_SUPPORTED_AUDIO.has(base);
}

/**
 * Candidatos ao executável do ffmpeg, em ordem de preferência:
 * 1. FFMPEG_PATH (override explícito no ambiente)
 * 2. pacote `ffmpeg-static` (binário baixado na instalação) — resolvido via createRequire
 *    a partir da raiz do projeto para não depender do bundler do servidor
 * 3. `ffmpeg` no PATH do sistema
 */
function ffmpegCandidates(): string[] {
  const list: string[] = [];
  if (process.env.FFMPEG_PATH) list.push(process.env.FFMPEG_PATH);
  try {
    const req = createRequire(path.join(process.cwd(), "package.json"));
    const bundled = req("ffmpeg-static");
    if (typeof bundled === "string" && bundled) list.push(bundled);
  } catch {
    // pacote ausente: segue para o ffmpeg do PATH
  }
  list.push("ffmpeg");
  return list;
}

function runFfmpeg(executable: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Tempo esgotado na conversão de áudio"));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.trim()}`));
    });
  });
}

/**
 * Converte qualquer áudio suportado pelo ffmpeg para OGG/Opus mono 48 kHz,
 * formato aceito pela Meta e exibido como mensagem de voz no WhatsApp.
 * Usa arquivos temporários (containers como MP4 exigem entrada com seek).
 */
export async function convertAudioToOggOpus(input: Buffer): Promise<Buffer> {
  const id = crypto.randomBytes(8).toString("hex");
  const inPath = path.join(os.tmpdir(), `wa-audio-${id}.in`);
  const outPath = path.join(os.tmpdir(), `wa-audio-${id}.ogg`);
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", inPath,
    "-vn",
    "-c:a", "libopus",
    "-b:a", "32k",
    "-ar", "48000",
    "-ac", "1",
    "-f", "ogg",
    outPath,
  ];

  try {
    await fs.writeFile(inPath, input);

    let lastError: unknown = null;
    for (const executable of ffmpegCandidates()) {
      try {
        await runFfmpeg(executable, args, 30_000);
        const output = await fs.readFile(outPath);
        if (output.length === 0) throw new Error("ffmpeg gerou arquivo vazio");
        return output;
      } catch (err: any) {
        lastError = err;
        // ENOENT: executável não existe neste candidato — tenta o próximo.
        if (err?.code !== "ENOENT") break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("ffmpeg indisponível");
  } finally {
    await fs.rm(inPath, { force: true }).catch(() => {});
    await fs.rm(outPath, { force: true }).catch(() => {});
  }
}
