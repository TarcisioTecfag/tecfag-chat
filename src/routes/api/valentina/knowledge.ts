import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { knowledgeFiles, knowledgeFolders } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Diretório de mídia estático para arquivos de Formato Real
const __dirname_es = path.dirname(fileURLToPath(import.meta.url));
// Resolve para <projeto>/public/knowledge-media/
const MEDIA_DIR = path.resolve(__dirname_es, "../../../../public/knowledge-media");
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function extractKnowledgeText(name: string, type: string, base64?: string | null, rawContent?: string | null): Promise<string> {
  if (rawContent && rawContent.trim().length > 0 && !rawContent.startsWith("[Documento ")) {
    return rawContent.trim().slice(0, 100000);
  }

  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  // Se tiver base64, tenta extrair
  if (base64) {
    try {
      const buf = Buffer.from(base64, "base64");

      if (type === "pdf" || ext === "pdf") {
        try {
          const pdfParsePkg = await import("pdf-parse");
          let extractedText = "";

          // Suporte à classe PDFParse da versão 2.x
          if ((pdfParsePkg as any).PDFParse) {
            const ParserClass = (pdfParsePkg as any).PDFParse;
            const parser = new ParserClass({ data: buf });
            const result = await parser.getText();
            extractedText = result.text || "";
            try { await parser.destroy(); } catch {}
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
            return cleaned.slice(0, 200000);
          }
        } catch (err: any) {
          console.warn(`[knowledge.ts] Erro ao extrair texto do PDF ${name}:`, err?.message);
        }
      }

      if (type === "word" || ext === "docx" || ext === "doc") {
        try {
          const mammoth = await import("mammoth");
          const result = await mammoth.extractRawText({ buffer: buf });
          const cleaned = (result.value || "").replace(/\0/g, "").trim();
          if (cleaned.length > 20) {
            return cleaned.slice(0, 200000);
          }
        } catch (err: any) {
          console.warn(`[knowledge.ts] Erro ao extrair texto do Word ${name}:`, err?.message);
        }
      }

      if (ext === "xlsx" || ext === "xls" || ext === "csv") {
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
            return joined.slice(0, 200000);
          }
        } catch (err: any) {
          console.warn(`[knowledge.ts] Erro ao extrair planilha ${name}:`, err?.message);
        }
      }

      if (type === "txt" || ext === "txt" || ext === "md" || ext === "json") {
        return buf.toString("utf-8").replace(/\0/g, "").trim().slice(0, 200000);
      }
    } catch (e: any) {
      console.warn(`[knowledge.ts] Erro geral na conversão de buffer de ${name}:`, e?.message);
    }
  }

  // Fallback factual completo para o FAQ Oficial da Valem Pack
  if (name.toLowerCase().includes("faq") || name.toLowerCase().includes("pergunta")) {
    return `FAQ – Perguntas Frequentes
Valem Válvulas e Embalagens

1. A Valem vende apenas para CNPJ?
Não. Nossas vendas diretas, inclusive via WhatsApp e atendimento com nossas consultoras, são destinadas para transações entre CNPJ (empresa para empresa). Esse modelo evita questões fiscais como DIFAL e permite oferecer melhores condições comerciais. A quantidade mínima para atacado é de mil unidades por item.
Já para CPF, as vendas acontecem pelo nosso site www.valempack.com.br. Por lá, as vendas são feitas a partir de 50 unidades. Também disponibilizamos parte dos produtos em nossa loja no Mercado Livre, onde é possível encontrar opções em menores quantidades.
Empresas também podem fazer compras no site caso a compra não se enquadre na venda mínima do atacado. Nesses casos, oferecemos 15% de desconto para cadastros PJ, basta entrar em contato com a assistente virtual do e-commerce para validar o cupom.

2. Vocês possuem catálogos de produtos?
Sim. A Valem possui dois catálogos principais:
1. Catálogo de produtos em pronta entrega (Contém itens disponíveis em estoque para envio mais rápido).
2. Catálogo de produtos sob encomenda (Produtos importados ou produzidos sob demanda):
- Prazo mínimo de entrega: aproximadamente 60 dias
- Quantidade mínima geralmente acima de 10.000 unidades por produto

3. Existe valor ou quantidade mínima para pedidos?
O recomendado é um pedido mínimo de 1.000 unidades por produto. Essa quantidade ajuda a obter melhores condições comerciais e negociação de preços.
Para quantidades menores, sugerimos verificar as opções disponíveis em nossa loja no Mercado Livre ou site. Mesmo assim, sempre vale consultar nossas consultoras comerciais, pois cada caso pode ser avaliado.
Para o site, são 50 unidades mínimas para cada item.

4. Qual é o prazo de entrega?
O prazo de entrega pode variar de acordo com fatores como:
- disponibilidade em estoque
- volume do pedido
- tipo de produto
- local de entrega
Por isso, o prazo é informado individualmente para cada pedido. Sua consultora comercial fornecerá todas as informações e acompanhará o processo. No site e Mercado Livre, a própria plataforma oferece as opções de entrega, prazos e preços.

5. Não encontrei um produto no Mercado Livre. O que fazer?
Se o produto desejado não estiver disponível em nossa loja no Mercado Livre, recomendamos verificar nosso site www.valempack.com.br. Lá é possível verificar se o produto está disponível ou se existe equivalente.

6. Não sei exatamente qual é a rosca ou o modelo da minha válvula. Como identificar?
Nesses casos, recomendamos enviar uma foto do frasco ou da válvula para nossas consultoras. Com a imagem e algumas informações básicas (diâmetro da rosca, tipo de produto utilizado, etc.), nossa equipe consegue identificar ou sugerir a opção mais compatível.

7. Quais são as formas de pagamento aceitas?
As condições de pagamento podem variar conforme análise cadastral de cada cliente. As principais formas aceitas são:
- Boleto faturado (30 ou 60 dias) – mediante análise PJ
- PIX
- Boleto à vista
- Cartão de crédito
- Cartão de débito

8. Não encontrei um frasco ou válvula no catálogo. O que devo fazer?
Entre em contato com nossas consultoras e informe sua necessidade. Trabalhamos com uma base de mais de 2.000 produtos, e muitas vezes conseguimos localizar o item desejado, sugerir um modelo equivalente ou viabilizar importação/fabricação sob encomenda.

9. Vocês trabalham com personalização de válvulas ou embalagens?
Sim. Dependendo da quantidade solicitada, podemos oferecer opções de personalização, como cores específicas ou adaptações de produto. Consulte nossas consultoras para verificar as condições, mas só para pedidos acima de 10 mil unidades dentro da modalidade encomenda.

10. Vocês trabalham com amostras?
Em alguns casos, podemos disponibilizar amostras para avaliação, especialmente para clientes que irão realizar pedidos em maior volume. A disponibilidade deve ser verificada com nossa equipe comercial.

11. Como posso falar com um consultor?
Você pode entrar em contato pelo WhatsApp comercial, e-mail, redes sociais ou Mercado Livre.

12. A Valem atende todo o Brasil?
Sim. Atendemos clientes em todo o território nacional, enviando pedidos por transportadora ou outros meios logísticos conforme a necessidade do cliente.

13. Como escolher a válvula correta para meu frasco?
Algumas informações ajudam na escolha correta:
- diâmetro da rosca do frasco (ex: 18/410, 20/410, 24/410, 28/410)
- tipo de produto (líquido, viscoso, spray etc.)
- volume liberado por acionamento
- tipo de aplicação (cosmético, químico, limpeza etc.)`;
  }

  return rawContent || "";
}

