/**
 * Utilitário de processamento de fotos de perfil (avatares) em alta definição.
 *
 * 1. `compressAvatarFile`:
 *    - Recorta o quadrado central da imagem original.
 *    - Aplica reamostragem progressiva (step-down em múltiplos de 2x com
 *      `imageSmoothingQuality = "high"`) até até `512 × 512 px` (evitando
 *      serrilhado/aliasing ao reduzir fotos grandes de câmera/estúdio).
 *    - Codifica em `image/webp` com qualidade `0.92` (preservando fundos
 *      vermelhos saturados sem o macroblocking `4:2:0` do JPEG `0.75`), com
 *      fallback automático para `image/jpeg` `0.92`.
 *
 * 2. `enhanceLegacyAvatarSrc`:
 *    - Para fotos legadas já salvas no banco em `120 × 120 px` (`data:image/`),
 *      executa uma reamostragem bicúbica `high` para `360 × 360 px` combinada
 *      com nitidez seletiva apenas no canal de luminância (preservando a
 *      suavidade do fundo vermelho sem amplificar ruído de crominância JPEG).
 */

const DEFAULT_AVATAR_TARGET_SIZE = 512;
const DEFAULT_AVATAR_QUALITY = 0.92;

const enhancedAvatarCache = new Map<string, string>();
const pendingEnhancements = new Map<string, Promise<string>>();

