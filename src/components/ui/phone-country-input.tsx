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

function CountryFlagSvg({ code, className }: { code: string; className?: string }) {
  if (code === "INTL") {
    return <Globe className={cn("h-3.5 w-3.5 text-primary shrink-0", className)} />;
  }

  return (
    <svg
      viewBox="0 0 24 16"
      aria-hidden="true"
      className={cn(
        "w-[18px] h-[12px] rounded-[2px] shrink-0 shadow-2xs ring-1 ring-black/15 dark:ring-white/15 overflow-hidden",
        className,
      )}
    >
      {code === "BR" && (
        <>
          <rect width="24" height="16" fill="#009B3A" />
          <polygon points="12,1.8 21.8,8 12,14.2 2.2,8" fill="#FEDF00" />
          <circle cx="12" cy="8" r="3.6" fill="#002776" />
          <path d="M8.6,7.2 Q12,5.8 15.4,8.2" stroke="#FFFFFF" strokeWidth="0.9" fill="none" />
        </>
      )}

      {code === "US" && (
        <>
          <rect width="24" height="16" fill="#FFFFFF" />
          <rect width="24" height="1.23" y="0" fill="#B22234" />
          <rect width="24" height="1.23" y="2.46" fill="#B22234" />
          <rect width="24" height="1.23" y="4.92" fill="#B22234" />
          <rect width="24" height="1.23" y="7.38" fill="#B22234" />
          <rect width="24" height="1.23" y="9.84" fill="#B22234" />
          <rect width="24" height="1.23" y="12.3" fill="#B22234" />
          <rect width="24" height="1.23" y="14.77" fill="#B22234" />
          <rect width="10.5" height="8.6" fill="#3C3B6E" />
          <circle cx="2.2" cy="2" r="0.55" fill="#FFFFFF" />
          <circle cx="5.2" cy="2" r="0.55" fill="#FFFFFF" />
          <circle cx="8.2" cy="2" r="0.55" fill="#FFFFFF" />
          <circle cx="3.7" cy="4.3" r="0.55" fill="#FFFFFF" />
          <circle cx="6.7" cy="4.3" r="0.55" fill="#FFFFFF" />
          <circle cx="2.2" cy="6.6" r="0.55" fill="#FFFFFF" />
          <circle cx="5.2" cy="6.6" r="0.55" fill="#FFFFFF" />
          <circle cx="8.2" cy="6.6" r="0.55" fill="#FFFFFF" />
        </>
      )}

      {code === "PY" && (
        <>
          <rect width="24" height="5.33" y="0" fill="#D52B1E" />
          <rect width="24" height="5.34" y="5.33" fill="#FFFFFF" />
          <rect width="24" height="5.33" y="10.67" fill="#0038A8" />
          <circle cx="12" cy="8" r="1.6" fill="none" stroke="#009B3A" strokeWidth="0.6" />
          <circle cx="12" cy="8" r="0.65" fill="#FEDF00" />
        </>
      )}

      {code === "AR" && (
        <>
          <rect width="24" height="5.33" y="0" fill="#74ACDF" />
          <rect width="24" height="5.34" y="5.33" fill="#FFFFFF" />
          <rect width="24" height="5.33" y="10.67" fill="#74ACDF" />
          <circle cx="12" cy="8" r="1.6" fill="#F6B40E" />
        </>
      )}

      {code === "UY" && (
        <>
          <rect width="24" height="16" fill="#FFFFFF" />
          <rect width="24" height="1.78" y="1.78" fill="#0038A8" />
          <rect width="24" height="1.78" y="5.33" fill="#0038A8" />
          <rect width="24" height="1.78" y="8.89" fill="#0038A8" />
          <rect width="24" height="1.78" y="12.44" fill="#0038A8" />
          <rect width="9" height="8.89" fill="#FFFFFF" />
          <circle cx="4.5" cy="4.4" r="2" fill="#FCD116" />
        </>
      )}

      {code === "CL" && (
        <>
          <rect width="24" height="8" y="0" fill="#FFFFFF" />
          <rect width="24" height="8" y="8" fill="#D52B1E" />
          <rect width="8" height="8" y="0" fill="#0039A6" />
          <polygon points="4,1.8 4.6,3.5 6.4,3.5 4.9,4.6 5.5,6.3 4,5.2 2.5,6.3 3.1,4.6 1.6,3.5 3.4,3.5" fill="#FFFFFF" />
        </>
      )}

      {code === "CO" && (
        <>
          <rect width="24" height="8" y="0" fill="#FCD116" />
          <rect width="24" height="4" y="8" fill="#003893" />
          <rect width="24" height="4" y="12" fill="#CE1126" />
        </>
      )}

      {code === "PE" && (
        <>
          <rect width="8" height="16" x="0" fill="#D91023" />
          <rect width="8" height="16" x="8" fill="#FFFFFF" />
          <rect width="8" height="16" x="16" fill="#D91023" />
        </>
      )}

      {code === "BO" && (
        <>
          <rect width="24" height="5.33" y="0" fill="#D52B1E" />
          <rect width="24" height="5.34" y="5.33" fill="#F9E300" />
          <rect width="24" height="5.33" y="10.67" fill="#007934" />
        </>
      )}

      {code === "MX" && (
        <>
          <rect width="8" height="16" x="0" fill="#006847" />
          <rect width="8" height="16" x="8" fill="#FFFFFF" />
          <rect width="8" height="16" x="16" fill="#CE1126" />
          <circle cx="12" cy="8" r="1.4" fill="#8C5A2B" />
        </>
      )}

      {code === "PT" && (
        <>
          <rect width="9.6" height="16" x="0" fill="#006600" />
          <rect width="14.4" height="16" x="9.6" fill="#FF0000" />
          <circle cx="9.6" cy="8" r="2.6" fill="#FFCC00" />
          <rect width="2.2" height="2.6" x="8.5" y="6.7" rx="0.5" fill="#FFFFFF" stroke="#FF0000" strokeWidth="0.5" />
        </>
      )}

      {code === "ES" && (
        <>
          <rect width="24" height="4" y="0" fill="#AA151B" />
          <rect width="24" height="8" y="4" fill="#F1BF00" />
          <rect width="24" height="4" y="12" fill="#AA151B" />
          <rect width="2" height="3" x="6" y="6.5" rx="0.4" fill="#AA151B" />
        </>
      )}

      {code === "CN" && (
        <>
          <rect width="24" height="16" fill="#DE2910" />
          <polygon points="4.5,2.2 5.2,4.3 7.4,4.3 5.6,5.6 6.3,7.7 4.5,6.4 2.7,7.7 3.4,5.6 1.6,4.3 3.8,4.3" fill="#FFDE00" />
          <circle cx="9" cy="2.2" r="0.6" fill="#FFDE00" />
          <circle cx="10.3" cy="3.8" r="0.6" fill="#FFDE00" />
          <circle cx="10.3" cy="6" r="0.6" fill="#FFDE00" />
          <circle cx="9" cy="7.6" r="0.6" fill="#FFDE00" />
        </>
      )}
    </svg>
  );
}

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
    <div className={cn("flex items-stretch w-full", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <SystemTooltip content={`País do telefone: ${activeCountry.name} (${activeCountry.ddi ? `+${activeCountry.ddi}` : "DDI manual"})`}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                "flex items-center gap-1.5 shrink-0 rounded-l-lg border border-r-0 border-border bg-muted text-foreground hover:bg-muted/80 transition-colors focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 cursor-pointer",
                isSmall ? "px-2 py-1 text-[11px]" : "px-2.5 py-2 text-xs",
                buttonClassName,
              )}
            >
              <CountryFlagSvg code={activeCountry.code} />
              <span className="font-mono font-semibold tracking-tight text-foreground">
                {activeCountry.ddi ? `+${activeCountry.ddi}` : "+DDI"}
              </span>
              <ChevronDown
                className={cn(
                  "text-muted-foreground transition-transform",
                  isSmall ? "h-3 w-3" : "h-3.5 w-3.5",
                  open && "rotate-180",
                )}
              />
            </button>
          </PopoverTrigger>
        </SystemTooltip>

        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-64 p-1.5 bg-popover text-popover-foreground border border-border rounded-xl shadow-2xl z-[200]"
        >
          <div className="px-2 py-1.5 border-b border-border/60 mb-1 flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-semibold text-muted-foreground">
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
                    "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer",
                    isSelected
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <CountryFlagSvg code={country.code} />
                    <span className="truncate">{country.name}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0 ml-2">
                    {country.ddi && (
                      <span
                        className={cn(
                          "font-mono text-[11px]",
                          isSelected ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        +{country.ddi}
                      </span>
                    )}
                    {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
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
          "w-full min-w-0 rounded-r-lg rounded-l-none border border-border bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary",
          isSmall ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm",
          inputClassName,
        )}
      />
    </div>
  );
}