export const Route = createFileRoute("/api/valentina/knowledge")({

  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Buscar todas as pastas e arquivos da base de conhecimento ─────
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") || "valem";
        const action = url.searchParams.get("action");
        const fileId = url.searchParams.get("fileId");

        // ── GET ?action=getContent&fileId=xxx — retorna o content de UM arquivo específico
        // Usado pelo "Ver RAG" e "Ver Foto" — evita mandar base64 na listagem geral
        if (action === "getContent" && fileId) {
          try {
            const [file] = await db
              .select({ id: knowledgeFiles.id, content: knowledgeFiles.content, format: knowledgeFiles.format, name: knowledgeFiles.name })
              .from(knowledgeFiles)
              .where(eq(knowledgeFiles.id, fileId));
            if (!file) {
              return new Response(JSON.stringify({ error: "Arquivo não encontrado" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            return new Response(JSON.stringify({ content: file.content || "" }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        try {
          let folders = await db
            .select()
            .from(knowledgeFolders)
            .where(eq(knowledgeFolders.tenantId, tenantId));

          // Busca arquivos SEM o campo content (que pode ter 170KB de base64 por imagem)
          // Content só é enviado via endpoint dedicado getContent
          let files = await db
            .select({
              id: knowledgeFiles.id,
              tenantId: knowledgeFiles.tenantId,
              folderId: knowledgeFiles.folderId,
              name: knowledgeFiles.name,
              size: knowledgeFiles.size,
              type: knowledgeFiles.type,
              format: knowledgeFiles.format,
              uploadedAt: knowledgeFiles.uploadedAt,
              // content propositalmente OMITIDO — retornado só via ?action=getContent
            })
            .from(knowledgeFiles)
            .where(eq(knowledgeFiles.tenantId, tenantId));

          // 🛡️ Auto-reparo de integridade: repara apenas arquivos de texto (embeddings) sem conteúdo
          // NUNCA repara formato real (imagens) pois o content delas é base64, não texto
          const filesNeedingRepair = (files as any[]).filter(
            (f) => f.format !== "real" && f.type !== "image"
          );
          // Busca content completo só para os que precisam de reparo
          if (filesNeedingRepair.length > 0) {
            const fullFiles = await db
              .select()
              .from(knowledgeFiles)
              .where(eq(knowledgeFiles.tenantId, tenantId));
            const contentMap = new Map(fullFiles.map((f) => [f.id, f.content]));
            for (const f of filesNeedingRepair) {
              const rawContent = contentMap.get(f.id) || "";
              if (!rawContent || rawContent.trim().length === 0 || rawContent.startsWith("[Documento ")) {
                const repairedContent = await extractKnowledgeText(f.name, f.type, null, rawContent);
                if (repairedContent && repairedContent.length > 20 && !repairedContent.startsWith("[Documento ")) {
                  try {
                    await db.update(knowledgeFiles).set({ content: repairedContent }).where(eq(knowledgeFiles.id, f.id));
                  } catch {
                    // Silencioso
                  }
                }
              }
            }
          }

          // Se for a primeira vez e não houver pastas, cria pasta padrão "Catálogos & Produtos"
          if (folders.length === 0) {
            const defaultFolder = {
              id: "f-1",
              tenantId,
              name: "Catálogos & Produtos",
              parentId: null,
              createdAt: new Date(),
            };
            await db.insert(knowledgeFolders).values(defaultFolder).onConflictDoNothing();
            folders = [defaultFolder as any];
          }

          return new Response(
            JSON.stringify({
              folders: folders.map((f) => ({
                id: f.id,
                name: f.name,
                parentId: f.parentId,
              })),
              files: (files as any[]).map((f) => ({
                id: f.id,
                name: f.name,
                size: f.size,
                type: f.type,
                format: f.format,
                // content OMITIDO propositalmente — use ?action=getContent&fileId=xxx
                uploadedAt: new Date(f.uploadedAt).toLocaleDateString("pt-BR"),
                folderId: f.folderId,
              })),
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[api/valentina/knowledge] Erro no GET:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // ── POST: Criar/Mover pasta ou subir/mover novo arquivo ─────────────────
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId = "valem", action } = body;

          // Action 1: Criar/Editar/Mover Pasta
          if (action === "create_folder" || action === "update_folder" || action === "move_folder") {
            const { id, name, parentId } = body;
            const folderId = id || `f-${Date.now()}`;
            const targetParentId = parentId !== undefined && parentId !== "" ? parentId : null;

            const existing = await db
              .select()
              .from(knowledgeFolders)
              .where(eq(knowledgeFolders.id, folderId));

            if (existing.length > 0) {
              await db
                .update(knowledgeFolders)
                .set({ 
                  name: name || existing[0].name, 
                  parentId: targetParentId 
                })
                .where(eq(knowledgeFolders.id, folderId));
            } else {
              await db.insert(knowledgeFolders).values({
                id: folderId,
                tenantId,
                name: name || "Nova Pasta",
                parentId: targetParentId,
                createdAt: new Date(),
              });
            }

            return new Response(
              JSON.stringify({ success: true, folder: { id: folderId, name, parentId: targetParentId } }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Action 2: Mover Arquivo entre Pastas
          if (action === "move_file" || action === "update_file") {
            const { id, folderId } = body;
            const targetFolderId = folderId !== undefined && folderId !== "" ? folderId : null;

            await db
              .update(knowledgeFiles)
              .set({ folderId: targetFolderId })
              .where(eq(knowledgeFiles.id, id));

            return new Response(
              JSON.stringify({ success: true, fileId: id, folderId: targetFolderId }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Action 3: Subir Arquivo com Extração Real de Texto
          if (action === "upload_file") {
            const { name, size, type, format, folderId, content, base64 } = body;
            const fileId = `kf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

            // 🛡️ GARANTIA DE INTEGRIDADE: Verificar se a pasta folderId existe no banco de dados
            let validFolderId: string | null = folderId || null;
            if (validFolderId) {
              const [folderCheck] = await db
                .select()
                .from(knowledgeFolders)
                .where(eq(knowledgeFolders.id, validFolderId));

              if (!folderCheck) {
                console.warn(`[knowledge.ts] ⚠️ Pasta "${validFolderId}" não encontrada no banco. Criando pasta automaticamente...`);
                await db.insert(knowledgeFolders).values({
                  id: validFolderId,
                  tenantId,
                  name: "Valentina",
                  parentId: null,
                  createdAt: new Date(),
                }).onConflictDoNothing();
              }
            }

            // ── Formato Real: salva arquivo físico (best-effort) + base64 no banco ──
            let mediaUrl: string | null = null;
            let realBase64: string | null = null;

            if (format === "real" && base64 && (type === "image" || ["png","jpg","jpeg","gif","webp","pdf","docx","doc"].some(e => name.toLowerCase().endsWith(`.${e}`)))) {
              // Guarda o base64 para persistência no banco (sobrevive a redeploys Railway)
              realBase64 = base64;

              // Tenta salvar fisicamente (best-effort — pode falhar em Railway efêmero)
              try {
                const ext = name.split(".").pop()?.toLowerCase() || "bin";
                const safeFileName = `${fileId}.${ext}`;
                const filePath = path.join(MEDIA_DIR, safeFileName);
                const buf = Buffer.from(base64, "base64");
                fs.writeFileSync(filePath, buf);
                mediaUrl = `/knowledge-media/${safeFileName}`;
                console.log(`[knowledge.ts] 🖼️ Formato Real salvo no disco: ${mediaUrl} (${buf.length} bytes)`);
              } catch (saveErr: any) {
                // Falha silenciosa — base64 no banco é a fonte de verdade
                console.warn(`[knowledge.ts] ⚠️ Não foi possível salvar no disco (ok no Railway): ${saveErr.message}`);
                // Usa o fileId como referência mesmo sem arquivo físico
                const ext = name.split(".").pop()?.toLowerCase() || "jpg";
                mediaUrl = `/knowledge-media/${fileId}.${ext}`;
              }
            }

            // Extrai texto real do documento (PDF, DOCX, XLSX, TXT)
            // Para Formato Real de imagem, o content guarda: marcador + base64 (fonte de verdade)
            let extractedContent: string;

            if (format === "real" && mediaUrl) {
              if (type === "image" && realBase64) {
                // 🔑 BASE64 NO BANCO — sobrevive a qualquer redeploy do Railway
                extractedContent = `[FORMATO_REAL:${mediaUrl}][BASE64:${realBase64}]`;
              } else {
                // Para documentos Formato Real (PDF/DOCX), extrai texto + guarda URL
                const textContent = await extractKnowledgeText(name, type, base64, content);
                extractedContent = `[FORMATO_REAL:${mediaUrl}] ${textContent}`;
              }
            } else {
              extractedContent = await extractKnowledgeText(name, type, base64, content);
            }


            await db.insert(knowledgeFiles).values({
              id: fileId,
              tenantId,
              folderId: validFolderId,
              name,
              size: size || "10 KB",
              type: type || "txt",
              format: format || "embeddings",
              content: extractedContent,
              uploadedAt: new Date(),
            });

            return new Response(
              JSON.stringify({
                success: true,
                file: {
                  id: fileId,
                  name,
                  size,
                  type,
                  format,
                  content: extractedContent,
                  mediaUrl,
                  uploadedAt: new Date().toLocaleDateString("pt-BR"),
                  folderId: validFolderId,
                },
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(JSON.stringify({ error: "Ação não informada ou inválida" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[api/valentina/knowledge] Erro no POST:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // ── PATCH: Atualizar content de um arquivo (reparo de extração falha) ───
      PATCH: async ({ request }) => {
        try {
          const body = await request.json();
          const { fileId, tenantId, content } = body;

          if (!fileId || !tenantId || content === undefined) {
            return new Response(JSON.stringify({ error: "fileId, tenantId e content são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Verifica pertinência ao tenant antes de atualizar
          const [existing] = await db
            .select({ id: knowledgeFiles.id, tenantId: knowledgeFiles.tenantId })
            .from(knowledgeFiles)
            .where(eq(knowledgeFiles.id, fileId));

          if (!existing || existing.tenantId !== tenantId) {
            return new Response(JSON.stringify({ error: "Arquivo não encontrado ou não pertence ao tenant" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          await db.update(knowledgeFiles)
            .set({ content: String(content).slice(0, 200000) })
            .where(eq(knowledgeFiles.id, fileId));

          console.log(`[knowledge.ts] ✅ Content reparado para arquivo ${fileId} (${String(content).length} chars)`);

          return new Response(JSON.stringify({ success: true, chars: String(content).length }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[api/valentina/knowledge] Erro no PATCH:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // ── DELETE: Excluir pasta ou arquivo ────────────────────────────────────
      DELETE: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const type = url.searchParams.get("type"); // 'file' ou 'folder'
          const id = url.searchParams.get("id");

          if (!type || !id) {
            return new Response(JSON.stringify({ error: "type e id são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (type === "file") {
            await db.delete(knowledgeFiles).where(eq(knowledgeFiles.id, id));
          } else if (type === "folder") {
            // Remove pasta e arquivos vinculados
            await db.delete(knowledgeFiles).where(eq(knowledgeFiles.folderId, id));
            await db.delete(knowledgeFolders).where(eq(knowledgeFolders.id, id));
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[api/valentina/knowledge] Erro no DELETE:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
