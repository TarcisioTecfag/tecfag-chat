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
 * Aplica interpolação bicúbica progressiva em múltiplos estágios + suavização
 * morfológica de bordas (anti-aliasing) e deblocking para avatares legados de baixa
 * resolução (`< 384px`, como os antigos `120x120` JPEG 0.75).
 * Elimina degraus de pixel ("serrilhado" / aliasing) e macroblocos de compressão
 * sem aplicar unsharp mask agressivo (que geraria dentes de serra artificiais).
 * Fotos novas (`>= 384px`) são retornadas intactas sem custo de processamento.
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

        // Se já está em resolução suficiente (>= 384px), mantém exatamente o original
        if (w <= 0 || h <= 0 || w >= 384 || h >= 384) {
          enhancedAvatarCache.set(src, src);
          resolve(src);
          return;
        }

        // Multi-stage progressive smooth bicubic upscale (ex: 120 -> 192 -> 307 -> 384)
        // O step-up progressivo evita aliasing e quebras de gradiente típicas de upscales diretos
        const targetSize = 384;
        let currentW = w;
        let currentH = h;
        let currentCanvas = document.createElement("canvas");
        currentCanvas.width = currentW;
        currentCanvas.height = currentH;
        let currentCtx = currentCanvas.getContext("2d");
        if (!currentCtx) {
          enhancedAvatarCache.set(src, src);
          resolve(src);
          return;
        }
        currentCtx.drawImage(img, 0, 0);

        while (currentW < targetSize) {
          const nextW = Math.min(targetSize, Math.round(currentW * 1.55));
          const nextH = Math.min(targetSize, Math.round(currentH * 1.55));
          const nextCanvas = document.createElement("canvas");
          nextCanvas.width = nextW;
          nextCanvas.height = nextH;
          const nextCtx = nextCanvas.getContext("2d");
          if (!nextCtx) break;
          nextCtx.imageSmoothingEnabled = true;
          nextCtx.imageSmoothingQuality = "high";
          nextCtx.drawImage(currentCanvas, 0, 0, currentW, currentH, 0, 0, nextW, nextH);
          currentCanvas = nextCanvas;
          currentCtx = nextCtx;
          currentW = nextW;
          currentH = nextH;
        }

        // Suavização anti-aliasing direcionada para eliminar degraus de pixel e macroblocking JPEG
        const smoothCanvas = document.createElement("canvas");
        smoothCanvas.width = currentW;
        smoothCanvas.height = currentH;
        const smoothCtx = smoothCanvas.getContext("2d");

        if (smoothCtx) {
          smoothCtx.imageSmoothingEnabled = true;
          smoothCtx.imageSmoothingQuality = "high";
          smoothCtx.filter = "blur(1.2px)";
          smoothCtx.drawImage(currentCanvas, 0, 0);
          smoothCtx.filter = "none";

          const origData = currentCtx.getImageData(0, 0, currentW, currentH);
          const blurData = smoothCtx.getImageData(0, 0, currentW, currentH);
          const px = origData.data;
          const bpx = blurData.data;

          for (let i = 0; i < px.length; i += 4) {
            const r = px[i];
            const g = px[i + 1];
            const b = px[i + 2];

            const br = bpx[i];
            const bg = bpx[i + 1];
            const bb = bpx[i + 2];

            // Mede a variação local em todos os canais de cor
            const diff = Math.max(Math.abs(r - br), Math.abs(g - bg), Math.abs(b - bb));

            // Anti-aliasing adaptativo:
            // 1. Em áreas homogêneas (diff < 8, ex: fundo vermelho e tons contínuos de pele):
            //    mescla moderada para eliminar blocos JPEG 8x8 e ruído 4:2:0.
            // 2. Em bordas e transições (diff < 28, ex: contorno dos braços e queixo):
            //    suaviza os degraus de pixel (anti-aliasing suave), eliminando o serrilhado.
            // 3. Em contraste muito alto: preserva a geometria nítida sem criar dentes de serra.
            const blendFactor = diff < 8 ? 0.42 : diff < 28 ? 0.28 : 0.14;

            px[i] = Math.round(r * (1 - blendFactor) + br * blendFactor);
            px[i + 1] = Math.round(g * (1 - blendFactor) + bg * blendFactor);
            px[i + 2] = Math.round(b * (1 - blendFactor) + bb * blendFactor);
          }

          currentCtx.putImageData(origData, 0, 0);
        }

        const enhanced = exportCanvasHighQuality(currentCanvas, 0.94);
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
