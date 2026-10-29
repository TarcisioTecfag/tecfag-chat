import { useState, useEffect, useCallback } from "react";

export interface DuplicateAccountMatch {
  id: string;
  name: string;
  tradeName?: string | null;
  document?: string | null;
  type?: "company" | "person";
  phone?: string | null;
  email?: string | null;
  segment?: string | null;
  city?: string | null;
  state?: string | null;
}

export async function findDuplicateAccountByDocument(
  rawDocument: string,
  excludeAccountId?: string | null,
): Promise<DuplicateAccountMatch | null> {
  const digits = String(rawDocument || "").replace(/\D/g, "");
  if (digits.length !== 11 && digits.length !== 14) {
    return null;
  }

  try {
    const res = await fetch(`/api/crm/accounts?document=${encodeURIComponent(digits)}&limit=5`);
    if (!res.ok) return null;
    const data = await res.json();
    const list: DuplicateAccountMatch[] = Array.isArray(data?.accounts) ? data.accounts : [];
    const match = list.find((acc) => {
      if (excludeAccountId && acc.id === excludeAccountId) return false;
      const accDigits = String(acc.document || "").replace(/\D/g, "");
      return accDigits === digits;
    });
    return match || null;
  } catch {
    return null;
  }
}

export function useCheckDuplicateDocument(
  rawDocument: string,
  enabled: boolean = true,
  excludeAccountId?: string | null,
) {
  const [duplicateAccount, setDuplicateAccount] = useState<DuplicateAccountMatch | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);

  const digits = String(rawDocument || "").replace(/\D/g, "");

  useEffect(() => {
    if (!enabled || (digits.length !== 11 && digits.length !== 14)) {
      setDuplicateAccount(null);
      setCheckingDuplicate(false);
      return;
    }

    let cancelled = false;
    setCheckingDuplicate(true);

    findDuplicateAccountByDocument(digits, excludeAccountId).then((match) => {
      if (cancelled) return;
      setDuplicateAccount(match);
      setCheckingDuplicate(false);
    });

    return () => {
      cancelled = true;
    };
  }, [digits, enabled, excludeAccountId]);

  const clearDuplicate = useCallback(() => {
    setDuplicateAccount(null);
  }, []);

  return {
    duplicateAccount,
    checkingDuplicate,
    clearDuplicate,
  };
}
