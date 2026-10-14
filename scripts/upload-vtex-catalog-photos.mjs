/**
 * SCRIPT DE IMPORTAÇÃO EM MASSA DAS 447 FOTOS DE MÁQUINAS DA VTEX NA BASE DE CONHECIMENTO (TENANT TECFAG)
 *
 * Origem padrão: C:\Users\TEC FAG\Desktop\FOTOS MAQUINAS VTEX\1 - Por Categoria
 *
 * Modos de execução:
 *   1. Banco PostgreSQL direto (local ou remoto via DATABASE_URL):
 *      bun run scripts/upload-vtex-catalog-photos.mjs
 *
 *   2. Via API HTTPS autenticada (ex: Railway https://tecfagchat.up.railway.app):
 *      bun run scripts/upload-vtex-catalog-photos.mjs --api=https://tecfagchat.up.railway.app --email=SEU_EMAIL --password=SUA_SENHA
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (typeof process.loadEnvFile === "function") {
  try {
    if (fs.existsSync(".env")) process.loadEnvFile(".env");
  } catch {}
}

const args = process.argv.slice(2);
const apiUrlArg = args.find((a) => a.startsWith("--api="))?.split("=")[1];
const emailArg = args.find((a) => a.startsWith("--email="))?.split("=")[1];
const passwordArg = args.find((a) => a.startsWith("--password="))?.split("=")[1];
const tenantId = args.find((a) => a.startsWith("--tenant="))?.split("=")[1] || "tecfag";

const SOURCE_DIR = "C:\\Users\\TEC FAG\\Desktop\\FOTOS MAQUINAS VTEX\\1 - Por Categoria";
const MEDIA_DIR = path.resolve(__dirname, "../public/knowledge-media");

function formatFileSize(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function slugifyId(str) {
  const raw = String(str || "").trim();
  const hash = crypto.createHash("sha1").update(raw.toLowerCase()).digest("hex").slice(0, 8);
  const slug = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return `${slug}-${hash}`;
}

function scanCategoryPhotos(rootDir) {
  if (!fs.existsSync(rootDir)) {
    throw new Error(`Diretório de fotos não encontrado: ${rootDir}`);
  }

  const categories = fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  const items = [];
  for (const catName of categories) {
    const catPath = path.join(rootDir, catName);
    const files = fs
      .readdirSync(catPath, { withFileTypes: true })
      .filter((f) => f.isFile() && /\.(png|jpg|jpeg|webp|gif)$/i.test(f.name))
      .map((f) => f.name)
      .sort((a, b) => a.localeCompare(b, "pt-BR"));

    for (const fileName of files) {
      const fullPath = path.join(catPath, fileName);
      const stat = fs.statSync(fullPath);
      items.push({
        category: catName,
        name: fileName,
        fullPath,
        sizeBytes: stat.size,
        sizeLabel: formatFileSize(stat.size),
      });
    }
  }

  return { categories, items };
}

async function runViaApi(baseUrl, email, password, categories, items) {
  console.log(`🌐 Conectando via API HTTPS em ${baseUrl} (tenant: ${tenantId})...`);
  const loginRes = await fetch(`${baseUrl.replace(/\/$/, "")}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tenantId }),
  });

  if (!loginRes.ok) {
    const errText = await loginRes.text();
    throw new Error(`Falha no login (${loginRes.status}): ${errText}`);
  }

  const setCookie = loginRes.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Servidor não retornou cookie de sessão no login.");
  }
  const cookieHeader = setCookie.split(";")[0];
  console.log(`✅ Autenticado com sucesso! Criando/verificando ${categories.length} pastas de categorias...`);

  const categoryToFolderId = new Map();
  for (const catName of categories) {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/valentina/knowledge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        tenantId,
        action: "create_folder",
        id: `f-tf-cat-${slugifyId(catName)}`,
        name: catName,
        parentId: null,
      }),
    });
    if (!res.ok) {
      throw new Error(`Erro ao criar pasta ${catName}: HTTP ${res.status}`);
    }
    const data = await res.json();
    categoryToFolderId.set(catName, data.folder.id);
  }

  const BATCH_SIZE = 8;
  let uploaded = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const slice = items.slice(i, i + BATCH_SIZE);
    const batchPayload = slice.map((item) => {
      const buf = fs.readFileSync(item.fullPath);
      return {
        name: item.name,
        size: item.sizeLabel,
        type: "image",
        format: "real",
        folderId: categoryToFolderId.get(item.category) || null,
        base64: buf.toString("base64"),
      };
    });

    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/valentina/knowledge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        tenantId,
        action: "upload_batch",
        items: batchPayload,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro no lote ${i}: HTTP ${res.status} - ${errText}`);
    }

    uploaded += slice.length;
    process.stdout.write(`\r📸 Progresso: ${uploaded}/${items.length} fotos enviadas...`);
  }

  console.log(`\n🎉 Concluído! ${uploaded} fotos de máquinas sincronizadas em ${categories.length} categorias.`);
}

async function runViaPostgres(categories, items) {
  const dbUrl = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/valemchat";
  const sql = postgres(dbUrl, { max: 5, prepare: false });

  try {
    if (!fs.existsSync(MEDIA_DIR)) {
      fs.mkdirSync(MEDIA_DIR, { recursive: true });
    }

    console.log(`🗄️ Sincronizando ${items.length} fotos e ${categories.length} categorias no PostgreSQL (tenant: ${tenantId})...`);

    const categoryToFolderId = new Map();
    for (const catName of categories) {
      const folderId = `f-tf-cat-${slugifyId(catName)}`;
      const existing = await sql`
        SELECT id FROM knowledge_folders
        WHERE tenant_id = ${tenantId} AND lower(name) = lower(${catName})
        LIMIT 1
      `;
      const effectiveFolderId = existing[0]?.id || folderId;

      if (!existing[0]) {
        await sql`
          INSERT INTO knowledge_folders (id, tenant_id, name, parent_id, created_at)
          VALUES (${effectiveFolderId}, ${tenantId}, ${catName}, NULL, NOW())
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
        `;
      }
      categoryToFolderId.set(catName, effectiveFolderId);
    }

    let count = 0;
    for (const item of items) {
      const fileId = `kf-tf-vtex-${slugifyId(item.name.replace(/\.[^.]+$/, ""))}`;
      const ext = (item.name.split(".").pop() || "png").toLowerCase();
      const safeFileName = `${fileId}.${ext}`;
      const mediaUrl = `/knowledge-media/${safeFileName}`;
      const buf = fs.readFileSync(item.fullPath);
      const base64 = buf.toString("base64");
      const content = `[FORMATO_REAL:${mediaUrl}][BASE64:${base64}]`;
      const folderId = categoryToFolderId.get(item.category) || null;

      fs.writeFileSync(path.join(MEDIA_DIR, safeFileName), buf);

      await sql`
        INSERT INTO knowledge_files (
          id, tenant_id, folder_id, name, size, type, format, content, uploaded_at
        )
        VALUES (
          ${fileId}, ${tenantId}, ${folderId}, ${item.name}, ${item.sizeLabel}, 'image', 'real', ${content}, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          folder_id = EXCLUDED.folder_id,
          name = EXCLUDED.name,
          size = EXCLUDED.size,
          type = 'image',
          format = 'real',
          content = EXCLUDED.content,
          uploaded_at = NOW()
      `;

      count++;
      if (count % 50 === 0 || count === items.length) {
        console.log(`  ✓ ${count}/${items.length} máquinas importadas...`);
      }
    }

    console.log(`✅ Sucesso absoluto! ${count} fotos reais salvas em ${categories.length} categorias para o tenant '${tenantId}'.`);
  } finally {
    await sql.end();
  }
}

async function main() {
  const { categories, items } = scanCategoryPhotos(SOURCE_DIR);
  console.log(`📦 Encontradas ${items.length} fotos de máquinas distribuídas em ${categories.length} categorias.`);

  if (apiUrlArg) {
    if (!emailArg || !passwordArg) {
      throw new Error("Ao usar --api=URL, informe também --email=... e --password=...");
    }
    await runViaApi(apiUrlArg, emailArg, passwordArg, categories, items);
  } else {
    await runViaPostgres(categories, items);
  }
}

main().catch((err) => {
  console.error("❌ Erro:", err.message || err);
  process.exit(1);
});
