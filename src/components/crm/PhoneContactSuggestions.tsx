import { useEffect, useState } from "react";
import { phoneRegistrationError, formatPhoneNumber } from "@/lib/utils";

export interface ExistingPhoneContact {
  id: string;
  name: string;
  phone: string | null;
  email?: string | null;
}

export function PhoneContactSuggestions({
  phone,
  endpoint = "/api/contacts",
  onSelect,
}: {
  phone: string;
  endpoint?: string;
  onSelect: (contact: ExistingPhoneContact) => void;
}) {
  const [contacts, setContacts] = useState<ExistingPhoneContact[]>([]);
  useEffect(() => {
    setContacts([]);
    if (phone.replace(/\D/g, "").length < 8) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`${endpoint}?identityPhone=${encodeURIComponent(phone)}&limit=10`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!controller.signal.aborted) setContacts(data.contacts || []);
      } catch {
        /* O cadastro ainda verifica duplicidade no servidor. */
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [phone, endpoint]);
  if (!contacts.length) return null;
  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3" role="status">
      <p className="text-xs font-semibold">
        {phoneRegistrationError(phone)
          ? "Possíveis contatos existentes. Confira o DDD antes de escolher."
          : "Encontramos contatos com este número. Confira o DDD e selecione o cadastro existente para continuar."}
      </p>
      {contacts.map((contact) => (
        <button
          key={contact.id}
          type="button"
          onClick={() => onSelect(contact)}
          className="block w-full rounded border border-border bg-card p-2 text-left text-xs hover:border-primary"
        >
          <span className="font-semibold">{contact.name}</span> — {formatPhoneNumber(contact.phone)}
        </button>
      ))}
    </div>
  );
}
