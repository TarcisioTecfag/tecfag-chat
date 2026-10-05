import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { bodyVariableIndexes, isSupportedMetaTemplate, type TemplateBinding, type TemplateBindings } from "@/lib/whatsapp/meta-template-common";

const BASE = import.meta.env.VITE_BACKEND_URL || "";

type MetaTemplate = {
  metaTemplateId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  bodyText: string;
  components: Array<{ type?: string }>;
  bindings: TemplateBindings;
  rejectedReason: string | null;
};

type Form = {
  metaTemplateId?: string;
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  bodyText: string;
  examples: string[];
  bindings: TemplateBindings;
};

const emptyForm = (): Form => ({ name: "", language: "pt_BR", category: "UTILITY", bodyText: "", examples: [], bindings: {} });

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, { credentials: "include", ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Falha na comunicação com a Meta.");
  return data;
}

function bindingLabel(binding: TemplateBinding) {
  return binding === "customer_name" ? "@nome do cliente" : binding === "operator_name" ? "@nome do operador" : "Preencher no envio";
}

export function MetaTemplatesManager({ tenant }: { tenant: string | null }) {
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [mappingId, setMappingId] = useState<string | null>(null);
  const [mapping, setMapping] = useState<TemplateBindings>({});

  const refresh = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/whatsapp/meta-templates");
      setTemplates((data.templates || []).filter((item: MetaTemplate) => item.status !== "DELETED"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar templates.");
    } finally { setLoading(false); }
  }, [tenant]);

  useEffect(() => { void refresh(); }, [refresh]);

  const insertVariable = (binding: TemplateBinding) => {
    if (!form) return;
    const next = Math.max(0, ...bodyVariableIndexes(form.bodyText)) + 1;
    setForm({ ...form, bodyText: `${form.bodyText}${form.bodyText && !form.bodyText.endsWith(" ") ? " " : ""}{{${next}}}`,
      examples: [...form.examples, binding === "customer_name" ? "Maria" : binding === "operator_name" ? "João" : "Exemplo"],
      bindings: { ...form.bindings, [next]: binding } });
  };

  const openEdit = (item: MetaTemplate) => {
    const indexes = bodyVariableIndexes(item.bodyText);
    setForm({ metaTemplateId: item.metaTemplateId, name: item.name, language: item.language,
      category: item.category === "MARKETING" ? "MARKETING" : "UTILITY", bodyText: item.bodyText,
      examples: indexes.map((index) => item.bindings[String(index)] === "customer_name" ? "Maria" : item.bindings[String(index)] === "operator_name" ? "João" : "Exemplo"),
      bindings: item.bindings || {} });
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await api("/api/whatsapp/meta-templates", { method: form.metaTemplateId ? "PUT" : "POST", body: JSON.stringify(form) });
      toast.success(form.metaTemplateId ? "Alteração enviada à Meta." : "Template enviado para análise da Meta.");
      setForm(null);
      await refresh();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Falha ao salvar template."); }
    finally { setSaving(false); }
  };

  const remove = async (item: MetaTemplate) => {
    if (!window.confirm(`Excluir o template oficial "${item.name}" da Meta?`)) return;
    try {
      await api(`/api/whatsapp/meta-templates?id=${encodeURIComponent(item.metaTemplateId)}`, { method: "DELETE" });
      toast.success("Exclusão enviada à Meta.");
      await refresh();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Falha ao excluir template."); }
  };

  const saveMapping = async () => {
    if (!mappingId) return;
    try {
      await api("/api/whatsapp/meta-templates", { method: "PATCH", body: JSON.stringify({ metaTemplateId: mappingId, bindings: mapping }) });
      toast.success("Variáveis configuradas.");
      setMappingId(null);
      await refresh();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Falha ao salvar variáveis."); }
  };

  return (
    <section className="space-y-4 border-t border-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-extrabold text-foreground">Templates oficiais da Meta</h3>
          <p className="text-xs text-muted-foreground">Criados na conta WhatsApp Business; somente os aprovados podem ser enviados fora da janela de 24 horas.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-xl border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">{loading ? "Sincronizando..." : "Atualizar status"}</button>
          <button type="button" onClick={() => setForm(emptyForm())} className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Criar template Meta</button>
        </div>
      </div>
      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {templates.map((item) => {
          const indexes = bodyVariableIndexes(item.bodyText);
          return <article key={item.metaTemplateId} className="rounded-2xl border border-border bg-card p-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="font-mono text-foreground">{item.name}</strong>
              <span className={`rounded-lg px-2 py-1 font-semibold ${item.status === "APPROVED" ? "bg-green-100 text-green-800" : item.status === "REJECTED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{item.status}</span>
            </div>
            <p className="mt-1 text-muted-foreground">{item.language} · {item.category}</p>
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-foreground">{item.bodyText.replace(/\{\{(\d+)\}\}/g, (_, number) => bindingLabel(item.bindings?.[number] || "manual"))}</p>
            {item.rejectedReason && <p className="mt-2 text-destructive">Motivo: {item.rejectedReason}</p>}
            {item.status === "APPROVED" && !isSupportedMetaTemplate(item.components || [], item.bodyText) && <p className="mt-2 text-amber-700">Aprovado pela Meta, mas este formato ainda não está disponível no seletor do chat.</p>}
            {indexes.length > 0 && <p className="mt-2 text-muted-foreground">Variáveis: {indexes.map((index) => `{{${index}}} ${bindingLabel(item.bindings?.[String(index)] || "manual")}`).join(" · ")}</p>}
            <div className="mt-3 flex flex-wrap gap-3 border-t border-border pt-3 font-semibold text-primary">
              {indexes.length > 0 && <button type="button" onClick={() => { setMappingId(item.metaTemplateId); setMapping({ ...item.bindings }); }}>Configurar variáveis</button>}
              {item.components?.length > 0 && item.components.every((component) => component.type === "BODY") && <button type="button" onClick={() => openEdit(item)}>Editar</button>}
              <button type="button" onClick={() => void remove(item)} className="text-destructive">Excluir da Meta</button>
            </div>
          </article>;
        })}
      </div>
      {!loading && !error && templates.length === 0 && <p className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">Nenhum template oficial encontrado nesta conta Meta.</p>}

      {mappingId && <div className="fixed inset-0 z-[260] flex items-center justify-center bg-background/80 p-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl">
          <h3 className="font-bold">Configurar variáveis do template</h3>
          {bodyVariableIndexes(templates.find((item) => item.metaTemplateId === mappingId)?.bodyText || "").map((index) =>
            <label key={index} className="flex items-center justify-between gap-3 text-sm"><span>{`{{${index}}}`}</span>
              <select className="rounded-lg border border-border bg-background p-2" value={mapping[String(index)] || "manual"} onChange={(event) => setMapping({ ...mapping, [index]: event.target.value as TemplateBinding })}>
                <option value="customer_name">@nome do cliente</option><option value="operator_name">@nome do operador</option><option value="manual">Preencher no envio</option>
              </select>
            </label>)}
          <div className="flex justify-end gap-3"><button type="button" onClick={() => setMappingId(null)}>Cancelar</button><button type="button" onClick={() => void saveMapping()} className="rounded-lg bg-primary px-3 py-2 text-primary-foreground">Salvar</button></div>
        </div>
      </div>}

      {form && <div className="fixed inset-0 z-[260] flex items-center justify-center bg-background/80 p-4">
        <div className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl">
          <h3 className="font-bold">{form.metaTemplateId ? "Editar template Meta" : "Novo template Meta"}</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">Nome<input className="mt-1 w-full rounded-lg border border-border bg-background p-2" value={form.name} disabled={!!form.metaTemplateId} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="retomar_atendimento" /></label>
            <label className="text-xs">Idioma<input className="mt-1 w-full rounded-lg border border-border bg-background p-2" value={form.language} disabled={!!form.metaTemplateId} onChange={(event) => setForm({ ...form, language: event.target.value })} /></label>
          </div>
          <label className="block text-xs">Categoria<select className="mt-1 w-full rounded-lg border border-border bg-background p-2" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as Form["category"] })}><option value="UTILITY">Utilidade</option><option value="MARKETING">Marketing</option></select></label>
          <label className="block text-xs">Mensagem<textarea className="mt-1 min-h-32 w-full rounded-lg border border-border bg-background p-2" value={form.bodyText} onChange={(event) => setForm({ ...form, bodyText: event.target.value })} placeholder="Olá, {{1}}. Aqui é {{2}}..." /></label>
          <div className="flex flex-wrap gap-2 text-xs"><button type="button" onClick={() => insertVariable("customer_name")} className="rounded-lg border border-border px-2 py-1">Inserir @nome do cliente</button><button type="button" onClick={() => insertVariable("operator_name")} className="rounded-lg border border-border px-2 py-1">Inserir @nome do operador</button><button type="button" onClick={() => insertVariable("manual")} className="rounded-lg border border-border px-2 py-1">Inserir variável manual</button></div>
          {bodyVariableIndexes(form.bodyText).map((index) => <div key={index} className="grid grid-cols-2 gap-2 text-xs">
            <label>{`{{${index}}} — preenchimento`}<select className="mt-1 w-full rounded-lg border border-border bg-background p-2" value={form.bindings[String(index)] || "manual"} onChange={(event) => setForm({ ...form, bindings: { ...form.bindings, [index]: event.target.value as TemplateBinding } })}><option value="customer_name">@nome do cliente</option><option value="operator_name">@nome do operador</option><option value="manual">Manual</option></select></label>
            <label>Exemplo para análise da Meta<input className="mt-1 w-full rounded-lg border border-border bg-background p-2" value={form.examples[index - 1] || ""} onChange={(event) => setForm({ ...form, examples: Array.from({ length: Math.max(form.examples.length, index) }, (_, offset) => offset === index - 1 ? event.target.value : form.examples[offset] || "") })} /></label>
          </div>)}
          <p className="text-xs text-muted-foreground">A Meta analisa o conteúdo e define quando o template estará disponível. Alterações em templates existentes também são submetidas à Meta.</p>
          <div className="flex justify-end gap-3"><button type="button" onClick={() => setForm(null)}>Cancelar</button><button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{saving ? "Enviando..." : "Enviar à Meta"}</button></div>
        </div>
      </div>}
    </section>
  );
}
