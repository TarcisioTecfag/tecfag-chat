import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import {
  type CustomFieldEntity,
  type CustomFieldType,
  isCustomFieldInactive,
  normalizePipelineId,
} from "@/lib/crm/custom-field-common";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemTooltip } from "@/components/ui/tooltip";
import { CrmDatePicker } from "./CrmDatePicker";

export interface FieldOption {
  id: string;
  label: string;
}
export interface FieldDefinition {
  id: string;
  entityType: CustomFieldEntity;
  name: string;
  fieldType: CustomFieldType;
  options: FieldOption[];
  required: boolean;
  requiredRule?: "always" | "stage_onwards";
  requiredFromStageId?: string | null;
  isUnique?: boolean;
  visibleOnCreate: boolean;
  allPipelines: boolean;
  pipelineIds: string[];
  sortOrder: number;
  archivedAt?: string | null;
  createdAt: string;
}

export function normalizeFieldOptions(raw: unknown): FieldOption[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizePipelineIds(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      return [raw];
    } catch {
      return [raw];
    }
  }
  return [];
}

export function changedCustomFieldValues(
  original: Record<string, unknown>,
  current: Record<string, unknown>,
) {
  return Object.fromEntries(
    Object.entries(current).filter(
      ([id, value]) => JSON.stringify(value) !== JSON.stringify(original[id]),
    ),
  );
}

function isCustomFieldValueFilled(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    value !== "" &&
    (!Array.isArray(value) || value.length > 0)
  );
}

function resolveFieldDisplayValue(values: Record<string, unknown>, field: FieldDefinition): unknown {
  if (!values) return undefined;
  if (isCustomFieldValueFilled(values[field.id])) return values[field.id];
  if (isCustomFieldValueFilled(values[field.name])) return values[field.name];
  const lowerName = field.name.toLowerCase();
  if (isCustomFieldValueFilled(values[lowerName])) return values[lowerName];
  return undefined;
}

function formatInactiveDisplayValue(field: FieldDefinition, value: unknown): string {
  const options = normalizeFieldOptions(field.options);
  const optionLabel = (id: string) => options.find((opt) => opt.id === id)?.label || id;

  if (Array.isArray(value)) {
    return value.map((item) => optionLabel(String(item))).join(", ");
  }
  if (field.fieldType === "single") {
    return optionLabel(String(value));
  }
  if (field.fieldType === "date" && typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  return String(value);
}

export function useCustomFields(
  entity: CustomFieldEntity,
  enabled = true,
  options?: { includeArchived?: boolean },
) {
  const includeArchived = options?.includeArchived === true;
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(false);

  const loadFields = useCallback(
    (isMounted: () => boolean) => {
      setLoading(true);
      const query = includeArchived
        ? `/api/crm/custom-fields?entity=${entity}&includeArchived=true`
        : `/api/crm/custom-fields?entity=${entity}`;
      fetch(query, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Não foi possível carregar os campos personalizados.");
          return response.json();
        })
        .then((data) => {
          if (isMounted()) {
            const raw: any[] = data.fields || [];
            setFields(
              raw.map((f) => ({
                ...f,
                options: normalizeFieldOptions(f.options),
                pipelineIds: normalizePipelineIds(f.pipelineIds),
              })),
            );
          }
        })
        .catch(() => {
          if (isMounted()) setFields([]);
        })
        .finally(() => {
          if (isMounted()) setLoading(false);
        });
    },
    [entity, includeArchived],
  );

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    loadFields(() => mounted);
    const onChanged = () => loadFields(() => mounted);
    window.addEventListener("crm-custom-fields-changed", onChanged);
    return () => {
      mounted = false;
      window.removeEventListener("crm-custom-fields-changed", onChanged);
    };
  }, [enabled, loadFields]);

  return { fields, loading };
}

