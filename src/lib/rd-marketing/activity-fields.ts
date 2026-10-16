import { CrmError } from "../crm/crm-service";
import { readRdFields, writeRd } from "./api-service";
import { RD_ACTIVITY_FIELDS } from "./activity-events";

export async function prepareRdActivityFields(
  tenantId: string,
  version: string,
  fetchImpl?: typeof fetch,
) {
  const list = async () => {
    const raw = await readRdFields(tenantId, fetchImpl);
    const rows = Array.isArray(raw) ? raw : (raw as { fields?: unknown })?.fields;
    if (!Array.isArray(rows))
      throw new CrmError("Não foi possível conferir os campos do RD.", "RD_FIELDS_INVALID", 502);
    return rows as { api_identifier: string; data_type: string }[];
  };
  let fields = await list();
  for (const field of RD_ACTIVITY_FIELDS) {
    if (!fields.some((f) => f.api_identifier === field.api_identifier)) {
      try {
        await writeRd(
          tenantId,
          "/platform/contacts/fields",
          {
            api_identifier: field.api_identifier,
            data_type: "STRING",
            presentation_type: field.presentation_type,
            name: { "pt-BR": field.label, default: field.label },
            label: { "pt-BR": field.label, default: field.label },
          },
          version,
          fetchImpl,
        );
      } catch {
        // A concurrent setup or interrupted response may already have created it.
        fields = await list();
        if (!fields.some((f) => f.api_identifier === field.api_identifier))
          throw new CrmError(
            `Não foi possível preparar o campo ${field.label} no RD. Confira as permissões da conexão.`,
            "RD_FIELD_SETUP_FAILED",
            502,
          );
      }
      fields = await list();
    }
    if (fields.find((f) => f.api_identifier === field.api_identifier)?.data_type !== "STRING")
      throw new CrmError(
        `O campo ${field.label} no RD precisa ser do tipo texto.`,
        "RD_FIELD_TYPE_MISMATCH",
        409,
      );
  }
}
