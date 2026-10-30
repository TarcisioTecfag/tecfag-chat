import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SystemTooltip } from "@/components/ui/tooltip";
import { CustomFieldsEditor, changedCustomFieldValues } from "./CustomFieldsEditor";

export function ContactCustomFieldsCard({
  contactId,
  dealId,
  onSaved,
}: {
  contactId: string;
  dealId?: string;
  onSaved?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loadingContact, setLoadingContact] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedRef = useRef<Record<string, unknown>>({});
  const latestValuesRef = useRef<Record<string, unknown>>({});
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setLoadingContact(true);
    fetch(`/api/contacts/${encodeURIComponent(contactId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar o contato.");
        return response.json();
      })
      .then((data) => {
        if (active) {
          const initial = data.customFields || data.contact?.customFields || {};
          setValues(initial);
          setSaved(initial);
          savedRef.current = initial;
          latestValuesRef.current = initial;
        }
      })
      .catch((error) => {
        if (active) toast.error(error.message);
      })
      .finally(() => {
        if (active) setLoadingContact(false);
      });
    return () => {
      active = false;
    };
  }, [expanded, contactId]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const persistChanges = async (nextValues: Record<string, unknown>) => {
    const diff = changedCustomFieldValues(savedRef.current, nextValues);
    if (Object.keys(diff).length === 0) return;

    setSaving(true);
    setJustSaved(false);
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customFields: diff, ...(dealId ? { dealId } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      const updatedFields = data.contact?.customFields || { ...savedRef.current, ...diff };
      setSaved(updatedFields);
      savedRef.current = updatedFields;
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const handleValuesChange = (nextValues: Record<string, unknown>) => {
    setValues(nextValues);
    latestValuesRef.current = nextValues;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      void persistChanges(latestValuesRef.current);
    }, 500);
  };

  return (
    <div className="border-t border-border/60 pt-2">
      <div className="flex items-center justify-between gap-2">
        <SystemTooltip
          content={
            expanded
              ? "Recolher campos personalizados deste contato"
              : "Expandir e editar campos personalizados deste contato"
          }
        >
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline cursor-pointer"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" />
                Ocultar campos personalizados
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                Ver campos personalizados
              </>
            )}
          </button>
        </SystemTooltip>

        {expanded && (saving || justSaved) && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
            {saving ? (
              <>
                <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
                Salvando...
              </>
            ) : (
              <>
                <Check className="h-2.5 w-2.5 text-primary" />
                Salvo
              </>
            )}
          </span>
        )}
      </div>

      {expanded && (
        <div className="mt-2 rounded-lg border border-border/70 bg-background/60 p-2.5 space-y-2 animate-in fade-in duration-150">
          {loadingContact ? (
            <div className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              Carregando campos do contato...
            </div>
          ) : (
            <CustomFieldsEditor
              entity="contact"
              values={values}
              onChange={handleValuesChange}
              hideTitle
              showEmptyState
            />
          )}
        </div>
      )}
    </div>
  );
}
