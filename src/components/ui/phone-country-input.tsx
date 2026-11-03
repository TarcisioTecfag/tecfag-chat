import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, Check, Globe } from "lucide-react";
import {
  cn,
  PHONE_COUNTRIES,
  type PhoneCountryOption,
  detectPhoneCountry,
  formatNationalPhoneByCountry,
  isCorruptedNanpWith55,
  isNanpPhoneNumber,
  maskPhone,
} from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SystemTooltip } from "@/components/ui/tooltip";

export interface PhoneCountryInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  size?: "sm" | "md";
}

export function PhoneCountryInput({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  buttonClassName,
  disabled = false,
  autoFocus = false,
  id,
  onKeyDown,
  size = "md",
}: PhoneCountryInputProps) {
  const [open, setOpen] = useState(false);
  const detectedFromValue = useMemo(() => detectPhoneCountry(value), [value]);
  const [selectedCode, setSelectedCode] = useState<string>(() => detectedFromValue.country.code);

  // Sincroniza o país selecionado quando um valor externo (ex: abrir modal de edição) mudar para outro país
  useEffect(() => {
    const trimmed = (value || "").trim();
    if (!trimmed) return;
    const digits = trimmed.replace(/\D/g, "");
    if (trimmed.startsWith("+") || isNanpPhoneNumber(digits) || isCorruptedNanpWith55(digits) || digits.length > 11) {
      setSelectedCode(detectedFromValue.country.code);
    }
  }, [value, detectedFromValue.country.code]);

  const activeCountry: PhoneCountryOption = useMemo(
    () => PHONE_COUNTRIES.find((c) => c.code === selectedCode) || PHONE_COUNTRIES[0],
    [selectedCode],
  );

  // Extrai apenas o texto visível no campo de número (sem duplicar o +DDI que já aparece no botão da bandeira)
  const displayValue = useMemo(() => {
    const trimmed = (value || "").trim();
    if (!trimmed) return "";
    const digits = trimmed.replace(/\D/g, "");
    if (!digits) return trimmed.startsWith("+") ? "+" : "";

    if (activeCountry.code === "BR") {
      return maskPhone(trimmed);
    }

    if (activeCountry.code === "INTL") {
      return `+${digits.slice(0, 15)}`;
    }

    // Se o valor já começa com +<ddi>, exibe apenas a parte nacional formatada
    if (trimmed.startsWith(`+${activeCountry.ddi}`)) {
      const natDigits = digits.slice(activeCountry.ddi.length);
      return formatNationalPhoneByCountry(natDigits, activeCountry.code);
    }

    if (activeCountry.code === "US") {
      if (isCorruptedNanpWith55(digits)) {
        return formatNationalPhoneByCountry(digits.slice(3), "US");
      }
      if (digits.length === 11 && digits.startsWith("1")) {
        return formatNationalPhoneByCountry(digits.slice(1), "US");
      }
    }

    if (digits.startsWith(activeCountry.ddi) && digits.length > activeCountry.maxNationalDigits) {
      return formatNationalPhoneByCountry(digits.slice(activeCountry.ddi.length), activeCountry.code);
    }

    return formatNationalPhoneByCountry(digits, activeCountry.code);
  }, [value, activeCountry]);

  const buildValueForCountry = (rawInput: string, country: PhoneCountryOption): string => {
    const digits = rawInput.replace(/\D/g, "");
    if (!digits) return "";

    if (country.code === "BR") {
      return maskPhone(digits);
    }

    if (country.code === "INTL") {
      return `+${digits.slice(0, 15)}`;
    }

    const natDigits = digits.slice(0, country.maxNationalDigits);
    const formattedNat = formatNationalPhoneByCountry(natDigits, country.code);
    return `+${country.ddi} ${formattedNat}`.trim();
  };

  const handleSelectCountry = (newCountry: PhoneCountryOption) => {
    const prevCountry = activeCountry;
    setSelectedCode(newCountry.code);
    setOpen(false);

    const trimmed = (value || "").trim();
    if (!trimmed) return;
    let digits = trimmed.replace(/\D/g, "");
    if (!digits) return;

    // Remove prefixo corrompido 551 se estiver trocando para US
    if (isCorruptedNanpWith55(digits)) {
      digits = digits.slice(2);
    } else if (prevCountry.ddi && trimmed.startsWith(`+${prevCountry.ddi}`) && digits.startsWith(prevCountry.ddi)) {
      digits = digits.slice(prevCountry.ddi.length);
    } else if (prevCountry.code === "BR" && digits.startsWith("55") && digits.length >= 12) {
      digits = digits.slice(2);
    }

    // Caso clássico: número americano de 11 dígitos (1 + Area Code + 7 dígitos) que estava interpretado como DDD brasileiro (ex: (13) 05555-1234)
    if (newCountry.code === "US" && digits.length === 11 && digits.startsWith("1")) {
      digits = digits.slice(1);
    } else if (newCountry.ddi && newCountry.code !== "BR" && digits.startsWith(newCountry.ddi) && digits.length > newCountry.maxNationalDigits) {
      digits = digits.slice(newCountry.ddi.length);
    }

    onChange(buildValueForCountry(digits, newCountry));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (!raw.trim()) {
      onChange("");
      return;
    }

    // Se o operador colar um número completo com '+' (ex: +1 305 555 0123 ou +595 981 123 456)
    const rawTrimmed = raw.trim();
    const rawDigits = rawTrimmed.replace(/\D/g, "");
    if (rawTrimmed.startsWith("+") && rawDigits.length >= 8) {
      const autoDetected = detectPhoneCountry(rawTrimmed);
      if (autoDetected.country.code !== activeCountry.code) {
        setSelectedCode(autoDetected.country.code);
        onChange(buildValueForCountry(autoDetected.nationalDigits, autoDetected.country));
        return;
      }
    }

    // Se estava em BR e colou um número NANP de 11 dígitos (ex: 13055551234) ou corrompido (5513055551234)
    if (activeCountry.code === "BR" && (isNanpPhoneNumber(rawDigits) || isCorruptedNanpWith55(rawDigits))) {
      const usCountry = PHONE_COUNTRIES.find((c) => c.code === "US")!;
      const natDigits = isCorruptedNanpWith55(rawDigits) ? rawDigits.slice(3) : rawDigits.slice(1);
      setSelectedCode("US");
      onChange(buildValueForCountry(natDigits, usCountry));
      return;
    }

    onChange(buildValueForCountry(raw, activeCountry));
  };

  const isSmall = size === "sm";

  return (
    <div className={cn(" flex items-stretch w-full", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <SystemTooltip content={`País do telefone: ${activeCountry.name} (${activeCountry.ddi ? `+${activeCountry.ddi}` : "DDI manual"})`}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                "flex items-center gap-1 shrink-0 rounded-l-lg border border-r-0 border-slate-200 dark:border-[#233846] bg-slate-100/90 dark:bg-[#0d1821] text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-[#152532] transition-colors focus:outline-none focus:ring-2 focus:ring-[#00A884]/30 disabled:opacity-50",
                isSmall ? "px-2 py-1 text-[11px]" : "px-2.5 py-2 text-xs",
                buttonClassName,
              )}
            >
              <span className={cn("leading-none select-none", isSmall ? "text-xs" : "text-sm")}>
                {activeCountry.flag}
              </span>
              <span className="font-mono font-semibold tracking-tight">
                {activeCountry.ddi ? `+${activeCountry.ddi}` : "+DDI"}
              </span>
              <ChevronDown className={cn("text-slate-400 transition-transform", isSmall ? "h-3 w-3" : "h-3.5 w-3.5", open && "rotate-180")} />
            </button>
          </PopoverTrigger>
        </SystemTooltip>

        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-64 p-1.5 bg-white dark:bg-[#111b21] border border-slate-200 dark:border-[#233846] rounded-xl shadow-xl z-[200]"
        >
          <div className="px-2 py-1.5 border-b border-slate-100 dark:border-[#1e2c36] mb-1 flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-[#00A884]" />
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Código do País (DDI)
            </span>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-0.5 pr-0.5">
            {PHONE_COUNTRIES.map((country) => {
              const isSelected = country.code === activeCountry.code;
              return (
                <button
                  key={country.code}
                  type="button"
                  onClick={() => handleSelectCountry(country)}
                  className={cn(
                    "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors",
                    isSelected
                      ? "bg-[#00A884]/10 text-[#00A884] font-semibold"
                      : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1a2934]",
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm leading-none shrink-0">{country.flag}</span>
                    <span className="truncate">{country.name}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0 ml-2">
                    {country.ddi && (
                      <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
                        +{country.ddi}
                      </span>
                    )}
                    {isSelected && <Check className="h-3.5 w-3.5 text-[#00A884]" />}
                  </span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <input
        id={id}
        type="tel"
        disabled={disabled}
        autoFocus={autoFocus}
        value={displayValue}
        onChange={handleInputChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder || activeCountry.placeholder}
        className={cn(
          "w-full min-w-0 rounded-r-lg rounded-l-none border border-slate-200 dark:border-[#233846] bg-slate-50 dark:bg-[#111b21] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#00A884]/30 focus:border-[#00A884]",
          isSmall ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm",
          inputClassName,
        )}
      />
    </div>
  );
}
