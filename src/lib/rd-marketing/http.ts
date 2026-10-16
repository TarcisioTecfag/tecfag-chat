import { CrmError } from "../crm/crm-service";

export async function readIntegrationJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new CrmError("Envie um JSON válido.", "INVALID_JSON", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512 * 1024) {
        await reader.cancel();
        throw new CrmError("Payload excede 512 KB.", "PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CrmError("Envie um JSON válido.", "INVALID_JSON", 400);
  }
}

export function integrationError(error: unknown): Response {
  const known = error as { statusCode?: number; message?: string; code?: string };
  const status = known.statusCode || 500;
  const safeProviderMessages: Record<string, string> = {
    RD_FIELDS_INVALID:
      "O RD retornou uma lista de campos inválida. A configuração não foi ativada.",
    RD_UNAVAILABLE: "O RD não respondeu. Aguarde e tente novamente.",
    RD_RESPONSE_INVALID: "O RD retornou uma resposta inválida. Tente novamente.",
    RD_RESPONSE_TOO_LARGE: "A resposta do RD excedeu o limite da consulta.",
  };
  const providerMessage =
    error instanceof CrmError
      ? error.code === "RD_FIELD_SETUP_FAILED"
        ? error.message
        : safeProviderMessages[error.code] ||
          (/^RD_HTTP_5\d\d$/.test(error.code)
            ? "O RD está indisponível no momento. Aguarde e tente novamente."
            : undefined)
      : undefined;
  return Response.json(
    {
      error:
        status < 500
          ? known.message
          : providerMessage || "Não foi possível processar a integração. Tente novamente.",
      code: known.code || "INTERNAL_ERROR",
    },
    { status },
  );
}