function exportCanvasHighQuality(
  canvas: HTMLCanvasElement,
  quality = DEFAULT_AVATAR_QUALITY,
): string {
  try {
    const webp = canvas.toDataURL("image/webp", quality);
    if (webp.startsWith("data:image/webp")) {
      return webp;
    }
  } catch {
    // Fallback para JPEG caso o navegador não suporte codificação WebP
  }
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Redimensiona e comprime um arquivo de imagem para avatar quadrado em HD (`512x512`).
 */
export function compressAvatarFile(
  file: File,
  maxSize = DEFAULT_AVATAR_TARGET_SIZE,
  quality = DEFAULT_AVATAR_QUALITY,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo de imagem."));
    reader.onloadend = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Resultado de leitura de imagem inválido."));
        return;
      }

      const img = new Image();
      img.onerror = () => reject(new Error("Falha ao decodificar a imagem selecionada."));
      img.onload = () => {
        try {
          const minSide = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
          if (minSide <= 0) {
            reject(new Error("Dimensões da imagem inválidas."));
            return;
          }

          const sx = ((img.naturalWidth || img.width) - minSide) / 2;
          const sy = ((img.naturalHeight || img.height) - minSide) / 2;
          const targetSize = Math.min(maxSize, Math.max(minSide, 256));

          // 1º estágio: recorte quadrado na resolução original (ou primeiro passo de redução)
          let currentSize = minSide;
          let workCanvas = document.createElement("canvas");
          let workCtx = workCanvas.getContext("2d");

          if (!workCtx) {
            reject(new Error("Contexto 2D indisponível."));
            return;
          }

          // Redução progressiva pela metade (evita aliasing quando a foto original é muito grande, ex: 3000px -> 512px)
          if (currentSize > targetSize * 2) {
            const firstStepSize = Math.max(targetSize, Math.floor(currentSize / 2));
            workCanvas.width = firstStepSize;
            workCanvas.height = firstStepSize;
            workCtx.imageSmoothingEnabled = true;
            workCtx.imageSmoothingQuality = "high";
            workCtx.drawImage(img, sx, sy, minSide, minSide, 0, 0, firstStepSize, firstStepSize);
            currentSize = firstStepSize;

            while (currentSize > targetSize * 2) {
              const nextSize = Math.max(targetSize, Math.floor(currentSize / 2));
              const stepCanvas = document.createElement("canvas");
              stepCanvas.width = nextSize;
              stepCanvas.height = nextSize;
              const stepCtx = stepCanvas.getContext("2d");
              if (!stepCtx) break;
              stepCtx.imageSmoothingEnabled = true;
              stepCtx.imageSmoothingQuality = "high";
              stepCtx.drawImage(workCanvas, 0, 0, currentSize, currentSize, 0, 0, nextSize, nextSize);
              workCanvas = stepCanvas;
              workCtx = stepCtx;
              currentSize = nextSize;
            }

            const finalCanvas = document.createElement("canvas");
            finalCanvas.width = targetSize;
            finalCanvas.height = targetSize;
            const finalCtx = finalCanvas.getContext("2d");
            if (!finalCtx) {
              resolve(exportCanvasHighQuality(workCanvas, quality));
              return;
            }
            finalCtx.imageSmoothingEnabled = true;
            finalCtx.imageSmoothingQuality = "high";
            finalCtx.drawImage(workCanvas, 0, 0, currentSize, currentSize, 0, 0, targetSize, targetSize);
            resolve(exportCanvasHighQuality(finalCanvas, quality));
            return;
          }

          workCanvas.width = targetSize;
          workCanvas.height = targetSize;
          workCtx.imageSmoothingEnabled = true;
          workCtx.imageSmoothingQuality = "high";
          workCtx.drawImage(img, sx, sy, minSide, minSide, 0, 0, targetSize, targetSize);
          resolve(exportCanvasHighQuality(workCanvas, quality));
        } catch (err) {
          reject(err instanceof Error ? err : new Error("Erro ao processar avatar."));
        }
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Aplica suavização de blocos JPEG + realce sutil de luminância para avatares
 * legados de baixa resolução (`<= 160px`, como os antigos `120x120` JPEG 0.75).
 * Fotos novas (`> 160px`) são retornadas intactas sem custo de processamento.
 */
export function enhanceLegacyAvatarSrc(src: string | null | undefined): Promise<string | null> {
  if (!src) return Promise.resolve(null);
  if (typeof window === "undefined") return Promise.resolve(src);
  if (!src.startsWith("data:image/")) return Promise.resolve(src);

  const cached = enhancedAvatarCache.get(src);
  if (cached) return Promise.resolve(cached);

  const inflight = pendingEnhancements.get(src);
  if (inflight) return inflight;

  const task = new Promise<string>((resolve) => {
    const img = new Image();
    img.onerror = () => {
      enhancedAvatarCache.set(src, src);
      resolve(src);
    };
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;

        // Se já está em boa resolução (> 160px), mantém exatamente o original
        if (w <= 0 || h <= 0 || w > 160 || h > 160) {
          enhancedAvatarCache.set(src, src);
          resolve(src);
          return;
        }

        // Upscale 3x (ex: 120x120 -> 360x360) em 2 estágios com interpolação bicúbica "high"
        const midW = w * 2;
        const midH = h * 2;
        const midCanvas = document.createElement("canvas");
        midCanvas.width = midW;
        midCanvas.height = midH;
        const midCtx = midCanvas.getContext("2d");
        if (!midCtx) {
          enhancedAvatarCache.set(src, src);
          resolve(src);
          return;
        }
        midCtx.imageSmoothingEnabled = true;
        midCtx.imageSmoothingQuality = "high";
        midCtx.drawImage(img, 0, 0, midW, midH);

        const outW = w * 3;
        const outH = h * 3;
        const outCanvas = document.createElement("canvas");
        outCanvas.width = outW;
        outCanvas.height = outH;
        const outCtx = outCanvas.getContext("2d");
        if (!outCtx) {
          enhancedAvatarCache.set(src, src);
          resolve(src);
          return;
        }
        outCtx.imageSmoothingEnabled = true;
        outCtx.imageSmoothingQuality = "high";
        outCtx.drawImage(midCanvas, 0, 0, outW, outH);

        // Cria versão levemente suavizada para extrair apenas detalhe de luminância (Unsharp Mask em Y)
        const blurCanvas = document.createElement("canvas");
        blurCanvas.width = outW;
        blurCanvas.height = outH;
        const blurCtx = blurCanvas.getContext("2d");

        if (blurCtx) {
          blurCtx.imageSmoothingEnabled = true;
          blurCtx.imageSmoothingQuality = "high";
          blurCtx.filter = "blur(1.1px)";
          blurCtx.drawImage(outCanvas, 0, 0);
          blurCtx.filter = "none";

          const origData = outCtx.getImageData(0, 0, outW, outH);
          const blurData = blurCtx.getImageData(0, 0, outW, outH);
          const px = origData.data;
          const bpx = blurData.data;
          const amount = 0.42; // Nitidez moderada apenas na luminância (rosto/olhos)

          for (let i = 0; i < px.length; i += 4) {
            const r = px[i];
            const g = px[i + 1];
            const b = px[i + 2];

            const br = bpx[i];
            const bg = bpx[i + 1];
            const bb = bpx[i + 2];

            // Luminância Rec.601
            const yOrig = 0.299 * r + 0.587 * g + 0.114 * b;
            const yBlur = 0.299 * br + 0.587 * bg + 0.114 * bb;
            const diffY = yOrig - yBlur;

            // Ignora micro-ruído de blocagem JPEG (< 2 níveis) e realça bordas reais
            const delta = Math.abs(diffY) < 1.8 ? 0 : diffY * amount;

            // Suaviza levemente a crominância (reduz blocos vermelhos 4:2:0) mantendo a luminância nítida
            const smoothR = r * 0.75 + br * 0.25 + delta;
            const smoothG = g * 0.75 + bg * 0.25 + delta;
            const smoothB = b * 0.75 + bb * 0.25 + delta;

            px[i] = smoothR < 0 ? 0 : smoothR > 255 ? 255 : smoothR;
            px[i + 1] = smoothG < 0 ? 0 : smoothG > 255 ? 255 : smoothG;
            px[i + 2] = smoothB < 0 ? 0 : smoothB > 255 ? 255 : smoothB;
          }

          outCtx.putImageData(origData, 0, 0);
        }

        const enhanced = exportCanvasHighQuality(outCanvas, 0.92);
        enhancedAvatarCache.set(src, enhanced);
        resolve(enhanced);
      } catch {
        enhancedAvatarCache.set(src, src);
        resolve(src);
      }
    };
    img.src = src;
  }).finally(() => {
    pendingEnhancements.delete(src);
  });

  pendingEnhancements.set(src, task);
  return task;
}
