import { useEffect, useMemo, useState } from "react";
import type { CustomFieldEntity, CustomFieldType } from "@/lib/crm/custom-fields";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemTooltip } from "@/components/ui/tooltip";

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
  visibleOnCreate: boolean;
  allPipelines: boolean;
  pipelineIds: string[];
  sortOrder: number;
  createdAt: string;
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
        if (mounted) setFields(data.fields || []);
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
}: {
  entity: CustomFieldEntity;
  pipelineId?: string | null;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  create?: boolean;
  definitions?: FieldDefinition[];
  requiredIds?: string[];
}) {
  const loaded = useCustomFields(entity, !definitions);
  const fields = useMemo(
    () =>
      (definitions ?? loaded.fields).filter(
        (field) =>
          (!create || field.visibleOnCreate || requiredIds.includes(field.id)) &&
          (entity !== "deal" ||
            field.allPipelines ||
            (!!pipelineId && field.pipelineIds.includes(pipelineId))),
      ),
    [definitions, loaded.fields, entity, create, pipelineId, requiredIds],
  );

  if (!fields.length) return null;
  const update = (id: string, value: unknown) => onChange({ ...values, [id]: value });
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Campos personalizados
      </h4>
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
            ) : (
              <input
                id={`cf-${field.id}`}
                className={common}
                type={
                  field.fieldType === "date"
                    ? "date"
                    : field.fieldType === "number"
                      ? "number"
                      : field.fieldType === "url"
                        ? "url"
                        : "text"
                }
                step={field.fieldType === "number" ? "any" : undefined}
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
  const visible = fields.filter(
    (field) =>
      (entity !== "deal" ||
        field.allPipelines ||
        (!!pipelineId && field.pipelineIds.includes(pipelineId))) &&
      values[field.id] !== null &&
      values[field.id] !== undefined &&
      values[field.id] !== "" &&
      (!Array.isArray(values[field.id]) || (values[field.id] as unknown[]).length > 0),
  );
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
