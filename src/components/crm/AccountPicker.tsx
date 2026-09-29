import React, { useState, useEffect, useRef } from "react";
import { Search, Building2, User, Check, X, Plus, AlertCircle, Loader2 } from "lucide-react";
import type { CrmAccountDTO } from "../../lib/crm/crm-types";

interface AccountPickerProps {
  value?: string | null;
  selectedAccount?: CrmAccountDTO | null;
  onSelectAccount: (account: CrmAccountDTO | null) => void;
  onAddNew?: () => void;
  disabled?: boolean;
  placeholder?: string;
  divergentWarning?: string | null;
}

function formatDoc(doc?: string | null, type?: string): string {
  if (!doc) return "";
  const digits = doc.replace(/\D/g, "");
  if (type === "company" || digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  if (type === "person" || digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return doc;
}

export function AccountPicker({
  value,
  selectedAccount,
  onSelectAccount,
  onAddNew,
  disabled = false,
  placeholder = "Buscar cliente existente por nome, razão social ou CPF/CNPJ...",
  divergentWarning,
}: AccountPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CrmAccountDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeAccount, setActiveAccount] = useState<CrmAccountDTO | null>(selectedAccount || null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sincroniza se selectedAccount mudar externamente
  useEffect(() => {
    if (selectedAccount !== undefined) {
      setActiveAccount(selectedAccount);
    }
  }, [selectedAccount]);

  // Se tem value mas não tem activeAccount, busca dados da conta
  useEffect(() => {
    if (value && (!activeAccount || activeAccount.id !== value)) {
      fetch(`/api/crm/accounts/${value}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.account) {
            setActiveAccount(data.account);
          }
        })
        .catch((err) => console.error("Erro ao buscar conta:", err));
    } else if (!value && activeAccount) {
      setActiveAccount(null);
    }
  }, [value]);

  // Debounce search
  useEffect(() => {
    if (!query.trim() || activeAccount) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/crm/accounts?search=${encodeURIComponent(query.trim())}&limit=8`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.accounts || []);
        }
      } catch (err) {
        console.error("Erro ao pesquisar contas:", err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, activeAccount]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (acc: CrmAccountDTO) => {
    setActiveAccount(acc);
    onSelectAccount(acc);
    setQuery("");
    setIsOpen(false);
  };

  const handleClear = () => {
    setActiveAccount(null);
    onSelectAccount(null);
    setQuery("");
  };

  return (
    <div className="relative w-full space-y-1.5" ref={dropdownRef}>
      {activeAccount ? (
        // Conta selecionada
        <div className="flex items-center justify-between p-2.5 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 rounded-lg text-sm">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="p-1.5 rounded-md bg-sky-100 dark:bg-sky-900/60 text-sky-600 dark:text-sky-300">
              {activeAccount.type === "company" ? (
                <Building2 className="w-4 h-4" />
              ) : (
                <User className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="font-medium text-slate-800 dark:text-slate-100 truncate">
                {activeAccount.name}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center space-x-2">
                <span>{activeAccount.type === "company" ? "Pessoa Jurídica" : "Pessoa Física"}</span>
                {activeAccount.document && (
                  <>
                    <span>•</span>
                    <span className="font-mono">{formatDoc(activeAccount.document, activeAccount.type)}</span>
                  </>
                )}
                {activeAccount.phone && (
                  <>
                    <span>•</span>
                    <span>{activeAccount.phone}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="text-slate-400 hover:text-rose-500 p-1 rounded-md transition-colors"
              title="Trocar cliente"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : (
        // Input de busca
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            {loading ? <Loader2 className="w-4 h-4 animate-spin text-sky-500" /> : <Search className="w-4 h-4" />}
          </div>
          <input
            type="text"
            disabled={disabled}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            className="w-full pl-9 pr-20 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 dark:text-slate-100 placeholder:text-slate-400"
          />
          {onAddNew && (
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onAddNew();
              }}
              className="absolute inset-y-1 right-1 px-2.5 flex items-center space-x-1 text-xs font-medium text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/50 rounded-md transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo</span>
            </button>
          )}

          {/* Dropdown de Resultados */}
          {isOpen && query.trim().length > 0 && (
            <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg">
              {results.length > 0 ? (
                <div className="p-1 space-y-0.5">
                  <div className="px-2 py-1 text-[11px] font-semibold tracking-wider uppercase text-slate-400">
                    Contas encontradas ({results.length})
                  </div>
                  {results.map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => handleSelect(acc)}
                      className="w-full text-left px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 rounded-md flex items-center justify-between text-sm group transition-colors"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className="p-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 group-hover:text-sky-600">
                          {acc.type === "company" ? (
                            <Building2 className="w-3.5 h-3.5" />
                          ) : (
                            <User className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                            {acc.name}
                            {acc.tradeName && (
                              <span className="ml-1.5 text-xs text-slate-400 font-normal">
                                ({acc.tradeName})
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 flex items-center space-x-2">
                            <span>{acc.type === "company" ? "PJ" : "PF"}</span>
                            {acc.document && (
                              <>
                                <span>•</span>
                                <span className="font-mono">{formatDoc(acc.document, acc.type)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <Check className="w-4 h-4 text-transparent group-hover:text-sky-500" />
                    </button>
                  ))}
                </div>
              ) : !loading ? (
                <div className="p-3 text-center text-sm text-slate-500">
                  <p>Nenhuma conta encontrada com "{query}".</p>
                  {onAddNew && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        onAddNew();
                      }}
                      className="mt-2 inline-flex items-center space-x-1.5 text-xs text-sky-600 dark:text-sky-400 font-medium hover:underline"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Cadastrar conta com estes dados</span>
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Alerta de Divergência amigável */}
      {divergentWarning && (
        <div className="flex items-start space-x-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-md border border-amber-200 dark:border-amber-900/50">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{divergentWarning}</span>
        </div>
      )}
    </div>
  );
}
