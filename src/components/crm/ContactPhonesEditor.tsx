import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Building2,
  User,
  Phone,
  PhoneCall,
  MessageCircle,
  Landmark,
  Tag,
  Star,
  Plus,
  Trash2,
  ChevronDown,
  ExternalLink,
  Check,
} from "lucide-react";
import { cn, formatPhoneNumber } from "@/lib/utils";
import { PhoneCountryInput } from "@/components/ui/phone-country-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  CONTACT_PHONE_TYPES,
  type ContactPhoneInput,
  type ContactPhoneItem,
  type ContactPhoneType,
  getContactPhoneTypeLabel,
  inferContactPhoneType,
} from "@/lib/contact-phone-types";

export function getPhoneTypeIcon(type?: ContactPhoneType | string | null, className = "h-3.5 w-3.5") {
  switch (type) {
    case "commercial":
      return <Building2 className={className} />;
    case "personal":
      return <User className={className} />;
    case "landline":
      return <PhoneCall className={className} />;
    case "whatsapp":
      return <MessageCircle className={className} />;
    case "financial":
      return <Landmark className={className} />;
    case "other":
      return <Tag className={className} />;
    default:
      return <Phone className={className} />;
  }
}

export function ContactPhoneTypeBadge({
  type,
  label,
  isPrimary,
  size = "sm",
  className,
}: {
  type?: ContactPhoneType | string | null;
  label?: string | null;
  isPrimary?: boolean;
  size?: "xs" | "sm";
  className?: string;
}) {
  const displayLabel = getContactPhoneTypeLabel(type, label);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-semibold tracking-tight transition-colors shrink-0",
        size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        isPrimary
          ? "bg-primary/10 text-primary border-primary/25"
          : "bg-muted/70 text-muted-foreground border-border/80",
        className,
      )}
    >
      {getPhoneTypeIcon(type, size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3")}
      <span className="truncate max-w-[110px]">{displayLabel}</span>
    </span>
  );
}

interface ContactPhonesEditorProps {
  phones: ContactPhoneInput[];
  onChange: (phones: ContactPhoneInput[]) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}

export function createEmptyContactPhoneInput(
  type: ContactPhoneType = "commercial",
  isPrimary = false,
): ContactPhoneInput {
  return {
    phone: "",
    type,
    label: null,
    isPrimary,
    hasWhatsapp: type !== "landline",
  };
}

export function ensureEditablePhonesList(
  phones?: ContactPhoneInput[] | ContactPhoneItem[] | null,
  fallbackSinglePhone?: string | null,
): ContactPhoneInput[] {
  if (Array.isArray(phones) && phones.length > 0) {
    const hasPrimary = phones.some((p) => p.isPrimary);
    return phones.map((p, idx) => ({
      id: p.id,
      phone: p.phone || "",
      type: (p.type as ContactPhoneType) || inferContactPhoneType(p.phone || ""),
      label: p.label ?? null,
      isPrimary: hasPrimary ? Boolean(p.isPrimary) : idx === 0,
      hasWhatsapp: p.hasWhatsapp ?? p.type !== "landline",
    }));
  }
  if (fallbackSinglePhone && fallbackSinglePhone.trim()) {
    const inferred = inferContactPhoneType(fallbackSinglePhone);
    return [
      {
        phone: fallbackSinglePhone,
        type: inferred,
        label: null,
        isPrimary: true,
        hasWhatsapp: inferred !== "landline",
      },
    ];
  }
  return [createEmptyContactPhoneInput("commercial", true)];
}

