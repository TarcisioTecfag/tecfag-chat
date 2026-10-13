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
  return Response.json(
    {
      error:
        status < 500 ? known.message : "Não foi possível processar a integração. Tente novamente.",
      code: known.code || "INTERNAL_ERROR",
    },
    { status },
  );
}
