import { useEffect, useState } from "react";
import { DEFAULT_MATURITY_RULES, type MaturityRule } from "@/lib/commercial/metrics";

type Settings = {
  maturityRules: MaturityRule[];
  excludedStageIds: string[];
  slaLimitMinutes: number;
  slaBuckets: number[];
  lossReasonCategories: Array<{ name: string; reasons: string[] }>;
  tvSettings: { rotationSeconds: number; activeModules: number[] };
};
type Stage = { id: string; name: string; pipelineId: string };
const moduleNames = [
  "Pipeline",
  "Maturidade atual",
  "Previsão",
  "Metas e ritmo",
  "Perdas",
  "TMA e SLA",
];
const field =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground";

export function CommercialSettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/commercial/settings", { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Falha ao carregar configurações.");
        return body;
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setSettings({
            maturityRules:
              body.settings.maturityRules?.length === 5
                ? body.settings.maturityRules
                : DEFAULT_MATURITY_RULES,
            excludedStageIds: body.settings.excludedStageIds || [],
            slaLimitMinutes: body.settings.slaLimitMinutes || 15,
            slaBuckets:
              body.settings.slaBuckets?.length === 3 ? body.settings.slaBuckets : [5, 15, 30],
            lossReasonCategories: body.settings.lossReasonCategories || [],
            tvSettings: {
              rotationSeconds: body.settings.tvSettings?.rotationSeconds || 30,
              activeModules: body.settings.tvSettings?.activeModules || [0, 1, 2, 3, 4, 5],
            },
          });
          setStages(body.stages || []);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Falha ao carregar configurações.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/commercial/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          lossReasonCategories: settings.lossReasonCategories.map((category) => ({
            name: category.name.trim(),
            reasons: category.reasons.map((reason) => reason.trim()).filter(Boolean),
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Falha ao salvar configurações.");
      setNotice("Configurações do War Room salvas.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar configurações.");
    } finally {
      setSaving(false);
    }
  }

  function moveModule(index: number, direction: -1 | 1) {
    setSettings((current) => {
      if (!current) return current;
      const activeModules = [...current.tvSettings.activeModules];
      const target = index + direction;
      if (target < 0 || target >= activeModules.length) return current;
      [activeModules[index], activeModules[target]] = [activeModules[target], activeModules[index]];
      return { ...current, tvSettings: { ...current.tvSettings, activeModules } };
    });
  }

  if (loading) return <p className="text-sm text-muted-foreground">Carregando configurações...</p>;
  if (!settings)
    return (
      <p role="alert" className="text-sm text-red-600">
        {error || "Configurações indisponíveis."}
      </p>
    );

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-extrabold text-foreground">Régua de maturidade</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Cada faixa usa o valor da negociação e o tempo desde a criação. A última faixa não tem
          teto.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-5">
          {settings.maturityRules.map((rule, index) => (
            <div key={index} className="rounded-xl border border-border p-3">
              <strong className="text-xs text-primary">Faixa {index + 1}</strong>
              <label className="mt-2 block text-xs text-muted-foreground">
                Dias
                <input
                  required
                  type="number"
                  min="1"
                  max="365"
                  value={rule.days}
                  onChange={(event) =>
                    setSettings(
                      (current) =>
                        current && {
                          ...current,
                          maturityRules: current.maturityRules.map((item, position) =>
                            position === index
                              ? { ...item, days: Number(event.target.value) }
                              : item,
                          ),
                        },
                    )
                  }
                  className={`${field} mt-1`}
                />
              </label>
              {index < 4 ? (
                <label className="mt-2 block text-xs text-muted-foreground">
                  Valor máximo (R$)
                  <input
                    required
                    type="number"
                    min="1"
                    step="0.01"
                    value={rule.maxValue ?? ""}
                    onChange={(event) =>
                      setSettings(
                        (current) =>
                          current && {
                            ...current,
                            maturityRules: current.maturityRules.map((item, position) =>
                              position === index
                                ? { ...item, maxValue: Number(event.target.value) }
                                : item,
                            ),
                          },
                      )
                    }
                    className={`${field} mt-1`}
                  />
                </label>
              ) : (
                <p className="mt-4 text-xs text-muted-foreground">Sem teto de valor</p>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-extrabold text-foreground">Etapas fora do pipeline ativo</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Selecione, por ID de etapa do CRM, fases como Requalificação que não devem contar em
          oportunidades e maturidade.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {stages.map((stage) => (
            <label
              key={stage.id}
              className="flex items-center gap-2 rounded-xl border border-border p-3 text-xs text-foreground"
            >
              <input
                type="checkbox"
                checked={settings.excludedStageIds.includes(stage.id)}
                onChange={(event) =>
                  setSettings(
                    (current) =>
                      current && {
                        ...current,
                        excludedStageIds: event.target.checked
                          ? [...current.excludedStageIds, stage.id]
                          : current.excludedStageIds.filter((id) => id !== stage.id),
                      },
                  )
                }
              />
              {stage.name}
            </label>
          ))}
          {!stages.length && (
            <p className="text-xs text-muted-foreground">Configure as etapas no CRM primeiro.</p>
          )}
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-extrabold text-foreground">Categorias de perdas</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Associe os motivos cadastrados no CRM às categorias do BI. Motivos sem associação aparecem
          em “Sem categoria”. Um motivo pode pertencer a uma categoria.
        </p>
        <div className="mt-4 space-y-3">
          {settings.lossReasonCategories.map((category, index) => (
            <div key={index} className="rounded-xl border border-border p-3">
              <div className="flex gap-2">
                <input
                  aria-label={`Nome da categoria ${index + 1}`}
                  value={category.name}
                  onChange={(event) =>
                    setSettings(
                      (current) =>
                        current && {
                          ...current,
                          lossReasonCategories: current.lossReasonCategories.map(
                            (item, position) =>
                              position === index ? { ...item, name: event.target.value } : item,
                          ),
                        },
                    )
                  }
                  placeholder="Nome da categoria"
                  className={field}
                />
                <button
                  type="button"
                  onClick={() =>
                    setSettings(
                      (current) =>
                        current && {
                          ...current,
                          lossReasonCategories: current.lossReasonCategories.filter(
                            (_, position) => position !== index,
                          ),
                        },
                    )
                  }
                  className="rounded border border-border px-3 text-xs"
                >
                  Excluir
                </button>
              </div>
              <label className="mt-2 block text-xs text-muted-foreground">
                Motivos do CRM, um por linha
                <textarea
                  value={category.reasons.join("\n")}
                  onChange={(event) =>
                    setSettings(
                      (current) =>
                        current && {
                          ...current,
                          lossReasonCategories: current.lossReasonCategories.map(
                            (item, position) =>
                              position === index
                                ? { ...item, reasons: event.target.value.split("\n") }
                                : item,
                          ),
                        },
                    )
                  }
                  rows={3}
                  className={`${field} mt-1`}
                />
              </label>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            setSettings(
              (current) =>
                current && {
                  ...current,
                  lossReasonCategories: [
                    ...current.lossReasonCategories,
                    { name: "", reasons: [] },
                  ],
                },
            )
          }
          className="mt-3 rounded-lg border border-border px-3 py-2 text-xs font-bold"
        >
          Adicionar categoria
        </button>
      </section>
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-extrabold text-foreground">SLA e TV</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            Limite de resposta (minutos)
            <input
              required
              type="number"
              min="1"
              max="1440"
              value={settings.slaLimitMinutes}
              onChange={(event) =>
                setSettings(
                  (current) =>
                    current && { ...current, slaLimitMinutes: Number(event.target.value) },
                )
              }
              className={`${field} mt-1`}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Rotação (segundos)
            <input
              required
              type="number"
              min="10"
              max="300"
              value={settings.tvSettings.rotationSeconds}
              onChange={(event) =>
                setSettings(
                  (current) =>
                    current && {
                      ...current,
                      tvSettings: {
                        ...current.tvSettings,
                        rotationSeconds: Number(event.target.value),
                      },
                    },
                )
              }
              className={`${field} mt-1`}
            />
          </label>
        </div>
        <p className="mt-4 text-xs font-bold text-foreground">Limites das quatro faixas de TMA</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Informe três limites crescentes em minutos; a quarta faixa contém respostas acima do
          último limite.
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {settings.slaBuckets.map((value, index) => (
            <label key={index} className="text-xs text-muted-foreground">
              Limite {index + 1} (minutos)
              <input
                required
                type="number"
                min="1"
                max="1440"
                value={value}
                onChange={(event) =>
                  setSettings(
                    (current) =>
                      current && {
                        ...current,
                        slaBuckets: current.slaBuckets.map((item, position) =>
                          position === index ? Number(event.target.value) : item,
                        ),
                      },
                  )
                }
                className={`${field} mt-1`}
              />
            </label>
          ))}
        </div>
        <p className="mt-4 text-xs font-bold text-foreground">Módulos ativos e ordem de rotação</p>
        <div className="mt-2 space-y-2">
          {settings.tvSettings.activeModules.map((moduleId, index) => (
            <div
              key={moduleId}
              className="flex items-center justify-between rounded-xl border border-border p-2 text-xs"
            >
              <span>
                {index + 1}. {moduleNames[moduleId]}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => moveModule(index, -1)}
                  disabled={index === 0}
                  className="rounded-lg border border-border px-2 py-1 disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveModule(index, 1)}
                  disabled={index === settings.tvSettings.activeModules.length - 1}
                  className="rounded-lg border border-border px-2 py-1 disabled:opacity-40"
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={settings.tvSettings.activeModules.length === 1}
                  onClick={() =>
                    setSettings(
                      (current) =>
                        current && {
                          ...current,
                          tvSettings: {
                            ...current.tvSettings,
                            activeModules: current.tvSettings.activeModules.filter(
                              (id) => id !== moduleId,
                            ),
                          },
                        },
                    )
                  }
                  className="rounded-lg border border-border px-2 py-1 text-primary disabled:opacity-40"
                >
                  Remover
                </button>
              </span>
            </div>
          ))}
          {moduleNames.map(
            (name, id) =>
              !settings.tvSettings.activeModules.includes(id) && (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    setSettings(
                      (current) =>
                        current && {
                          ...current,
                          tvSettings: {
                            ...current.tvSettings,
                            activeModules: [...current.tvSettings.activeModules, id],
                          },
                        },
                    )
                  }
                  className="mr-2 rounded-lg border border-border px-2 py-1 text-xs text-primary"
                >
                  + {name}
                </button>
              ),
          )}
        </div>
      </section>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-600">
          {notice}
        </p>
      )}
      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-white disabled:opacity-50"
      >
        {saving ? "Salvando..." : "Salvar configurações"}
      </button>
    </form>
  );
}
