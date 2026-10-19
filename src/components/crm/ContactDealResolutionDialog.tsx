import { useEffect, useState } from "react";
import { ContactDealModal, type ContactDealContext } from "./ContactDealPicker";
import type { ContactDealInput } from "@/lib/crm/contact-deal-input";
import { toast } from "sonner";

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
  const [saving, setSaving] = useState(false);
  const [contactContext, setContactContext] = useState<ContactDealContext>({
    id: contactId,
    isExisting: true,
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/contacts/${encodeURIComponent(contactId)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!controller.signal.aborted && data) {
          setContactContext({
            id: contactId,
            name: data.name || "",
            phone: data.phone || null,
            email: data.email || null,
            accountId: data.accountId || null,
            accountName: data.accountName || null,
            isExisting: true,
          });
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [contactId]);

  const handleConfirm = async (confirmedValue: ContactDealInput) => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/contacts/${encodeURIComponent(contactId)}/conversations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(confirmedValue),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Não foi possível vincular a negociação.");
      }
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao vincular negociação.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ContactDealModal
      isOpen={true}
      onClose={onClose}
      value={value}
      onChange={(nextVal) => setValue(nextVal)}
      onConfirm={handleConfirm}
      confirmLabel="Vincular e Iniciar Atendimento"
      saving={saving}
      contactContext={contactContext}
    />
  );
}
