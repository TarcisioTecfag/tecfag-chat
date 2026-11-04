import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Formato de vídeo canônico aceito pela WhatsApp Cloud API (Meta) e Baileys.
 * A Meta aceita apenas `video/mp4` ou `video/3gp` (codec H.264 + áudio AAC) com limite rígido de 16 MB.
 */
export const META_VIDEO_OUTPUT_MIME = "video/mp4";

/**
 * Teto seguro de 15 MB (15 * 1024 * 1024 = 15.728.640 bytes), deixando margem de segurança
 * abaixo do limite rígido de 16 MB (16.777.216 bytes) da Meta Cloud API.
 */
export const META_VIDEO_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Verifica se o buffer já é um container MP4 ("ftyp") contendo vídeo H.264 ("avc1")
 * e sem codecs de vídeo incompatíveis como HEVC/H.265 ("hvc1"/"hev1").
 */
export function isMp4H264Buffer(buf?: Buffer | null): boolean {
  if (!buf || buf.length < 64) return false;
  if (buf.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const hasAvc1 = buf.includes(Buffer.from("avc1", "ascii"));
  if (!hasAvc1) return false;
  return true;
}

/**
 * Determina se o vídeo precisa ser comprimido ou recodificado antes do envio:
 * - Qualquer arquivo acima de 15 MB (Meta rejeita > 16 MB com `(#100) Invalid parameter`)
 * - Qualquer MIME diferente de `video/mp4` (ex.: `video/quicktime`, `video/webm`, `application/octet-stream`)
 * - Qualquer container que não seja MP4 H.264 (`avc1`)
 */
export function metaVideoNeedsConversion(mimeType: string, buf?: Buffer | null): boolean {
  const normalized = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (normalized !== META_VIDEO_OUTPUT_MIME) return true;
  if (!buf) return false;
  if (buf.length > META_VIDEO_MAX_BYTES) return true;
  if (!isMp4H264Buffer(buf)) return true;
  return false;
}

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
      stderr = (stderr + chunk.toString()).slice(-3000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Tempo esgotado na compressão/conversão de vídeo"));
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

function probeMediaWithFfmpeg(
  executable: string,
  inPath: string,
  timeoutMs = 10_000,
): Promise<{ durationSec: number | null; hasAudio: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-hide_banner", "-i", inPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ durationSec: null, hasAudio: true });
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
      let durationSec: number | null = null;
      if (durMatch) {
        const hours = Number(durMatch[1]) || 0;
        const minutes = Number(durMatch[2]) || 0;
        const seconds = Number(durMatch[3]) || 0;
        const total = hours * 3600 + minutes * 60 + seconds;
        if (total > 0 && Number.isFinite(total)) {
          durationSec = total;
        }
      }
      const hasAudio = /Stream #\d+:\d+.*:\s*Audio:/i.test(stderr);
      resolve({ durationSec, hasAudio });
    });
  });
}

function buildEncodeArgs(params: {
  inPath: string;
  outPath: string;
  maxDim: number;
  fps: number;
  crf: number;
  preset: "veryfast" | "ultrafast";
  videoMaxKbps: number;
  hasAudio: boolean;
  audioKbps: number;
}): string[] {
  const { inPath, outPath, maxDim, fps, crf, preset, videoMaxKbps, hasAudio, audioKbps } = params;
  const scaleFilter = `scale='trunc(iw*min(1\\,min(${maxDim}/iw\\,${maxDim}/ih))/2)*2':'trunc(ih*min(1\\,min(${maxDim}/iw\\,${maxDim}/ih))/2)*2'`;
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inPath,
    "-map",
    "0:v:0",
    ...(hasAudio ? ["-map", "0:a:0?"] : ["-an"]),
    "-vf",
    scaleFilter,
    "-r",
    String(fps),
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-profile:v",
    "high",
    "-level",
    "4.0",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    String(crf),
    "-maxrate",
    `${videoMaxKbps}k`,
    "-bufsize",
    `${videoMaxKbps * 2}k`,
    ...(hasAudio ? ["-c:a", "aac", "-b:a", `${audioKbps}k`, "-ac", "2", "-ar", "44100"] : []),
    "-map_metadata",
    "-1",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    outPath,
  ];
}

