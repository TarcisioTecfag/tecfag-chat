import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CustomFieldsEditor, changedCustomFieldValues } from "./CustomFieldsEditor";

export function ContactCustomFieldsCard({ contactId }: { contactId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    fetch(`/api/contacts/${encodeURIComponent(contactId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar o contato.");
        return response.json();
      })
      .then((data) => {
        if (active) {
          setValues(data.customFields || {});
          setSaved(data.customFields || {});
        }
      })
      .catch((error) => {
        if (active) toast.error(error.message);
      });
    return () => {
      active = false;
    };
  }, [expanded, contactId]);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customFields: changedCustomFieldValues(saved, values) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      setSaved(data.contact?.customFields || values);
      toast.success("Campos do contato atualizados.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-border/60 pt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-[10px] font-semibold text-primary hover:underline"
      >
        {expanded ? "Ocultar campos personalizados" : "Ver campos personalizados"}
      </button>
      {expanded && (
        <>
          <CustomFieldsEditor entity="contact" values={values} onChange={setValues} />
          {JSON.stringify(values) !== JSON.stringify(saved) && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="mt-2 rounded-lg bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground disabled:opacity-50"
            >
              Salvar campos
            </button>
          )}
        </>
      )}
    </div>
  );
}
