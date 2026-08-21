// ══════════════════════════════════════════════════════════════════════════════
// 📄 LIVE CHAT DOCUMENT & MEDIA READER
// Processa e extrai o conteúdo real de anexos (Imagens, PDFs, Planilhas, DOCX)
// para que o Gemini Flash leia o conteúdo de fato em vez de apenas o nome do arquivo.
// ══════════════════════════════════════════════════════════════════════════════

import * as XLSX from "xlsx";
import mammoth from "mammoth";

export interface ParsedMediaAttachment {
  inlineData?: {
    mimeType: string;
    data: string; // Base64 limpo
  };
  extractedSummary?: string;
}

/**
 * Analisa e extrai o conteúdo de um arquivo enviado pelo visitante
 */
export async function extractMediaContent(
  fileBase64: string,
  fileName: string,
  fileType: string
): Promise<ParsedMediaAttachment> {
  const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, "");
  const mime = (fileType || "").toLowerCase();
  const lowerName = (fileName || "").toLowerCase();

  // 1. IMAGENS (PNG, JPEG, WEBP) → Envio multimodal nativo inlineData para o Gemini Flash
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(lowerName)) {
    const cleanMime = mime.startsWith("image/") ? mime.split(";")[0].trim() : "image/jpeg";
    return {
      inlineData: {
        mimeType: cleanMime,
        data: cleanBase64,
      },
      extractedSummary: `[O cliente enviou uma foto/imagem: "${fileName}" que foi carregada visualmente para você analisar]`,
    };
  }

  // 2. PLANILHAS (XLSX, XLS, CSV) → Extração do conteúdo das células
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime.includes("csv") ||
    /\.(xlsx|xls|csv)$/i.test(lowerName)
  ) {
    try {
      const buffer = Buffer.from(cleanBase64, "base64");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheetNames = workbook.SheetNames;
      let textContent = "";

      for (const sheetName of sheetNames.slice(0, 3)) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        if (csv.trim()) {
          textContent += `\n--- Aba "${sheetName}" ---\n${csv.slice(0, 3000)}`;
        }
      }

      if (textContent.trim()) {
        return {
          extractedSummary: `[O cliente enviou a planilha "${fileName}". Veja o conteúdo extraído]:\n${textContent.slice(0, 4000)}`,
        };
      }
    } catch (e: any) {
      console.warn("[DocumentReader] Erro ao extrair XLSX:", e?.message);
    }
  }

  // 3. DOCUMENTOS WORD (DOCX)
  if (mime.includes("wordprocessingml") || lowerName.endsWith(".docx")) {
    try {
      const buffer = Buffer.from(cleanBase64, "base64");
      const result = await mammoth.extractRawText({ buffer });
      if (result.value?.trim()) {
        return {
          extractedSummary: `[O cliente enviou o documento Word "${fileName}". Conteúdo do texto]:\n${result.value.slice(0, 4000)}`,
        };
      }
    } catch (e: any) {
      console.warn("[DocumentReader] Erro ao extrair DOCX:", e?.message);
    }
  }

  // 4. PDFs → Envio multimodal para o Gemini Flash (ele lê PDF nativamente)
  if (mime.includes("pdf") || lowerName.endsWith(".pdf")) {
    return {
      inlineData: {
        mimeType: "application/pdf",
        data: cleanBase64,
      },
      extractedSummary: `[O cliente enviou um documento PDF: "${fileName}" anexado para você ler]`,
    };
  }

  // Fallback para outros tipos de arquivos
  return {
    extractedSummary: `[O cliente enviou um anexo chamado "${fileName}"]`,
  };
}
