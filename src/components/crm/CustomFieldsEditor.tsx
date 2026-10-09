import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  type CustomFieldEntity,
  type CustomFieldType,
  normalizePipelineId,
} from "@/lib/crm/custom-fields";
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

export function useCustomFields(entity: CustomFieldEntity, enabled = true) {
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    setLoading(true);
    fetch(`/api/crm/custom-fields?entity=${entity}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar os campos personalizados.");
        return response.json();
      })
      .then((data) => {
        if (mounted) {
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
        if (mounted) setFields([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [entity, enabled]);
  return { fields, loading };
}

export function CustomFieldsEditor({
  entity,
  pipelineId,
  values,
  onChange,
  create = false,
  definitions,
  requiredIds = [],
  hideTitle = false,
}: {
  entity: CustomFieldEntity;
  pipelineId?: string | null;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  create?: boolean;
  definitions?: FieldDefinition[];
  requiredIds?: string[];
  hideTitle?: boolean;
}) {
  const loaded = useCustomFields(entity, !definitions);
  const fields = useMemo(() => {
    const rawList = (definitions ?? loaded.fields).map((f) => ({
      ...f,
      options: normalizeFieldOptions(f.options),
      pipelineIds: normalizePipelineIds(f.pipelineIds),
    }));

    return rawList.filter((field) => {
      // Regra de criação: respeita visibleOnCreate a menos que seja obrigatório
      if (create && !field.visibleOnCreate && !requiredIds.includes(field.id)) {
        return false;
      }

      // Para entidades diferentes de deal (empresa, contato, produto), sempre exibe
      if (entity !== "deal") return true;

      // Se a negociação já possui valor preenchido ou rascunhado para este campo, NUNCA oculta
      if (
        values &&
        values[field.id] !== undefined &&
        values[field.id] !== null &&
        values[field.id] !== ""
      ) {
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
  }, [definitions, loaded.fields, entity, create, pipelineId, requiredIds, values]);

  if (!fields.length) return null;
  const update = (id: string, value: unknown) => onChange({ ...values, [id]: value });
  return (
    <div className={`space-y-3 ${hideTitle ? "" : "border-t border-border pt-4"}`}>
      {!hideTitle && (
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Campos personalizados
        </h4>
      )}
      {fields.map((field) => {
        const value = values[field.id];
        const common =
          "h-9 w-full rounded-lg border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-primary";
        return (
          <div key={field.id} className="space-y-1">
            <label
              className="block text-xs font-semibold text-foreground"
              htmlFor={`cf-${field.id}`}
            >
              {field.name}
              {create && (field.required || requiredIds.includes(field.id)) && (
                <span className="ml-1 text-primary">*</span>
              )}
            </label>
            {field.fieldType === "multiple" ? (
              <div className="max-h-36 space-y-2 overflow-y-auto rounded-lg border border-border bg-card p-2.5">
                {field.options.map((option) => {
                  const selected = Array.isArray(value) ? (value as string[]) : [];
                  const isChecked = selected.includes(option.id);
                  return (
                    <label
                      key={option.id}
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
                  );
                })}
              </div>
            ) : field.fieldType === "single" ? (
              <Select
                value={typeof value === "string" && value ? value : "__empty__"}
                onValueChange={(val) => update(field.id, val === "__empty__" ? null : val)}
              >
                <SelectTrigger id={`cf-${field.id}`} className="h-9 w-full rounded-lg text-xs bg-background">
                  <SelectValue placeholder="Selecionar..." />
                </SelectTrigger>
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
                  className={`${common} pr-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                  type="number"
                  step="any"
                  value={value === null || value === undefined ? "" : String(value)}
                  onChange={(event) => {
                    const raw = event.target.value;
                    update(field.id, raw === "" ? null : Number(raw));
                  }}
                  required={create && (field.required || requiredIds.includes(field.id))}
                />
                <div className="absolute right-1.5 flex items-center gap-1">
                  <SystemTooltip content="Diminuir valor (-1)">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        const currentNum = typeof value === "number" ? value : Number(value) || 0;
                        update(field.id, currentNum - 1);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded border border-border/80 bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
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
                        const currentNum = typeof value === "number" ? value : Number(value) || 0;
                        update(field.id, currentNum + 1);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded border border-border/80 bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
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
  const { fields } = useCustomFields(entity);
  const currentNorm = normalizePipelineId(pipelineId);

  const visible = fields.filter((field) => {
    const val = values[field.id];
    const isValFilled =
      val !== null &&
      val !== undefined &&
      val !== "" &&
      (!Array.isArray(val) || val.length > 0);

    if (!isValFilled) return false;
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
        const value = values[field.id];
        const optionLabel = (id: string) =>
          field.options.find((option) => option.id === id)?.label || id;
        const display = Array.isArray(value)
          ? value.map(optionLabel).join(", ")
          : field.fieldType === "single"
            ? optionLabel(String(value))
            : String(value);
        return (
          <div key={field.id} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{field.name}</dt>
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
