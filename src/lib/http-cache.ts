import { createHash } from "node:crypto";

export interface CacheOptions {
  /**
   * Tempo máximo em segundos para cache no navegador (ex: 60 para 1 min, 300 para 5 min).
   * Se omitido, usará 'no-cache', o que exige revalidação condicional via ETag (HTTP 304).
   */
  maxAge?: number;
  /**
   * Se o cache é privado do usuário/navegador (padrão true para dados com isolamento multi-tenant).
   */
  isPrivate?: boolean;
  /**
   * Headers adicionais a serem mesclados na resposta.
   */
  headers?: Record<string, string>;
}

/**
 * Gera um ETag determinístico e ultrarrápido baseado no hash MD5 do conteúdo serializado.
 */
export function generateEtag(content: string): string {
  const hash = createHash("md5").update(content).digest("hex").slice(0, 16);
  return `"${hash}"`;
}

/**
 * Constrói uma resposta HTTP inteligente compatível com RFC 7232 e RFC 7234:
 * - Calcula o ETag a partir do corpo da resposta.
 * - Compara com o cabeçalho 'If-None-Match' enviado pelo navegador.
 * - Retorna HTTP 304 (Not Modified) sem corpo quando os dados não mudaram, poupando tráfego de rede e tempo de CPU de parsing JSON.
 * - Retorna HTTP 200 com os cabeçalhos 'ETag' e 'Cache-Control' atualizados quando o conteúdo foi modificado.
 */
export function handleConditionalResponse(
  request: Request,
  data: unknown,
  options: CacheOptions = {}
): Response {
  const bodyString = typeof data === "string" ? data : JSON.stringify(data);
  const etag = generateEtag(bodyString);
  const ifNoneMatch = request.headers.get("if-none-match");

  const isPrivate = options.isPrivate ?? true;
  const privacy = isPrivate ? "private" : "public";
  const cacheControl =
    options.maxAge !== undefined && options.maxAge > 0
      ? `${privacy}, max-age=${options.maxAge}, must-revalidate`
      : `${privacy}, no-cache`;

  const headers = new Headers(options.headers);
  headers.set("ETag", etag);
  headers.set("Cache-Control", cacheControl);

  // Verificação de If-None-Match para resposta 304
  if (ifNoneMatch) {
    const rawTokens = ifNoneMatch.split(",").map((t) => t.trim());
    const isMatched = rawTokens.some((token) => {
      if (token === "*") return true;
      // Trata tags fracas W/"..." e tags normais "..."
      const normalizedToken = token.startsWith("W/") ? token.slice(2) : token;
      const normalizedEtag = etag.startsWith("W/") ? etag.slice(2) : etag;
      return normalizedToken === normalizedEtag;
    });

    if (isMatched) {
      return new Response(null, {
        status: 304,
        headers,
      });
    }
  }

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return new Response(bodyString, {
    status: 200,
    headers,
  });
}
