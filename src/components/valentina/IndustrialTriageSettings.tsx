import { useEffect, useState } from "react";
import { useChat } from "@/hooks/useChatState";
import {
  DESTINATION_KEYS,
  convertLegacyMachineCatalog,
  emptyIndustrialSettings,
  findCatalogConflicts,
  machineSchema,
  type IndustrialMachine,
  type IndustrialSettings,
} from "@/lib/triage/industrial-settings";
import { INDUSTRIAL_ROUTES, type IndustrialSubflow } from "@/lib/triage/industrial-policy";

type Choices = {
  sectors: { id: string; name: string }[];
  pipelines: { id: string; name: string }[];
  stages: { id: string; name: string; pipelineId: string }[];
};
const inputClass = "border border-border bg-background rounded-lg p-2 text-xs min-w-0 w-full";
const buttonClass =
  "border border-border rounded-lg px-3 py-2 text-xs hover:bg-muted disabled:opacity-50";
const draftId = () =>
  globalThis.crypto?.randomUUID?.() || `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const blankMachine = (): IndustrialMachine => ({
  id: draftId(),
  name: "",
  sku: "",
  code: "",
  line: "SEMI-INDUSTRIAL",
  production: "",
  description: "",
  aliases: [],
  active: true,
});

export function IndustrialTriageSettings() {
  const { tenant, sessionRole } = useChat();
  const [settings, setSettings] = useState<IndustrialSettings>(emptyIndustrialSettings);
  const [revision, setRevision] = useState(0);
  const [choices, setChoices] = useState<Choices>({ sectors: [], pipelines: [], stages: [] });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [machine, setMachine] = useState(blankMachine);
  const [blockedName, setBlockedName] = useState("");
  const [blockedTerms, setBlockedTerms] = useState("");
  const backend = import.meta.env.VITE_BACKEND_URL || "";
  useEffect(() => {
    if (sessionRole !== "admin") return;
    const controller = new AbortController();
    void fetch(`${backend}/api/valentina/industrial-settings`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar");
        setSettings(data.settings);
        setRevision(data.revision);
        setChoices(data.choices);
        setLoaded(true);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, [tenant, sessionRole, backend]);
  if (sessionRole !== "admin") return null;
  const update = (next: IndustrialSettings) => {
    setSettings(next);
    setDirty(true);
    setMessage("");
  };
  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${backend}/api/valentina/industrial-settings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision, settings }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.issues
            ?.map((issue: { path: string; message: string }) => `${issue.path}: ${issue.message}`)
            .join("; ") ||
            data.error ||
            "Falha ao salvar",
        );
      setSettings(data.settings);
      setRevision(data.revision);
      setDirty(false);
      setMessage(
        "Configuração salva. A ativação do SDR continua sendo controlada no painel do agente.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  };
  const matches = settings.catalog.filter((entry) =>
    `${entry.name} ${entry.sku} ${entry.code}`.toLowerCase().includes(search.toLowerCase()),
  );
  const conflicts = findCatalogConflicts(settings.catalog);
  return (
    <details className="border border-border bg-card rounded-xl p-4">
      <summary className="cursor-pointer font-bold text-sm">
        Catálogo e destinos da triagem {dirty ? "• alterações pendentes" : ""}
      </summary>
      <div className="mt-4 space-y-5">
        <p className="text-xs text-muted-foreground">
          Vincule cada atendimento à equipe responsável e, quando necessário, ao funil e à etapa de
          entrada. Alterações só são aplicadas ao salvar.
        </p>
        {message && (
          <p
            role="status"
            className="text-sm border border-border rounded-lg p-3 whitespace-pre-wrap"
          >
            {message}
          </p>
        )}
        {!loaded ? (
          <p className="text-xs">Aguardando configuração…</p>
        ) : (
          <fieldset disabled={busy} className="space-y-5 min-w-0">
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Destinos do atendimento</h3>
              {DESTINATION_KEYS.filter(
                (key) => key === "REVIEW" || INDUSTRIAL_ROUTES[key].action !== "inform",
              ).map((key) => {
                const policy =
                  key === "REVIEW" ? null : INDUSTRIAL_ROUTES[key as IndustrialSubflow];
                const destination = settings.destinations[key];
                const patch = (value: Partial<NonNullable<typeof destination>>) =>
                  update({
                    ...settings,
                    destinations: {
                      ...settings.destinations,
                      [key]: { ...destination, sectorId: destination?.sectorId || "", ...value },
                    },
                  });
                return (
                  <div key={key} className="border border-border rounded-lg p-3 space-y-2">
                    <label className="flex items-center gap-2 text-xs font-semibold">
                      <input
                        type="checkbox"
                        checked={Boolean(destination)}
                        disabled={busy}
                        onChange={(event) => {
                          const destinations = { ...settings.destinations };
                          if (event.target.checked) destinations[key] = { sectorId: "" };
                          else delete destinations[key];
                          update({ ...settings, destinations });
                        }}
                      />
                      {policy?.funnel || "Análise e revisão humana"}
                    </label>
                    {destination && (
                      <div className="grid gap-2 md:grid-cols-3">
                        <label className="text-xs">
                          Equipe / setor
                          <select
                            aria-label={`Setor ${key}`}
                            className={inputClass}
                            value={destination.sectorId}
                            disabled={busy}
                            onChange={(event) => patch({ sectorId: event.target.value })}
                          >
                            <option value="">Selecione o setor</option>
                            {destination.sectorId &&
                              !choices.sectors.some(
                                (sector) => sector.id === destination.sectorId,
                              ) && (
                                <option value={destination.sectorId}>
                                  Setor removido — selecione outro
                                </option>
                              )}
                            {choices.sectors.map((sector) => (
                              <option key={sector.id} value={sector.id}>
                                {sector.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {policy?.createsDeal && (
                          <>
                            <label className="text-xs">
                              Funil CRM
                              <select
                                aria-label={`Funil ${key}`}
                                className={inputClass}
                                value={destination.pipelineId || ""}
                                disabled={busy}
                                onChange={(event) =>
                                  patch({
                                    pipelineId: event.target.value || undefined,
                                    stageId: undefined,
                                  })
                                }
                              >
                                <option value="">Selecione o funil</option>
                                {destination.pipelineId &&
                                  !choices.pipelines.some(
                                    (pipeline) => pipeline.id === destination.pipelineId,
                                  ) && (
                                    <option value={destination.pipelineId}>
                                      Funil removido — selecione outro
                                    </option>
                                  )}
                                {choices.pipelines.map((pipeline) => (
                                  <option key={pipeline.id} value={pipeline.id}>
                                    {pipeline.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-xs">
                              Etapa de entrada
                              <select
                                aria-label={`Etapa ${key}`}
                                className={inputClass}
                                value={destination.stageId || ""}
                                disabled={busy || !destination.pipelineId}
                                onChange={(event) =>
                                  patch({ stageId: event.target.value || undefined })
                                }
                              >
                                <option value="">Selecione a etapa</option>
                                {destination.stageId &&
                                  !choices.stages.some(
                                    (stage) =>
                                      stage.id === destination.stageId &&
                                      stage.pipelineId === destination.pipelineId,
                                  ) && (
                                    <option value={destination.stageId}>
                                      Etapa indisponível — selecione outra
                                    </option>
                                  )}
                                {choices.stages
                                  .filter((stage) => stage.pipelineId === destination.pipelineId)
                                  .map((stage) => (
                                    <option key={stage.id} value={stage.id}>
                                      {stage.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">
                O operador deve participar do setor escolhido e estar autorizado no respectivo funil
                da escala. Um destino sem vínculo mantém o encaminhamento pendente.
              </p>
            </div>
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="font-semibold text-sm">
                Catálogo de máquinas • {settings.catalog.length} registros
              </h3>
              <p className="text-xs text-muted-foreground">
                Importe JSON do catálogo anterior ou cadastre equipamentos. Personnalité, revenda,
                licitação e correspondências incertas passam por revisão humana.
              </p>
              <label className="block text-xs">
                Importar catálogo JSON (substitui o rascunho atual)
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy}
                  className="block mt-1 text-xs"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      if (file.size > 8_000_000) throw new Error("Arquivo excede 8 MB");
                      const raw = JSON.parse(await file.text());
                      const catalog = convertLegacyMachineCatalog(
                        Array.isArray(raw) ? raw : raw.catalog || raw.machines,
                      );
                      update({ ...settings, catalog });
                      setMessage(
                        `${catalog.length} equipamentos no rascunho. Revise antes de salvar.`,
                      );
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Catálogo inválido");
                    }
                    event.target.value = "";
                  }}
                />
              </label>
              <div className="grid md:grid-cols-3 gap-2">
                <label className="text-xs">
                  Nome
                  <input
                    className={inputClass}
                    value={machine.name}
                    onChange={(event) => setMachine({ ...machine, name: event.target.value })}
                  />
                </label>
                <label className="text-xs">
                  Código
                  <input
                    className={inputClass}
                    value={machine.code}
                    onChange={(event) => setMachine({ ...machine, code: event.target.value })}
                  />
                </label>
                <label className="text-xs">
                  SKU
                  <input
                    className={inputClass}
                    value={machine.sku}
                    onChange={(event) => setMachine({ ...machine, sku: event.target.value })}
                  />
                </label>
                <label className="text-xs">
                  Linha
                  <select
                    className={inputClass}
                    value={machine.line}
                    onChange={(event) =>
                      setMachine({
                        ...machine,
                        line: event.target.value as IndustrialMachine["line"],
                      })
                    }
                  >
                    <option value="SEMI-INDUSTRIAL">Semi-industrial</option>
                    <option value="PERSONNALITE">Personnalité</option>
                  </select>
                </label>
                <label className="text-xs">
                  Capacidade / produtividade
                  <input
                    className={inputClass}
                    value={machine.production}
                    onChange={(event) => setMachine({ ...machine, production: event.target.value })}
                  />
                </label>
                <label className="text-xs">
                  Modelos / nomes alternativos (separados por vírgula)
                  <input
                    className={inputClass}
                    value={machine.aliases.join(",")}
                    onChange={(event) =>
                      setMachine({ ...machine, aliases: event.target.value.split(",") })
                    }
                  />
                </label>
              </div>
              <label className="block text-xs">
                Descrição
                <textarea
                  className={inputClass}
                  value={machine.description}
                  onChange={(event) => setMachine({ ...machine, description: event.target.value })}
                />
              </label>
              <label className="flex gap-2 items-center text-xs">
                <input
                  type="checkbox"
                  checked={machine.active}
                  onChange={(event) => setMachine({ ...machine, active: event.target.checked })}
                />
                Equipamento ativo
              </label>
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() => {
                  const parsed = machineSchema.safeParse({
                    ...machine,
                    aliases: machine.aliases.map((term) => term.trim()).filter(Boolean),
                  });
                  if (!parsed.success) {
                    setMessage("Revise nome, códigos e nomes alternativos da máquina.");
                    return;
                  }
                  update({
                    ...settings,
                    catalog: [
                      ...settings.catalog.filter((entry) => entry.id !== machine.id),
                      parsed.data,
                    ],
                  });
                  setMachine(blankMachine());
                }}
              >
                Adicionar / atualizar equipamento no rascunho
              </button>
              {conflicts.length > 0 && (
                <div role="alert" className="border border-border rounded-lg p-3 text-xs space-y-2">
                  <p>Códigos ativos repetidos precisam ser corrigidos antes de salvar:</p>
                  {conflicts.map((conflict) => (
                    <button
                      key={`${conflict.field}-${conflict.code}`}
                      type="button"
                      className={buttonClass}
                      onClick={() => setSearch(conflict.code)}
                    >
                      {conflict.field.toUpperCase()} {conflict.code} • {conflict.machineIds.length}{" "}
                      equipamentos — localizar
                    </button>
                  ))}
                </div>
              )}
              <input
                aria-label="Buscar no catálogo"
                className={inputClass}
                placeholder="Buscar por nome, SKU ou código"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <ul className="space-y-1">
                {matches.slice(0, 30).map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap gap-2 justify-between items-center text-xs border-b border-border py-2"
                  >
                    <span>
                      {entry.code || entry.sku} • {entry.name} • {entry.line}
                      {entry.active ? "" : " • inativo"}
                    </span>
                    <span className="flex gap-2">
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={busy}
                        onClick={() => setMachine(entry)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={busy}
                        onClick={() =>
                          update({
                            ...settings,
                            catalog: settings.catalog.filter((item) => item.id !== entry.id),
                          })
                        }
                      >
                        Remover
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              {matches.length > 30 && (
                <p className="text-xs">Mostrando 30 de {matches.length}. Refine a busca.</p>
              )}
              {!settings.catalog.length && (
                <p className="text-xs">
                  Sem catálogo cadastrado. As demandas de máquinas seguem para revisão.
                </p>
              )}
            </div>
            <div className="space-y-2 border-t border-border pt-4">
              <h3 className="font-semibold text-sm">Famílias não comercializadas</h3>
              <p className="text-xs text-muted-foreground">
                A identificação leva à revisão do especialista. A IA não decide indisponibilidade
                por ausência de resultados.
              </p>
              <input
                aria-label="Nome da família"
                className={inputClass}
                placeholder="Nome da família"
                value={blockedName}
                onChange={(event) => setBlockedName(event.target.value)}
              />
              <input
                aria-label="Termos da família"
                className={inputClass}
                placeholder="Termos exatos, separados por vírgula"
                value={blockedTerms}
                onChange={(event) => setBlockedTerms(event.target.value)}
              />
              <button
                type="button"
                className={buttonClass}
                disabled={busy || blockedName.trim().length < 3 || !blockedTerms.trim()}
                onClick={() => {
                  update({
                    ...settings,
                    blockedFamilies: [
                      ...settings.blockedFamilies,
                      {
                        id: draftId(),
                        name: blockedName.trim(),
                        terms: blockedTerms
                          .split(",")
                          .map((term) => term.trim())
                          .filter(Boolean),
                        reason: "Cadastro administrativo",
                      },
                    ],
                  });
                  setBlockedName("");
                  setBlockedTerms("");
                }}
              >
                Adicionar família ao rascunho
              </button>
              <ul>
                {settings.blockedFamilies.map((family) => (
                  <li key={family.id} className="flex justify-between gap-2 py-2 text-xs">
                    <span>
                      {family.name} • {family.terms.join(", ")}
                    </span>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy}
                      onClick={() =>
                        update({
                          ...settings,
                          blockedFamilies: settings.blockedFamilies.filter(
                            (entry) => entry.id !== family.id,
                          ),
                        })
                      }
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
              disabled={busy || !dirty || conflicts.length > 0}
              onClick={() => void save()}
            >
              {busy ? "Salvando…" : "Salvar catálogo e destinos"}
            </button>
          </fieldset>
        )}
      </div>
    </details>
  );
}