export function ContactPhonesEditor({
  phones,
  onChange,
  disabled = false,
  compact = false,
  className,
}: ContactPhonesEditorProps) {
  const safePhones =
    phones.length > 0 ? phones : [createEmptyContactPhoneInput("commercial", true)];

  const handleUpdateRow = (index: number, patch: Partial<ContactPhoneInput>) => {
    const next = safePhones.map((item, idx) => {
      if (idx !== index) return item;
      const updated = { ...item, ...patch };
      if (patch.type && patch.hasWhatsapp === undefined) {
        updated.hasWhatsapp = patch.type !== "landline";
      }
      return updated;
    });
    onChange(next);
  };

  const handleSetPrimary = (index: number) => {
    if (disabled) return;
    const next = safePhones.map((item, idx) => ({
      ...item,
      isPrimary: idx === index,
    }));
    onChange(next);
  };

  const handleAddPhone = () => {
    if (disabled) return;
    const existingTypes = new Set(safePhones.map((p) => p.type));
    const suggestedType: ContactPhoneType = !existingTypes.has("commercial")
      ? "commercial"
      : !existingTypes.has("personal")
        ? "personal"
        : !existingTypes.has("landline")
          ? "landline"
          : "other";
    onChange([...safePhones, createEmptyContactPhoneInput(suggestedType, false)]);
  };

  const handleRemovePhone = (index: number) => {
    if (disabled || safePhones.length <= 1) return;
    const removedWasPrimary = safePhones[index]?.isPrimary;
    const filtered = safePhones.filter((_, idx) => idx !== index);
    if (removedWasPrimary && filtered.length > 0 && !filtered.some((p) => p.isPrimary)) {
      filtered[0] = { ...filtered[0], isPrimary: true };
    }
    onChange(filtered);
  };

  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">
            Telefones do Contato
          </span>
          <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground border border-border/70">
            {safePhones.length} {safePhones.length === 1 ? "número" : "números"}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Cada número possui chat independente
        </span>
      </div>

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {safePhones.map((item, index) => {
            const isPrimary = Boolean(item.isPrimary);
            const currentType = (item.type as ContactPhoneType) || "commercial";
            return (
              <motion.div
                key={item.id || `phone-slot-${index}`}
                initial={{ opacity: 0, y: -6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className={cn(
                  "rounded-xl border p-2.5 transition-all",
                  isPrimary
                    ? "bg-primary/[0.04] border-primary/30 shadow-2xs"
                    : "bg-muted/25 border-border/80 hover:border-border",
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <SystemTooltip
                      content={
                        isPrimary
                          ? "Número principal deste contato"
                          : "Definir como número principal do contato"
                      }
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleSetPrimary(index)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold border transition-all cursor-pointer shrink-0",
                          isPrimary
                            ? "bg-primary/15 text-primary border-primary/30 shadow-2xs"
                            : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/40",
                        )}
                      >
                        <Star
                          className={cn(
                            "h-3 w-3 transition-transform",
                            isPrimary ? "fill-primary text-primary scale-105" : "text-muted-foreground",
                          )}
                        />
                        <span>{isPrimary ? "Principal" : "Tornar principal"}</span>
                      </button>
                    </SystemTooltip>

                    <div className="w-[165px] shrink-0">
                      <Select
                        disabled={disabled}
                        value={currentType}
                        onValueChange={(val) =>
                          handleUpdateRow(index, { type: val as ContactPhoneType })
                        }
                      >
                        <SelectTrigger className="h-7 rounded-lg px-2.5 py-1 text-[11px] font-semibold bg-card border-border">
                          <SelectValue placeholder="Tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          {CONTACT_PHONE_TYPES.map((opt) => (
                            <SelectItem
                              key={opt.value}
                              value={opt.value}
                              className="text-xs font-medium"
                            >
                              <span className="inline-flex items-center gap-2">
                                {getPhoneTypeIcon(opt.value, "h-3.5 w-3.5 text-primary")}
                                <span>{opt.label}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {!compact && (
                      <input
                        type="text"
                        disabled={disabled}
                        value={item.label || ""}
                        onChange={(e) => handleUpdateRow(index, { label: e.target.value })}
                        placeholder="Identificação (ex: Ramal, Direto)..."
                        className="flex-1 min-w-[90px] h-7 rounded-lg border border-border bg-card px-2.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    )}
                  </div>

                  {safePhones.length > 1 && (
                    <SystemTooltip content="Remover este número do contato">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleRemovePhone(index)}
                        className="h-7 w-7 inline-flex items-center justify-center rounded-lg border border-transparent text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/20 transition-colors cursor-pointer shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </SystemTooltip>
                  )}
                </div>

                <div className="space-y-1.5">
                  <PhoneCountryInput
                    disabled={disabled}
                    size={compact ? "sm" : "md"}
                    value={item.phone || ""}
                    onChange={(val) => handleUpdateRow(index, { phone: val })}
                    buttonClassName="bg-card"
                    inputClassName="bg-card font-mono"
                  />

                  {compact && (
                    <input
                      type="text"
                      disabled={disabled}
                      value={item.label || ""}
                      onChange={(e) => handleUpdateRow(index, { label: e.target.value })}
                      placeholder="Identificação opcional (ex: Comercial 2, Ramal 204)..."
                      className="w-full h-7 rounded-lg border border-border bg-card px-2.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={handleAddPhone}
        className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/40 bg-primary/[0.04] hover:bg-primary/10 hover:border-primary/60 px-3 py-2 text-xs font-semibold text-primary transition-all cursor-pointer disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        <span>Adicionar outro número</span>
      </button>
    </div>
  );
}

/**
 * Menu / Botão inteligente para abrir ou iniciar conversa com qualquer número de um contato.
 * Se o contato tiver apenas 1 número, executa a ação diretamente.
 * Se tiver 2 ou mais números, abre um Popover do Design System permitindo escolher qual
 * número/atendimento separado abrir.
 */
export function ContactPhoneChatLauncher({
  phones,
  fallbackPhone,
  activePhoneId,
  activePhone,
  onSelectPhone,
  triggerLabel = "Conversar",
  compact = false,
  className,
}: {
  phones?: ContactPhoneItem[] | null;
  fallbackPhone?: string | null;
  activePhoneId?: string | null;
  activePhone?: string | null;
  onSelectPhone: (target: { contactPhoneId?: string | null; phone: string }) => void;
  triggerLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  const normalizedList: ContactPhoneItem[] = React.useMemo(() => {
    if (Array.isArray(phones) && phones.length > 0) return phones;
    if (fallbackPhone && fallbackPhone.trim()) {
      return [
        {
          id: "",
          contactId: "",
          phone: fallbackPhone,
          type: inferContactPhoneType(fallbackPhone),
          label: null,
          isPrimary: true,
          hasWhatsapp: true,
          position: 0,
        },
      ];
    }
    return [];
  }, [phones, fallbackPhone]);

  if (normalizedList.length === 0) return null;

  if (normalizedList.length === 1) {
    const single = normalizedList[0];
    return (
      <SystemTooltip
        content={`Abrir atendimento de ${formatPhoneNumber(single.phone)} (${getContactPhoneTypeLabel(single.type, single.label)})`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelectPhone({ contactPhoneId: single.id || null, phone: single.phone });
          }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg font-semibold transition-all cursor-pointer",
            compact
              ? "px-2 py-1 text-[11px] bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25"
              : "px-2.5 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs",
            className,
          )}
        >
          <MessageCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{triggerLabel}</span>
        </button>
      </SystemTooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <SystemTooltip content={`Escolher qual dos ${normalizedList.length} números abrir no chat`}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg font-semibold transition-all cursor-pointer",
              compact
                ? "px-2 py-1 text-[11px] bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25"
                : "px-2.5 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs",
              className,
            )}
          >
            <MessageCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{triggerLabel}</span>
            <span className="inline-flex items-center justify-center rounded-full bg-background/20 px-1.5 py-0.2 text-[10px] font-bold">
              {normalizedList.length}
            </span>
            <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
          </button>
        </PopoverTrigger>
      </SystemTooltip>

      <PopoverContent
        align="end"
        sideOffset={6}
        onClick={(e) => e.stopPropagation()}
        className="w-80 p-2 bg-popover text-popover-foreground border border-border rounded-2xl shadow-2xl z-[10100]"
      >
        <div className="px-2.5 py-2 border-b border-border/60 mb-1.5">
          <p className="text-xs font-bold text-foreground">
            Escolher número para atendimento
          </p>
          <p className="text-[11px] text-muted-foreground">
            Cada número abre um chat separado vinculado a este contato
          </p>
        </div>

        <div className="space-y-1 max-h-64 overflow-y-auto pr-0.5">
          {normalizedList.map((p) => {
            const isCurrent =
              (activePhoneId && p.id === activePhoneId) ||
              (activePhone &&
                p.phone.replace(/\D/g, "") === activePhone.replace(/\D/g, ""));
            return (
              <button
                key={p.id || p.phone}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSelectPhone({ contactPhoneId: p.id || null, phone: p.phone });
                }}
                className={cn(
                  "w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer border",
                  isCurrent
                    ? "bg-primary/10 border-primary/30 text-foreground"
                    : "bg-card/60 hover:bg-muted border-transparent hover:border-border text-foreground",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-xs font-bold text-foreground">
                      {formatPhoneNumber(p.phone)}
                    </span>
                    {p.isPrimary && (
                      <SystemTooltip content="Número principal">
                        <span className="inline-flex items-center text-primary">
                          <Star className="h-3 w-3 fill-primary" />
                        </span>
                      </SystemTooltip>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <ContactPhoneTypeBadge
                      type={p.type}
                      label={p.label}
                      isPrimary={p.isPrimary}
                      size="xs"
                    />
                    {isCurrent && (
                      <span className="text-[10px] font-semibold text-primary">
                        Chat atual
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-1 text-primary text-[11px] font-semibold">
                  {isCurrent ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <>
                      <span>Abrir chat</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