/**
 * Comprime e padroniza qualquer vídeo suportado pelo ffmpeg para MP4 (H.264 yuv420p + AAC + faststart)
 * garantidamente abaixo do limite de 16 MB da WhatsApp Cloud API (Meta).
 */
export async function convertAndCompressVideoToMp4(input: Buffer): Promise<Buffer> {
  const id = crypto.randomBytes(8).toString("hex");
  const inPath = path.join(os.tmpdir(), `wa-video-${id}.in`);
  const outPath1 = path.join(os.tmpdir(), `wa-video-${id}-p1.mp4`);
  const outPath2 = path.join(os.tmpdir(), `wa-video-${id}-p2.mp4`);

  try {
    await fs.writeFile(inPath, input);

    let lastError: unknown = null;
    for (const executable of ffmpegCandidates()) {
      try {
        const probe = await probeMediaWithFfmpeg(executable, inPath);
        const durationSec = Math.max(1, Math.min(1800, probe.durationSec || 45));
        const hasAudio = probe.hasAudio;

        // Orçamento alvo de 14.0 MB no Passo 1 para ficar com folga abaixo dos 16 MB da Meta
        const targetBudgetBytes = 14 * 1024 * 1024;
        const totalKbps = Math.floor((targetBudgetBytes * 8) / 1000 / durationSec);
        const audioKbps = hasAudio ? (totalKbps > 600 ? 96 : totalKbps > 320 ? 64 : 48) : 0;
        const videoMaxKbps = Math.max(160, Math.min(2400, totalKbps - audioKbps - 24));
        const maxDim = videoMaxKbps >= 850 ? 1280 : videoMaxKbps >= 420 ? 854 : 640;
        const crf = videoMaxKbps >= 850 ? 26 : videoMaxKbps >= 420 ? 28 : 30;
        const fps = videoMaxKbps >= 420 ? 30 : 24;

        const pass1Args = buildEncodeArgs({
          inPath,
          outPath: outPath1,
          maxDim,
          fps,
          crf,
          preset: "veryfast",
          videoMaxKbps,
          hasAudio,
          audioKbps,
        });

        await runFfmpeg(executable, pass1Args, 120_000);
        const out1 = await fs.readFile(outPath1);
        if (out1.length === 0) throw new Error("ffmpeg gerou arquivo de vídeo vazio");

        if (out1.length <= META_VIDEO_MAX_BYTES) {
          return out1;
        }

        // Passo 2 de garantia: caso o Passo 1 ainda tenha ultrapassado 15 MB, aplica compressão mais agressiva
        const ratio = (13.2 * 1024 * 1024) / out1.length;
        const tighterVideoKbps = Math.max(120, Math.floor(videoMaxKbps * ratio));
        const pass2Args = buildEncodeArgs({
          inPath: outPath1,
          outPath: outPath2,
          maxDim: 640,
          fps: 20,
          crf: 31,
          preset: "ultrafast",
          videoMaxKbps: tighterVideoKbps,
          hasAudio,
          audioKbps: hasAudio ? 48 : 0,
        });

        await runFfmpeg(executable, pass2Args, 120_000);
        const out2 = await fs.readFile(outPath2);
        if (out2.length > 0 && out2.length < out1.length) {
          return out2;
        }
        return out1;
      } catch (err: any) {
        lastError = err;
        if (err?.code !== "ENOENT") break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("ffmpeg indisponível para compressão de vídeo");
  } finally {
    await fs.rm(inPath, { force: true }).catch(() => {});
    await fs.rm(outPath1, { force: true }).catch(() => {});
    await fs.rm(outPath2, { force: true }).catch(() => {});
  }
}
