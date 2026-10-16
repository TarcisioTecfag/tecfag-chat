import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ContactDealPicker } from "./ContactDealPicker";
import type { ContactDealInput } from "@/lib/crm/contact-deal-input";

export function ContactDealResolutionDialog({
  contactId,
  onClose,
  onSuccess,
}: {
  contactId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [value, setValue] = useState<ContactDealInput>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Vincular negociação ao atendimento</SheetTitle>
        </SheetHeader>
        <form
          className="space-y-4 py-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError("");
            try {
              const res = await fetch(
                `/api/contacts/${encodeURIComponent(contactId)}/conversations`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(value),
                },
              );
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Não foi possível vincular a negociação.");
              onSuccess();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Falha ao vincular negociação.");
            } finally {
              setSaving(false);
            }
          }}
        >
          <ContactDealPicker value={value} onChange={setValue} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Vincular e continuar"}
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
