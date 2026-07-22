import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Link,
  Unlink,
  ExternalLink,
  Pencil,
  Save,
  X,
  Loader2,
  Building,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Info,
} from "lucide-react";

interface RdCrmCardProps {
  contactId: string;
  tenantId: string;
}

export function RdCrmCard({ contactId, tenantId }: RdCrmCardProps) {
  const [loading, setLoading] = useState(true);
  const [linked, setLinked] = useState(false);
  const [dealId, setDealId] = useState("");
  const [dealLink, setDealLink] = useState("");
  const [deal, setDeal] = useState<any>(null);
  const [fieldsSchema, setFieldsSchema] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Estados de Edição
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    companyName: "",
    value: 0,
    customFields: {} as Record<string, any>,
  });

  // Modal de Vínculo
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [pastedLink, setPastedLink] = useState("");
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    fetchDealInfo();
  }, [contactId, tenantId]);

  const fetchDealInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/rd-deal?tenantId=${tenantId}`);
      if (!res.ok) {
        throw new Error("Erro ao buscar informações do CRM");
      }
      const data = await res.json();
      if (data.linked) {
        console.log("[DEBUG RD DEAL]", data.debug);
        setLinked(true);
        setDealId(data.dealId);
        setDealLink(data.dealLink);
        setDeal(data.deal);
        setFieldsSchema(data.fieldsSchema || {});

        // Inicializa formulário com dados do CRM usando o helper robusto
        const cfValues: Record<string, any> = {};
        const schema = data.fieldsSchema || {};

        Object.keys(schema).forEach((key) => {
          const field = schema[key];
          if (field) {
            cfValues[field.id] = getCustomFieldValueFromDeal(data.deal, field.id, field.slug);
          }
        });

        setForm({
          name: data.deal?.name || "",
          companyName: data.deal?.organization?.name || "",
          value: data.deal?.value || 0,
          customFields: cfValues,
        });
      } else {
        setLinked(false);
        setDeal(null);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Erro de conexão com o servidor.");
    } finally {
      setLoading(false);
    }
  };

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pastedLink.trim()) return;

    setLinking(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/rd-deal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealLink: pastedLink.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Falha ao vincular card.");
      }

      toast.success("Card do RD CRM vinculado com sucesso!");
      setLinkModalOpen(false);
      setPastedLink("");
      fetchDealInfo();
    } catch (err: any) {
      toast.error(err.message || "Erro ao realizar vínculo.");
    } finally {
      setLinking(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Converte o objeto de customFields em array aceito pela API do RD CRM
      const deal_custom_fields = Object.keys(form.customFields).map((id) => {
        const schemaKey = Object.keys(fieldsSchema).find((key) => fieldsSchema[key]?.id === id);
        const field = schemaKey ? fieldsSchema[schemaKey] : null;
        let val = form.customFields[id] || "";

        // Para campos de múltipla escolha (multiple_choice ou option), a API espera os valores encapsulados em um array
        if (field && (field.type === "multiple_choice" || field.type === "option") && typeof val === "string") {
          val = val ? [val] : [];
        }

        return {
          custom_field_id: id,
          value: val,
        };
      });

      const payload = {
        name: form.name,
        value: Number(form.value) || 0,
        companyName: form.companyName,
        organizationId: deal?.organization?.id || undefined,
        deal_custom_fields,
      };

      const res = await fetch(`/api/contacts/${contactId}/rd-deal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao salvar alterações no CRM.");
      }

      toast.success("Informações sincronizadas com o RD CRM!");
      setIsEditing(false);
      fetchDealInfo();
    } catch (err: any) {
      toast.error(err.message || "Falha ao atualizar card.");
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async () => {
    if (!confirm("Tem certeza que deseja desvincular este card? O negócio continuará existindo no RD CRM.")) {
      return;
    }

    try {
      const res = await fetch(`/api/contacts/${contactId}/rd-deal`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Erro ao desvincular.");
      }

      toast.success("Vínculo removido!");
      setLinked(false);
      setDeal(null);
    } catch (err: any) {
      toast.error(err.message || "Falha ao remover vínculo.");
    }
  };

  // Helper ultra-robusto para extrair o valor do campo do deal (suporta Array ou Objeto, ID, Slug ou Rótulo)
  const getCustomFieldValueFromDeal = (dealObj: any, fieldId?: string, fieldSlug?: string, fieldLabel?: string): string => {
    if (!dealObj) return "";
    const cf = dealObj.deal_custom_fields !== undefined 
      ? dealObj.deal_custom_fields 
      : (dealObj.custom_fields !== undefined ? dealObj.custom_fields : null);

    if (!cf) return "";

    const normalize = (str: string) =>
      str
        ? str
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]/g, "")
        : "";

    const normId = fieldId ? normalize(fieldId) : "";
    const normSlug = fieldSlug ? normalize(fieldSlug) : "";
    const normLabel = fieldLabel ? normalize(fieldLabel) : "";

    // Slugs e rótulos conhecidos do CRM Valem para cruzamento resiliente
    const altSlugs: string[] = [];
    if (normSlug.includes("feitopor") || normLabel.includes("feitopor")) {
      altSlugs.push("feitopor", "feitopor6eba");
    }
    if (normSlug.includes("infocomplementar") || normLabel.includes("informacoescomplementares") || normSlug.includes("estudodecasoescopodoprojeto")) {
      altSlugs.push("informacoescomplementares", "informacaocomplementar", "estudodecasoescopodoprojeto", "descricao");
    }
    if (normSlug.includes("qualificadoporsdr") || normLabel.includes("qualificadoporsdr")) {
      altSlugs.push("qualificadoporsdrvalem", "qualificadoporsdr", "qualificadoporsdrvalemt");
    }
    if (normSlug.includes("tipodeproduto") || normLabel.includes("qualotipodeproduto")) {
      altSlugs.push("qualotipodeprodutovalem", "qualotipodeproduto", "qualotipodeproduto72c8");
    }
    if (normSlug.includes("projetosdesenvolvimento") || normLabel.includes("projetosdesenvolvimento")) {
      altSlugs.push("projetosdesenvolvimento", "projetosdesenvolvimentot");
    }

    const isMatch = (keyCandidate: string, itemObj?: any) => {
      const kNorm = normalize(keyCandidate);
      if (normId && kNorm === normId) return true;
      if (normSlug && (kNorm === normSlug || kNorm.includes(normSlug) || normSlug.includes(kNorm))) return true;
      if (normLabel && (kNorm === normLabel || kNorm.includes(normLabel) || normLabel.includes(kNorm))) return true;
      if (altSlugs.some((alt) => kNorm === alt || kNorm.includes(alt) || alt.includes(kNorm))) return true;

      if (itemObj && typeof itemObj === "object") {
        const objId = normalize(itemObj.custom_field_id || itemObj.id || itemObj._id || itemObj.custom_field?.id || itemObj.custom_field?._id || "");
        const objSlug = normalize(itemObj.slug || itemObj.api_identifier || itemObj.custom_field?.slug || itemObj.custom_field?.api_identifier || "");
        const objLabel = normalize(itemObj.label || itemObj.custom_field?.label || "");

        if (normId && objId === normId) return true;
        if (normSlug && (objSlug === normSlug || objSlug.includes(normSlug) || normSlug.includes(objSlug))) return true;
        if (normLabel && (objLabel === normLabel || objLabel.includes(normLabel) || normLabel.includes(objLabel))) return true;
        if (altSlugs.some((alt) => objSlug === alt || objLabel === alt)) return true;
      }

      return false;
    };

    // 1. Se cf for Array: [ { custom_field_id: "...", value: "..." } ]
    if (Array.isArray(cf)) {
      for (const item of cf) {
        if (!item) continue;
        const key = item.custom_field_id || item.id || item.slug || item.label || "";
        if (isMatch(key, item)) {
          const val = item.value !== undefined && item.value !== null ? item.value : "";
          const str = Array.isArray(val) ? val.join(", ") : String(val);
          if (str.trim() !== "") return str;
        }
      }
    }

    // 2. Se cf for Objeto: { "feito-por": "VENDEDOR", ... }
    if (typeof cf === "object") {
      for (const [key, val] of Object.entries(cf)) {
        if (isMatch(key, val)) {
          let actualVal = val;
          if (val && typeof val === "object" && !Array.isArray(val) && "value" in val) {
            actualVal = (val as any).value;
          }
          if (actualVal === undefined || actualVal === null) continue;
          const strVal = Array.isArray(actualVal) ? actualVal.join(", ") : String(actualVal);
          if (strVal.trim() !== "") return strVal;
        }
      }
    }

    return "";
  };

  // Helper para ler valor de campo personalizado com rótulo de fallback
  const getCustomFieldValue = (fieldKey: string) => {
    const field = fieldsSchema?.[fieldKey];
    const defaultLabels: Record<string, string> = {
      qualificadoSdr: "QUALIFICADO POR SDR (VALEM)",
      projetosDesenvolvimento: "PROJETOS / DESENVOLVIMENTO",
      tipoProduto: "QUAL O TIPO DE PRODUTO (VALEM)",
      feitoPor: "FEITO POR",
      infoComplementar: "INFORMAÇÕES COMPLEMENTARES",
    };

    const val = getCustomFieldValueFromDeal(
      deal,
      field?.id,
      field?.slug,
      field?.label || defaultLabels[fieldKey]
    );

    return val !== "" ? val : "Não informado";
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-6 bg-muted/20 border border-border rounded-2xl min-h-[140px]">
        <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
        <span className="text-xs text-muted-foreground font-semibold">Carregando dados do RD CRM...</span>
      </div>
    );
  }

  // Estilo comum para caixas de conteúdo
  const containerStyle = "rounded-2xl border bg-muted/20 p-4 border-line flex flex-col gap-3.5 relative overflow-hidden animate-fade-in";

  return (
    <div className="space-y-3.5">
      {/* Divider e Título da Integração */}
      <div className="flex items-center gap-2 pt-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-lg bg-primary text-primary-foreground font-black text-[9px] select-none shadow-soft">
          RD
        </div>
        <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
          RD Station CRM
        </h4>
      </div>

      {!linked ? (
        /* ESTADO NÃO VINCULADO */
        <div className={containerStyle}>
          <div className="flex items-start gap-2.5">
            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h5 className="text-[11px] font-bold text-foreground">Sem Vínculo com CRM</h5>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Este contato não possui um negócio vinculado. Vincule para sincronizar informações diretamente com o RD Station.
              </p>
            </div>
          </div>
          <button
            onClick={() => setLinkModalOpen(true)}
            className="w-full flex h-8 items-center justify-center gap-1.5 rounded-xl bg-primary hover:opacity-90 text-primary-foreground font-bold text-xs shadow-soft transition cursor-pointer"
          >
            <Link className="h-3.5 w-3.5" />
            Vincular Card CRM
          </button>
        </div>
      ) : (
        /* ESTADO VINCULADO */
        <div className={containerStyle}>
          {/* Header do Card Vinculado */}
          <div className="flex items-center justify-between pb-1">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-extrabold text-foreground uppercase tracking-wide">
                Card Ativo no CRM
              </span>
            </div>
            <div className="flex items-center gap-1">
              {isEditing ? (
                <>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition cursor-pointer"
                    title="Cancelar"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="p-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-emerald-600 transition cursor-pointer disabled:opacity-55"
                    title="Salvar"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition cursor-pointer"
                    title="Editar Informações"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={handleUnlink}
                    className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500 transition cursor-pointer"
                    title="Desvincular do CRM"
                  >
                    <Unlink className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Conteúdo do Card */}
          <div className="space-y-3">
            {isEditing ? (
              /* MODO EDIÇÃO */
              <div className="space-y-2.5">
                <div className="space-y-0.5">
                  <label className="text-[9px] font-bold text-muted-foreground uppercase">Título do Negócio</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="h-8 w-full rounded-lg bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[9px] font-bold text-muted-foreground uppercase">Nome da Empresa</label>
                  <input
                    type="text"
                    value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                    className="h-8 w-full rounded-lg bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                    placeholder="Empresa no CRM"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[9px] font-bold text-muted-foreground uppercase">Valor do Negócio (R$)</label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="number"
                      value={form.value || ""}
                      onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
                      className="h-8 w-full rounded-lg bg-card pl-7 pr-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {/* Renderização Dinâmica dos Campos Personalizados do Valem */}
                {Object.keys(fieldsSchema).map((key) => {
                  const field = fieldsSchema[key];
                  if (!field) return null;

                  return (
                    <div key={field.id} className="space-y-0.5">
                      <label className="text-[9px] font-bold text-muted-foreground uppercase">
                        {field.label}
                      </label>
                      {field.type === "select" || field.type === "multiple_choice" || field.type === "option" ? (
                        <select
                          value={form.customFields[field.id] || ""}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              customFields: { ...form.customFields, [field.id]: e.target.value },
                            })
                          }
                          className="h-8 w-full rounded-lg bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                        >
                          <option value="">Selecione uma opção...</option>
                          {(field.options || field.custom_field_options)?.map((opt: any) => {
                            const val = typeof opt === "string" ? opt : opt.value;
                            return (
                              <option key={val} value={val}>
                                {val}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        // Textarea para Informações Complementares, input para o resto
                        key === "infoComplementar" ? (
                          <textarea
                            value={form.customFields[field.id] || ""}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                customFields: { ...form.customFields, [field.id]: e.target.value },
                              })
                            }
                            rows={3}
                            className="w-full rounded-lg bg-card p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border resize-none"
                            placeholder="Informações adicionais..."
                          />
                        ) : (
                          <input
                            type="text"
                            value={form.customFields[field.id] || ""}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                customFields: { ...form.customFields, [field.id]: e.target.value },
                              })
                            }
                            className="h-8 w-full rounded-lg bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                          />
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* MODO VISUALIZAÇÃO */
              <div className="space-y-3.5">
                {/* Nome do Negócio */}
                <div className="space-y-0.5">
                  <span className="text-[9px] text-muted-foreground uppercase font-bold">Título da Oportunidade</span>
                  <div className="text-xs font-bold text-foreground leading-snug">{deal?.name || "Não informado"}</div>
                </div>

                {/* Grid Básica: Empresa e Valor */}
                <div className="grid grid-cols-2 gap-3 bg-card/40 p-2.5 rounded-xl border border-border/60">
                  <div className="space-y-0.5 min-w-0">
                    <span className="text-[9px] text-muted-foreground uppercase font-bold flex items-center gap-1">
                      <Building className="h-3 w-3 shrink-0" /> Empresa
                    </span>
                    <div className="text-xs font-semibold text-foreground truncate">
                      {deal?.organization?.name || deal?.organization_name || deal?.company_name || (typeof deal?.organization === "string" ? deal.organization : null) || "Não informada"}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[9px] text-muted-foreground uppercase font-bold">
                      Valor
                    </span>
                    <div className="text-xs font-bold text-primary">
                      {deal?.value !== undefined && deal?.value !== null
                        ? Number(deal.value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                        : "R$ 0,00"}
                    </div>
                  </div>
                </div>

                {/* Campos Personalizados */}
                <div className="space-y-3 pt-1">
                  <div className="space-y-0.5 border-b border-line pb-1.5">
                    <span className="text-[9px] text-muted-foreground uppercase font-bold block">
                      Qualificado por SDR (Valem)
                    </span>
                    <span className="text-xs text-foreground font-medium block leading-snug">
                      {getCustomFieldValue("qualificadoSdr")}
                    </span>
                  </div>

                  <div className="space-y-0.5 border-b border-line pb-1.5">
                    <span className="text-[9px] text-muted-foreground uppercase font-bold block">
                      Projetos / Desenvolvimento
                    </span>
                    <span className="text-xs text-foreground font-medium block">
                      {getCustomFieldValue("projetosDesenvolvimento")}
                    </span>
                  </div>

                  <div className="space-y-0.5 border-b border-line pb-1.5">
                    <span className="text-[9px] text-muted-foreground uppercase font-bold block">
                      Qual o tipo de produto (Valem)
                    </span>
                    <span className="text-xs text-foreground font-medium block leading-snug">
                      {getCustomFieldValue("tipoProduto")}
                    </span>
                  </div>

                  <div className="space-y-0.5 border-b border-line pb-1.5">
                    <span className="text-[9px] text-muted-foreground uppercase font-bold block">
                      Feito por
                    </span>
                    <span className="text-xs text-foreground font-medium block">
                      {getCustomFieldValue("feitoPor")}
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    <span className="text-[9px] text-muted-foreground uppercase font-bold block">
                      Informações Complementares
                    </span>
                    <p className="text-xs text-foreground font-medium whitespace-pre-wrap leading-relaxed max-h-[80px] overflow-y-auto pr-1">
                      {getCustomFieldValue("infoComplementar")}
                    </p>
                  </div>
                </div>

                {/* Bloco de Diagnóstico Temporário */}
                <div className="mt-4 p-2.5 bg-black/85 rounded-xl text-[10px] text-green-400 font-mono overflow-auto max-h-[200px] leading-tight select-all border border-green-500/20">
                  <div className="font-bold border-b border-green-500/10 pb-1 mb-1">🔍 DEBUG DE CAMPOS PERSONALIZADOS:</div>
                  <pre>{JSON.stringify(deal?.deal_custom_fields || deal?.custom_fields || [], null, 2)}</pre>
                </div>
              </div>
            )}

            {/* Link Externo */}
            {dealLink && (
              <a
                href={dealLink}
                target="_blank"
                rel="noreferrer"
                className="mt-1 flex items-center justify-center gap-1 text-[10px] font-bold text-primary hover:opacity-90 hover:underline cursor-pointer border border-primary/20 bg-primary-soft/30 hover:bg-primary-soft/50 py-1.5 rounded-xl transition"
              >
                Ver Card no RD CRM <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* MODAL DE VÍNCULO */}
      {linkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm rounded-3xl bg-card border border-border p-6 shadow-soft space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-primary text-primary-foreground font-black text-[9px]">RD</div>
                <h3 className="text-sm font-extrabold text-foreground">Vincular Deal RD CRM</h3>
              </div>
              <button
                onClick={() => {
                  setLinkModalOpen(false);
                  setPastedLink("");
                }}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleLink} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Link da Negociação</label>
                <input
                  type="url"
                  placeholder="https://crm.rdstation.com/app/deals/..."
                  value={pastedLink}
                  onChange={(e) => setPastedLink(e.target.value)}
                  required
                  className="h-9 w-full rounded-xl bg-muted px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
                />
                <span className="text-[9px] text-muted-foreground leading-relaxed block mt-1">
                  Cole a URL inteira do card do cliente aberta no seu navegador no RD CRM.
                </span>
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setLinkModalOpen(false);
                    setPastedLink("");
                  }}
                  className="flex-1 h-9 rounded-xl border border-border text-xs font-bold text-foreground hover:bg-muted cursor-pointer transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={linking || !pastedLink}
                  className="flex-1 h-9 rounded-xl bg-primary hover:opacity-90 text-primary-foreground text-xs font-bold shadow-soft transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-55"
                >
                  {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Confirmar Vínculo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