export function CustomFieldsEditor({
  entity,
  pipelineId,
  values,
  onChange,
  onFieldCommit,
  create = false,
  definitions,
  requiredIds = [],
  hideTitle = false,
  columns = 1,
  showEmptyState = false,
}: {
  entity: CustomFieldEntity;
  pipelineId?: string | null;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  onFieldCommit?: (fieldId: string, value: unknown, nextValues: Record<string, unknown>) => void;
  create?: boolean;
  definitions?: FieldDefinition[];
  requiredIds?: string[];
  hideTitle?: boolean;
  columns?: 1 | 2;
  showEmptyState?: boolean;
}) {
  const loaded = useCustomFields(entity, !definitions, { includeArchived: !create });
  const { activeFields, inactiveFilledFields } = useMemo(() => {
    const rawList = (definitions ?? loaded.fields).map((f) => ({
      ...f,
      options: normalizeFieldOptions(f.options),
      pipelineIds: normalizePipelineIds(f.pipelineIds),
    }));

    const active = rawList.filter((field) => {
      if (isCustomFieldInactive(field)) return false;

      // Regra de criação: respeita visibleOnCreate a menos que seja obrigatório
      if (create && !field.visibleOnCreate && !requiredIds.includes(field.id)) {
        return false;
      }

      // Para entidades diferentes de deal (empresa, contato, produto), sempre exibe
      if (entity !== "deal") return true;

      // Se a negociação já possui valor preenchido ou rascunhado para este campo, NUNCA oculta
      if (isCustomFieldValueFilled(values?.[field.id])) {
        return true;
      }

      // Se o campo foi marcado para todos os funis, exibe
      if (field.allPipelines) return true;

      const pIds = field.pipelineIds;
      if (!pIds || !pIds.length) return true; // Se lista vazia, exibe por padrão
      if (!pipelineId) return true; // Se deal sem pipelineId, exibe

      const currentNorm = normalizePipelineId(pipelineId);
      return pIds.some((id) => {
        if (!id) return false;
        if (id === pipelineId) return true;
        const targetNorm = normalizePipelineId(id);
        if (targetNorm && currentNorm && targetNorm === currentNorm) return true;
        return (
          typeof id === "string" &&
          typeof pipelineId === "string" &&
          (id.includes(pipelineId) || pipelineId.includes(id))
        );
      });
    });

    const inactiveFilled = create
      ? []
      : rawList.filter((field) => {
          if (!isCustomFieldInactive(field)) return false;
          return isCustomFieldValueFilled(resolveFieldDisplayValue(values, field));
        });

    return { activeFields: active, inactiveFilledFields: inactiveFilled };
  }, [definitions, loaded.fields, entity, create, pipelineId, requiredIds, values]);

  if (!definitions && loaded.loading && showEmptyState) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground">
        Carregando campos personalizados...
      </div>
    );
  }

  if (!activeFields.length && !inactiveFilledFields.length) {
    if (!showEmptyState) return null;
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/15 px-3 py-2.5 text-[11px] text-muted-foreground">
        Nenhum campo personalizado cadastrado para {entity === "contact" ? "contatos" : entity === "company" ? "empresas" : "esta ficha"}.
      </div>
    );
  }
  const update = (id: string, value: unknown, immediateCommit = false) => {
    const nextValues = { ...values, [id]: value };
    onChange(nextValues);
    if (immediateCommit && onFieldCommit) {
      onFieldCommit(id, value, nextValues);
    }
  };
  const common =
    "h-9 w-full rounded-[8px] border border-slate-300/85 dark:border-slate-700/80 bg-muted/35 dark:bg-slate-900/60 px-3 text-xs font-medium text-foreground placeholder:text-muted-foreground/60 outline-none transition-all hover:border-primary/40 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/15";

  return (
    <div className={`space-y-3.5 ${hideTitle ? "" : "border-t border-border pt-4"}`}>
      {!hideTitle && (
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Campos personalizados
        </h4>
      )}
      {activeFields.length > 0 && (
        <div
          className={
            columns === 2
              ? "grid grid-cols-1 md:grid-cols-2 gap-3.5"
              : "space-y-3"
          }
        >
          {activeFields.map((field) => {
          const value = values[field.id];
          const isFullSpan = columns === 2 && field.fieldType === "multiple";
          return (
            <div
              key={field.id}
              className={`space-y-1.5 ${isFullSpan ? "md:col-span-2" : ""}`}
            >
              <label
                className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide"
                htmlFor={`cf-${field.id}`}
              >
                {field.name}
                {create && (field.required || requiredIds.includes(field.id)) && (
                  <span className="ml-1 text-primary">*</span>
                )}
              </label>
              {field.fieldType === "multiple" ? (
                <div className="max-h-36 space-y-2 overflow-y-auto rounded-[8px] border border-slate-300/85 dark:border-slate-700/80 bg-muted/35 dark:bg-slate-900/60 p-2.5">
                  {field.options.map((option) => {
                    const selected = Array.isArray(value) ? (value as string[]) : [];
                    const isChecked = selected.includes(option.id);
                    return (
                      <SystemTooltip
                        key={option.id}
                        content={isChecked ? `Desmarcar "${option.label}"` : `Selecionar "${option.label}"`}
                      >
                        <label
                          className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none"
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(checked) =>
                              update(
                                field.id,
                                checked
                                  ? [...selected, option.id]
                                  : selected.filter((id) => id !== option.id),
                              )
                            }
                          />
                          <span>{option.label}</span>
                        </label>
                      </SystemTooltip>
                    );
                  })}
                </div>
              ) : field.fieldType === "single" ? (
                <Select
                  value={typeof value === "string" && value ? value : "__empty__"}
                  onValueChange={(val) => update(field.id, val === "__empty__" ? null : val)}
                >
                  <SystemTooltip content={`Selecionar opção para ${field.name}`}>
                    <SelectTrigger
                      id={`cf-${field.id}`}
                      className={common}
                    >
                      <SelectValue placeholder="Selecionar..." />
                    </SelectTrigger>
                  </SystemTooltip>
                  <SelectContent>
                    <SelectItem value="__empty__" className="text-xs text-muted-foreground">
                      Selecionar...
                    </SelectItem>
                    {field.options.map((option) => (
                      <SelectItem key={option.id} value={option.id} className="text-xs">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : field.fieldType === "number" ? (
                <div className="relative flex items-center">
                  <input
                    id={`cf-${field.id}`}
                    className={`${common} pr-16`}
                    type="text"
                    inputMode="decimal"
                    value={value === null || value === undefined ? "" : String(value)}
                    onChange={(event) => {
                      const raw = event.target.value;
                      if (raw === "") {
                        update(field.id, null);
                        return;
                      }
                      if (/^-?\d*([.,]\d*)?$/.test(raw)) {
                        update(field.id, raw);
                      }
                    }}
                    required={create && (field.required || requiredIds.includes(field.id))}
                  />
                  <div className="absolute right-1.5 flex items-center gap-1">
                    <SystemTooltip content="Diminuir valor (-1)">
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => {
                          const rawStr = value === null || value === undefined ? "" : String(value).trim();
                          const normalized = rawStr.replace(",", ".");
                          const currentNum =
                            normalized !== "" && Number.isFinite(Number(normalized)) ? Number(normalized) : 0;
                          const nextNum = currentNum - 1;
                          if (/^-?0\d+$/.test(rawStr)) {
                            const digitsLen = rawStr.replace("-", "").length;
                            const absStr = String(Math.abs(Math.trunc(nextNum))).padStart(digitsLen, "0");
                            update(field.id, nextNum < 0 ? `-${absStr}` : absStr);
                          } else {
                            update(field.id, nextNum);
                          }
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-slate-300/80 dark:border-slate-700 bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                        aria-label="Diminuir valor"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </SystemTooltip>
                    <SystemTooltip content="Aumentar valor (+1)">
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => {
                          const rawStr = value === null || value === undefined ? "" : String(value).trim();
                          const normalized = rawStr.replace(",", ".");
                          const currentNum =
                            normalized !== "" && Number.isFinite(Number(normalized)) ? Number(normalized) : 0;
                          const nextNum = currentNum + 1;
                          if (/^-?0\d+$/.test(rawStr)) {
                            const digitsLen = rawStr.replace("-", "").length;
                            const absStr = String(Math.abs(Math.trunc(nextNum))).padStart(digitsLen, "0");
                            update(field.id, nextNum < 0 ? `-${absStr}` : absStr);
                          } else {
                            update(field.id, nextNum);
                          }
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-slate-300/80 dark:border-slate-700 bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                        aria-label="Aumentar valor"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                    </SystemTooltip>
                  </div>
                </div>
              ) : field.fieldType === "date" ? (
                <CrmDatePicker
                  value={value ? String(value) : null}
                  onChange={(val) => update(field.id, val)}
                  placeholder="Selecionar data..."
                  tooltipText="Selecionar data personalizada"
                />
              ) : (
                <input
                  id={`cf-${field.id}`}
                  className={common}
                  type={field.fieldType === "url" ? "url" : "text"}
                  value={value === null || value === undefined ? "" : String(value)}
                  onChange={(event) => update(field.id, event.target.value || null)}
                  required={create && (field.required || requiredIds.includes(field.id))}
                  maxLength={
                    field.fieldType === "url" ? 2048 : field.fieldType === "text" ? 5000 : undefined
                  }
                />
              )}
            </div>
          );
          })}
        </div>
      )}

      {inactiveFilledFields.length > 0 && (
        <div className={activeFields.length > 0 ? "border-t border-border/60 pt-3 space-y-2.5" : "space-y-2.5"}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Histórico de campos inativos ({inactiveFilledFields.length})
            </span>
          </div>
          <div
            className={
              columns === 2
                ? "grid grid-cols-1 md:grid-cols-2 gap-3"
                : "space-y-2.5"
            }
          >
            {inactiveFilledFields.map((field) => {
              const rawVal = resolveFieldDisplayValue(values, field);
              const display = formatInactiveDisplayValue(field, rawVal);
              const isSafeUrl =
                field.fieldType === "url" &&
                /^https?:\/\//i.test(display.trim());
              return (
                <div key={field.id} className="space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      {field.name}
                    </span>
                    <SystemTooltip content="Campo inativo — valor histórico preservado apenas para consulta">
                      <span className="inline-flex items-center rounded border border-border/80 bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground cursor-default">
                        Inativo
                      </span>
                    </SystemTooltip>
                  </div>
                  <SystemTooltip content="Campo inativo (somente leitura)">
                    <div className="min-h-9 w-full rounded-[8px] border border-border/70 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground flex items-center justify-between gap-2 break-words">
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{display}</span>
                      {isSafeUrl && (
                        <a
                          href={display.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-primary hover:opacity-80"
                          aria-label={`Abrir link de ${field.name}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </SystemTooltip>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function CustomFieldsSummary({
  entity,
  values,
  pipelineId,
}: {
  entity: CustomFieldEntity;
  values: Record<string, unknown>;
  pipelineId?: string | null;
}) {
  const { fields } = useCustomFields(entity, true, { includeArchived: true });
  const currentNorm = normalizePipelineId(pipelineId);

  const visible = fields.filter((field) => {
    const val = resolveFieldDisplayValue(values, field);
    if (!isCustomFieldValueFilled(val)) return false;
    if (isCustomFieldInactive(field)) return true;
    if (entity !== "deal" || field.allPipelines) return true;

    const pIds = field.pipelineIds || [];
    if (!pIds.length) return true;
    if (!pipelineId) return true;

    return pIds.some((id) => {
      if (!id) return false;
      if (id === pipelineId) return true;
      const targetNorm = normalizePipelineId(id);
      if (targetNorm && currentNorm && targetNorm === currentNorm) return true;
      return (
        typeof id === "string" &&
        typeof pipelineId === "string" &&
        (id.includes(pipelineId) || pipelineId.includes(id))
      );
    });
  });

  if (!visible.length) return null;
  return (
    <dl className="space-y-2 border-t border-border/60 pt-2 text-[11px]">
      {visible.map((field) => {
        const value = resolveFieldDisplayValue(values, field);
        const display = formatInactiveDisplayValue(field, value);
        const inactive = isCustomFieldInactive(field);
        return (
          <div key={field.id} className="flex justify-between gap-2">
            <dt className="text-muted-foreground flex items-center gap-1 min-w-0">
              <span className="truncate">{field.name}</span>
              {inactive && (
                <span className="shrink-0 rounded border border-border/80 bg-muted px-1 py-0.2 text-[9px] font-semibold uppercase text-muted-foreground">
                  Inativo
                </span>
              )}
            </dt>
            <SystemTooltip content={display}>
              <dd className="max-w-[60%] truncate text-right font-semibold cursor-default">
                {display}
              </dd>
            </SystemTooltip>
          </div>
        );
      })}
    </dl>
  );
}
