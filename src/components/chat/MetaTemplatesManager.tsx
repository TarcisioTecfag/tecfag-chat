import React, { useCallback, useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import {
  bodyVariableIndexes,
  isSupportedMetaTemplate,
  type TemplateBinding,
  type TemplateBindings,
} from "@/lib/whatsapp/meta-template-common";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  MessageSquare,
  Sparkles,
  Plus,
  Trash2,
  ExternalLink,
  PhoneCall,
  HelpCircle,
  Smartphone,
  Eye,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  Type,
  Check,
  X,
  Layers,
} from "lucide-react";

const BASE = import.meta.env.VITE_BACKEND_URL || "";

type MetaTemplate = {
  metaTemplateId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  bodyText: string;
  components: Array<{
    type?: string;
    format?: string;
    text?: string;
    buttons?: Array<{ type?: string; text?: string; url?: string; phone_number?: string }>;
  }>;
  bindings: TemplateBindings;
  rejectedReason: string | null;
};

type HeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
type ButtonType = "NONE" | "QUICK_REPLY" | "CTA";

interface TemplateButtonForm {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phoneNumber?: string;
}

interface FormState {
  metaTemplateId?: string;
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  headerType: HeaderType;
  headerText: string;
  bodyText: string;
  examples: string[];
  bindings: TemplateBindings;
  footerText: string;
  buttonType: ButtonType;
  buttons: TemplateButtonForm[];
}

const emptyForm = (): FormState => ({
  name: "",
  language: "pt_BR",
  category: "UTILITY",
  headerType: "NONE",
  headerText: "",
  bodyText: "",
  examples: [],
  bindings: {},
  footerText: "",
  buttonType: "NONE",
  buttons: [],
});

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Falha na comunicação com a Meta.");
  return data;
}

function bindingLabel(binding: TemplateBinding) {
  return binding === "customer_name"
    ? "@nome do cliente"
    : binding === "operator_name"
    ? "@nome do operador"
    : "Preencher no envio";
}

export function MetaTemplatesManager({ tenant }: { tenant: string | null }) {
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
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
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Inserir tag dinâmica no corpo
  const insertVariable = (binding: TemplateBinding) => {
    if (!form) return;
    const indexes = bodyVariableIndexes(form.bodyText);
    const next = indexes.length > 0 ? Math.max(...indexes) + 1 : 1;
    const spacer = form.bodyText && !form.bodyText.endsWith(" ") ? " " : "";
    const nextBody = `${form.bodyText}${spacer}{{${next}}}`;
    const nextExample =
      binding === "customer_name" ? "Maria" : binding === "operator_name" ? "João" : "Exemplo";

    setForm({
      ...form,
      bodyText: nextBody,
      examples: [...form.examples, nextExample],
      bindings: { ...form.bindings, [next]: binding },
    });
  };

  const openEdit = (item: MetaTemplate) => {
    const indexes = bodyVariableIndexes(item.bodyText);
    const headerComponent = item.components?.find((c) => c.type === "HEADER");
    const footerComponent = item.components?.find((c) => c.type === "FOOTER");
    const buttonsComponent = item.components?.find((c) => c.type === "BUTTONS");

    let headerType: HeaderType = "NONE";
    let headerText = "";
    if (headerComponent) {
      if (headerComponent.format === "TEXT") {
        headerType = "TEXT";
        headerText = headerComponent.text || "";
      } else if (headerComponent.format) {
        headerType = headerComponent.format as HeaderType;
      }
    }

    let buttonType: ButtonType = "NONE";
    let buttons: TemplateButtonForm[] = [];
    if (buttonsComponent?.buttons && buttonsComponent.buttons.length > 0) {
      const first = buttonsComponent.buttons[0];
      if (first.type === "QUICK_REPLY") {
        buttonType = "QUICK_REPLY";
      } else {
        buttonType = "CTA";
      }
      buttons = buttonsComponent.buttons.map((b) => ({
        type: (b.type as any) || "QUICK_REPLY",
        text: b.text || "",
        url: b.url,
        phoneNumber: b.phone_number,
      }));
    }

    setForm({
      metaTemplateId: item.metaTemplateId,
      name: item.name,
      language: item.language,
      category: item.category === "MARKETING" ? "MARKETING" : "UTILITY",
      headerType,
      headerText,
      bodyText: item.bodyText,
      examples: indexes.map(
        (index) =>
          item.bindings[String(index)] === "customer_name"
            ? "Maria"
            : item.bindings[String(index)] === "operator_name"
            ? "João"
            : "Exemplo"
      ),
      bindings: item.bindings || {},
      footerText: footerComponent?.text || "",
      buttonType,
      buttons,
    });
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const payload: any = {
        name: form.name,
        language: form.language,
        category: form.category,
        bodyText: form.bodyText,
        examples: form.examples,
        bindings: form.bindings,
        ...(form.headerType !== "NONE"
          ? {
              header: {
                type: form.headerType,
                ...(form.headerType === "TEXT" ? { text: form.headerText } : {}),
              },
            }
          : {}),
        ...(form.footerText.trim() ? { footerText: form.footerText.trim() } : {}),
        ...(form.buttonType !== "NONE" && form.buttons.length > 0
          ? { buttons: form.buttons }
          : {}),
      };

      if (form.metaTemplateId) {
        payload.metaTemplateId = form.metaTemplateId;
      }

      await api("/api/whatsapp/meta-templates", {
        method: form.metaTemplateId ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });

      toast.success(
        form.metaTemplateId
          ? "Alteração enviada à Meta para revisão."
          : "Template oficial enviado para análise da Meta!"
      );
      setForm(null);
      await refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Falha ao salvar template.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: MetaTemplate) => {
    if (!window.confirm(`Excluir permanentemente o template oficial "${item.name}" da Meta?`)) return;
    try {
      await api(`/api/whatsapp/meta-templates?id=${encodeURIComponent(item.metaTemplateId)}`, {
        method: "DELETE",
      });
      toast.success("Exclusão enviada à Meta.");
      await refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Falha ao excluir template.");
    }
  };

  const saveMapping = async () => {
    if (!mappingId) return;
    try {
      await api("/api/whatsapp/meta-templates", {
        method: "PATCH",
        body: JSON.stringify({ metaTemplateId: mappingId, bindings: mapping }),
      });
      toast.success("Variáveis configuradas com sucesso.");
      setMappingId(null);
      await refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Falha ao salvar variáveis.");
    }
  };

  // Preview interpolado da mensagem
  const livePreviewBody = useMemo(() => {
    if (!form) return "";
    return form.bodyText.replace(/\{\{(\d+)\}\}/g, (_, num) => {
      const idx = Number(num) - 1;
      const example = form.examples[idx]?.trim();
      if (example) return example;
      const binding = form.bindings[num];
      if (binding === "customer_name") return "Maria da Silva";
      if (binding === "operator_name") return "João Atendente";
      return `{{${num}}}`;
    });
  }, [form]);

  return (
    <section className="space-y-5 border-t border-border pt-6">
      {/* Cabeçalho da Seção */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-extrabold text-foreground">
              Templates Oficiais da Meta WhatsApp
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Cloud API v21.0
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Modelos de mensagem pré-aprovados pela Meta. Necessários para iniciar conversas ativas ou retomar atendimentos após a janela de 24 horas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
            <span>{loading ? "Sincronizando..." : "Sincronizar Meta"}</span>
          </button>
          <button
            type="button"
            onClick={() => setForm(emptyForm())}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary hover:opacity-90 px-4 py-2 text-xs font-bold text-primary-foreground transition-all cursor-pointer shadow-soft"
          >
            <Plus className="h-4 w-4" />
            <span>Criar Template Meta</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-xs text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Grid de Templates Existentes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map((item) => {
          const indexes = bodyVariableIndexes(item.bodyText);
          const hasHeader = item.components?.some((c) => c.type === "HEADER");
          const hasFooter = item.components?.some((c) => c.type === "FOOTER");
          const hasButtons = item.components?.some((c) => c.type === "BUTTONS");
          const headerComponent = item.components?.find((c) => c.type === "HEADER");
          const buttonsComponent = item.components?.find((c) => c.type === "BUTTONS");

          const isApproved = item.status === "APPROVED";
          const isRejected = item.status === "REJECTED";

          return (
            <article
              key={item.metaTemplateId}
              className="rounded-2xl border border-border bg-card p-5 text-xs shadow-xs hover:border-primary/40 transition-all flex flex-col justify-between"
            >
              <div>
                {/* Header do Card */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <MessageSquare className="h-3.5 w-3.5 fill-current" />
                    </div>
                    <strong className="font-mono text-sm text-foreground">{item.name}</strong>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      isApproved
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : isRejected
                        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    }`}
                  >
                    {isApproved ? <CheckCircle2 className="h-3 w-3" /> : isRejected ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    {item.status}
                  </span>
                </div>

                {/* Sub-informações / Badges */}
                <div className="flex flex-wrap items-center gap-2 text-muted-foreground mb-3">
                  <span className="font-medium">{item.language}</span>
                  <span>•</span>
                  <span className="font-semibold text-foreground">
                    {item.category === "UTILITY" ? "Utilidade" : item.category}
                  </span>
                  {hasHeader && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                      Cabeçalho: {headerComponent?.format || "TEXTO"}
                    </span>
                  )}
                  {hasButtons && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                      {buttonsComponent?.buttons?.length} Botão(ões)
                    </span>
                  )}
                </div>

                {/* Corpo do template com highlight de variáveis */}
                <div className="rounded-xl bg-muted/40 border border-border/60 p-3.5 space-y-1.5">
                  {hasHeader && headerComponent?.format === "TEXT" && (
                    <p className="font-bold text-foreground text-xs">{headerComponent.text}</p>
                  )}
                  <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed font-sans">
                    {item.bodyText.replace(/\{\{(\d+)\}\}/g, (_, number) => {
                      const binding = item.bindings?.[number] || "manual";
                      return `[${bindingLabel(binding)}]`;
                    })}
                  </p>
                  {hasFooter && (
                    <p className="text-[11px] text-muted-foreground italic pt-1">
                      {item.components?.find((c) => c.type === "FOOTER")?.text}
                    </p>
                  )}

                  {/* Prévia de botões */}
                  {hasButtons && buttonsComponent?.buttons && (
                    <div className="pt-2 border-t border-border/60 flex flex-wrap gap-1.5">
                      {buttonsComponent.buttons.map((btn, bIdx) => (
                        <span
                          key={bIdx}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-card text-foreground border border-border/70"
                        >
                          {btn.type === "URL" ? <ExternalLink className="h-2.5 w-2.5" /> : btn.type === "PHONE_NUMBER" ? <PhoneCall className="h-2.5 w-2.5" /> : null}
                          {btn.text}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {item.rejectedReason && (
                  <div className="mt-2.5 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
                    <strong>Motivo da recusa pela Meta:</strong> {item.rejectedReason}
                  </div>
                )}
              </div>

              {/* Ações do Card */}
              <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {indexes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setMappingId(item.metaTemplateId);
                        setMapping({ ...item.bindings });
                      }}
                      className="font-semibold text-primary hover:underline cursor-pointer"
                    >
                      Configurar Variáveis
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    className="font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
                  >
                    Editar
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void remove(item)}
                  className="text-destructive/80 hover:text-destructive font-semibold transition-colors cursor-pointer"
                >
                  Excluir da Meta
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {!loading && !error && templates.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center space-y-2">
          <MessageSquare className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-bold text-foreground">Nenhum template oficial cadastrado</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Crie seu primeiro template da Meta para poder enviar mensagens de utilidade ou marketing fora da janela de 24 horas.
          </p>
        </div>
      )}

      {/* Modal Simples de Configurar Variáveis */}
      {mappingId && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div>
              <h3 className="text-base font-bold text-foreground">Configurar Variáveis do Template</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Defina quais dados o sistema preencherá automaticamente ao enviar este template.
              </p>
            </div>

            <div className="space-y-3 py-2">
              {bodyVariableIndexes(
                templates.find((item) => item.metaTemplateId === mappingId)?.bodyText || ""
              ).map((index) => (
                <div key={index} className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-bold text-foreground font-mono">{`{{${index}}}`}</span>
                  <Select
                    value={mapping[String(index)] || "manual"}
                    onValueChange={(val) => setMapping({ ...mapping, [index]: val as TemplateBinding })}
                  >
                    <SelectTrigger className="w-48 h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[300]">
                      <SelectItem value="customer_name">@nome do cliente</SelectItem>
                      <SelectItem value="operator_name">@nome do operador</SelectItem>
                      <SelectItem value="manual">Preencher no envio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setMappingId(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-border text-foreground hover:bg-muted cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void saveMapping()}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 cursor-pointer shadow-soft"
              >
                Salvar Configuração
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DRAWER LATERAL (SHEET) COMPLETO DE NOVO / EDITAR TEMPLATE META ── */}
      <Sheet open={!!form} onOpenChange={(open) => { if (!open) setForm(null); }}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-4xl lg:max-w-5xl xl:max-w-6xl p-0 flex flex-col h-full bg-background border-l border-border"
        >
          {/* Header Fixo */}
          <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/20 shrink-0">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <MessageSquare className="h-5 w-5 fill-current" />
              </div>
              <div>
                <SheetTitle className="text-base font-bold text-foreground">
                  {form?.metaTemplateId ? "Editar Template Oficial Meta" : "Novo Template Oficial Meta"}
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground">
                  Crie mensagens padronizadas em conformidade com as diretrizes do WhatsApp Cloud API.
                </SheetDescription>
              </div>
            </div>
          </div>

          {form && (
            /* Split-Screen: Formulário à Esquerda (65%) e Live Preview à Direita (35%) */
            <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 overflow-hidden">
              {/* ── COLUNA ESQUERDA: FORMULÁRIO COMPLETO ── */}
              <div className="lg:col-span-7 overflow-y-auto p-6 space-y-6 pr-4">
                {/* 1. Identificação Geral */}
                <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-primary" />
                    <span>Identificação & Categoria</span>
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1">
                        <Label className="text-xs font-semibold text-foreground">Nome Técnico do Template</Label>
                        <SystemTooltip content="Identificador único exigido pela Meta. Use apenas letras minúsculas sem acento, números e underline (_). Ex: retomar_atendimento">
                          <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                        </SystemTooltip>
                      </div>
                      <Input
                        disabled={!!form.metaTemplateId}
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                        placeholder="ex: retomar_atendimento"
                        className="h-10 text-xs font-mono rounded-xl bg-background border-border"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1">
                        <Label className="text-xs font-semibold text-foreground">Idioma</Label>
                        <SystemTooltip content="Idioma no qual a mensagem foi redigida para a revisão da IA da Meta.">
                          <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                        </SystemTooltip>
                      </div>
                      <Select
                        disabled={!!form.metaTemplateId}
                        value={form.language}
                        onValueChange={(val) => setForm({ ...form, language: val })}
                      >
                        <SelectTrigger className="h-10 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[300]">
                          <SelectItem value="pt_BR">Português (Brasil) - pt_BR</SelectItem>
                          <SelectItem value="en_US">Inglês (EUA) - en_US</SelectItem>
                          <SelectItem value="es_ES">Espanhol - es_ES</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1">
                      <Label className="text-xs font-semibold text-foreground">Categoria do Template</Label>
                      <SystemTooltip content="Utilidade: notificações operacionais, atualizações de pedidos e retomada pós-24h (tarifa menor). Marketing: promoções, ofertas e engajamento comercial.">
                        <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                      </SystemTooltip>
                    </div>
                    <Select
                      value={form.category}
                      onValueChange={(val) => setForm({ ...form, category: val as FormState["category"] })}
                    >
                      <SelectTrigger className="h-10 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[300]">
                        <SelectItem value="UTILITY">Utilidade (Atendimento & Transacional - Tarifa Econômica)</SelectItem>
                        <SelectItem value="MARKETING">Marketing (Campanhas & Ofertas Comerciais)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* 2. Cabeçalho (Header - Opcional) */}
                <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Type className="h-3.5 w-3.5 text-primary" />
                      <span>Cabeçalho da Mensagem (Opcional)</span>
                    </h4>
                    <span className="text-[11px] text-muted-foreground">Mídia ou Texto em destaque</span>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">Tipo de Cabeçalho</Label>
                    <Select
                      value={form.headerType}
                      onValueChange={(val) => setForm({ ...form, headerType: val as HeaderType })}
                    >
                      <SelectTrigger className="h-10 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[300]">
                        <SelectItem value="NONE">Nenhum cabeçalho</SelectItem>
                        <SelectItem value="TEXT">Texto em Destaque (Título)</SelectItem>
                        <SelectItem value="IMAGE">Mídia: Imagem (JPG, PNG)</SelectItem>
                        <SelectItem value="VIDEO">Mídia: Vídeo (MP4)</SelectItem>
                        <SelectItem value="DOCUMENT">Mídia: Documento (PDF)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {form.headerType === "TEXT" && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <Label className="text-xs font-semibold text-foreground">Texto do Cabeçalho</Label>
                        <span className="text-[10px] text-muted-foreground">{form.headerText.length}/60</span>
                      </div>
                      <Input
                        maxLength={60}
                        value={form.headerText}
                        onChange={(e) => setForm({ ...form, headerText: e.target.value })}
                        placeholder="ex: Novidades da Tecfag"
                        className="h-10 text-xs rounded-xl bg-background border-border"
                      />
                    </div>
                  )}

                  {form.headerType !== "NONE" && form.headerType !== "TEXT" && (
                    <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60 text-xs text-muted-foreground flex items-center gap-2.5">
                      {form.headerType === "IMAGE" ? <ImageIcon className="h-5 w-5 text-primary" /> : form.headerType === "VIDEO" ? <VideoIcon className="h-5 w-5 text-primary" /> : <FileText className="h-5 w-5 text-primary" />}
                      <span>A Meta aprova o modelo para envio de arquivos de <strong>{form.headerType}</strong>. O arquivo real é anexado no momento do disparo.</span>
                    </div>
                  )}
                </div>

                {/* 3. Mensagem Principal (Body) */}
                <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5 text-primary" />
                      <span>Corpo da Mensagem (Obrigatório)</span>
                    </h4>
                    <span className="text-[10px] text-muted-foreground">{form.bodyText.length}/1024 caracteres</span>
                  </div>

                  <div className="space-y-2">
                    <textarea
                      maxLength={1024}
                      value={form.bodyText}
                      onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
                      placeholder="Olá, {{1}}. Notamos seu interesse em nossos equipamentos e gostaríamos de retomar nosso contato..."
                      className="w-full min-h-[120px] rounded-xl border border-border bg-background p-3.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 leading-relaxed font-sans"
                    />

                    {/* Barra de atalhos rápidos */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-[11px] font-semibold text-muted-foreground">Inserir tag:</span>
                      <button
                        type="button"
                        onClick={() => insertVariable("customer_name")}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <Sparkles className="h-3 w-3" />
                        <span>@nome do cliente</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => insertVariable("operator_name")}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <Sparkles className="h-3 w-3" />
                        <span>@nome do operador</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => insertVariable("manual")}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted text-foreground hover:bg-muted/80 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Variável manual</span>
                      </button>
                    </div>
                  </div>

                  {/* Configuração de Exemplos & Mapeamento de Variáveis */}
                  {bodyVariableIndexes(form.bodyText).length > 0 && (
                    <div className="pt-3 border-t border-border space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-bold text-foreground">
                          Mapeamento & Exemplos Obrigatórios da Meta
                        </Label>
                        <SystemTooltip content="A Meta exige um exemplo real para cada variável numérica para aprovar o template.">
                          <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                        </SystemTooltip>
                      </div>

                      {bodyVariableIndexes(form.bodyText).map((index) => {
                        const num = String(index);
                        const binding = form.bindings[num] || "manual";
                        return (
                          <div key={index} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 p-3 rounded-xl bg-muted/30 border border-border/60 items-center">
                            <div className="sm:col-span-3 flex items-center gap-2">
                              <span className="font-mono font-bold text-xs text-foreground bg-muted px-2 py-1 rounded">
                                {`{{${index}}}`}
                              </span>
                            </div>

                            <div className="sm:col-span-4">
                              <Select
                                value={binding}
                                onValueChange={(val) =>
                                  setForm({ ...form, bindings: { ...form.bindings, [num]: val as TemplateBinding } })
                                }
                              >
                                <SelectTrigger className="h-9 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="z-[300]">
                                  <SelectItem value="customer_name">@nome do cliente</SelectItem>
                                  <SelectItem value="operator_name">@nome do operador</SelectItem>
                                  <SelectItem value="manual">Manual no envio</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="sm:col-span-5">
                              <Input
                                value={form.examples[index - 1] || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setForm({
                                    ...form,
                                    examples: Array.from(
                                      { length: Math.max(form.examples.length, index) },
                                      (_, offset) => (offset === index - 1 ? val : form.examples[offset] || "")
                                    ),
                                  });
                                }}
                                placeholder={`Exemplo real para {{${index}}} (ex: Maria)`}
                                className="h-9 text-xs rounded-xl bg-background border-border"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 4. Rodapé (Footer - Opcional) */}
                <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Rodapé da Mensagem (Opcional)
                    </h4>
                    <span className="text-[10px] text-muted-foreground">{form.footerText.length}/60</span>
                  </div>
                  <Input
                    maxLength={60}
                    value={form.footerText}
                    onChange={(e) => setForm({ ...form, footerText: e.target.value })}
                    placeholder="ex: Para não receber mais novidades, responda PARAR"
                    className="h-10 text-xs rounded-xl bg-background border-border"
                  />
                </div>

                {/* 5. Botões Interativos (Buttons - Opcional) */}
                <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Botões Interativos (Opcional)
                    </h4>
                    <SystemTooltip content="A Meta permite até 3 botões de resposta rápida ou até 2 botões de chamada para ação (links ou telefones).">
                      <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                    </SystemTooltip>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">Tipo de Botões</Label>
                    <Select
                      value={form.buttonType}
                      onValueChange={(val) => {
                        const bType = val as ButtonType;
                        let initialButtons: TemplateButtonForm[] = [];
                        if (bType === "QUICK_REPLY") {
                          initialButtons = [{ type: "QUICK_REPLY", text: "Sim, tenho interesse" }];
                        } else if (bType === "CTA") {
                          initialButtons = [{ type: "URL", text: "Acessar Site", url: "https://tecfag.com.br" }];
                        }
                        setForm({ ...form, buttonType: bType, buttons: initialButtons });
                      }}
                    >
                      <SelectTrigger className="h-10 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[300]">
                        <SelectItem value="NONE">Nenhum botão</SelectItem>
                        <SelectItem value="QUICK_REPLY">Respostas Rápidas (Caixa de Escolha / Até 3)</SelectItem>
                        <SelectItem value="CTA">Chamada para Ação (Site e Telefone / Até 2)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {form.buttonType === "QUICK_REPLY" && (
                    <div className="space-y-3 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">Botões de Resposta Rápida</span>
                        {form.buttons.length < 3 && (
                          <button
                            type="button"
                            onClick={() =>
                              setForm({
                                ...form,
                                buttons: [...form.buttons, { type: "QUICK_REPLY", text: `Opção ${form.buttons.length + 1}` }],
                              })
                            }
                            className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline cursor-pointer"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Adicionar Botão</span>
                          </button>
                        )}
                      </div>

                      {form.buttons.map((btn, bIdx) => (
                        <div key={bIdx} className="flex items-center gap-2">
                          <Input
                            maxLength={25}
                            value={btn.text}
                            onChange={(e) => {
                              const val = e.target.value;
                              setForm({
                                ...form,
                                buttons: form.buttons.map((b, i) => (i === bIdx ? { ...b, text: val } : b)),
                              });
                            }}
                            placeholder={`Texto do botão ${bIdx + 1} (máx 25 car.)`}
                            className="h-9 text-xs rounded-xl bg-background border-border flex-1"
                          />
                          {form.buttons.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setForm({ ...form, buttons: form.buttons.filter((_, i) => i !== bIdx) })
                              }
                              className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors cursor-pointer"
                              title="Remover botão"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {form.buttonType === "CTA" && (
                    <div className="space-y-3 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">Botões de Chamada para Ação</span>
                        {form.buttons.length < 2 && (
                          <button
                            type="button"
                            onClick={() =>
                              setForm({
                                ...form,
                                buttons: [...form.buttons, { type: "PHONE_NUMBER", text: "Ligar Agora", phoneNumber: "+5514991522605" }],
                              })
                            }
                            className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline cursor-pointer"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Adicionar Ação</span>
                          </button>
                        )}
                      </div>

                      {form.buttons.map((btn, bIdx) => (
                        <div key={bIdx} className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <Select
                              value={btn.type}
                              onValueChange={(val) => {
                                setForm({
                                  ...form,
                                  buttons: form.buttons.map((b, i) =>
                                    i === bIdx
                                      ? {
                                          type: val as "URL" | "PHONE_NUMBER",
                                          text: b.text,
                                          url: val === "URL" ? "https://tecfag.com.br" : undefined,
                                          phoneNumber: val === "PHONE_NUMBER" ? "+5514991522605" : undefined,
                                        }
                                      : b
                                  ),
                                });
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs w-44">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="z-[300]">
                                <SelectItem value="URL">Visitar Site (URL)</SelectItem>
                                <SelectItem value="PHONE_NUMBER">Ligar para Telefone</SelectItem>
                              </SelectContent>
                            </Select>

                            <button
                              type="button"
                              onClick={() =>
                                setForm({ ...form, buttons: form.buttons.filter((_, i) => i !== bIdx) })
                              }
                              className="p-1 text-destructive hover:bg-destructive/10 rounded transition-colors cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <Input
                              maxLength={25}
                              value={btn.text}
                              onChange={(e) => {
                                const val = e.target.value;
                                setForm({
                                  ...form,
                                  buttons: form.buttons.map((b, i) => (i === bIdx ? { ...b, text: val } : b)),
                                });
                              }}
                              placeholder="Texto do botão (máx 25)"
                              className="h-8 text-xs rounded-lg bg-background border-border"
                            />
                            {btn.type === "URL" ? (
                              <Input
                                value={btn.url || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setForm({
                                    ...form,
                                    buttons: form.buttons.map((b, i) => (i === bIdx ? { ...b, url: val } : b)),
                                  });
                                }}
                                placeholder="https://tecfag.com.br"
                                className="h-8 text-xs rounded-lg bg-background border-border"
                              />
                            ) : (
                              <Input
                                value={btn.phoneNumber || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setForm({
                                    ...form,
                                    buttons: form.buttons.map((b, i) => (i === bIdx ? { ...b, phoneNumber: val } : b)),
                                  });
                                }}
                                placeholder="+55 14 99152-2605"
                                className="h-8 text-xs rounded-lg bg-background border-border"
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ── COLUNA DIREITA: LIVE PREVIEW REALISTA DO WHATSAPP ── */}
              <div className="lg:col-span-5 bg-muted/30 border-l border-border/80 p-6 flex flex-col items-center justify-center shrink-0">
                <div className="w-full max-w-sm flex flex-col items-center space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground self-start">
                    <Eye className="h-4 w-4 text-primary" />
                    <span>Visualização em Tempo Real (WhatsApp)</span>
                  </div>

                  {/* Smartphone Frame / Mockup WhatsApp */}
                  <div className="w-full rounded-3xl border-4 border-muted-foreground/30 bg-[#0b141a] text-white shadow-2xl overflow-hidden flex flex-col h-[520px]">
                    {/* Header do WhatsApp */}
                    <div className="bg-[#1f2c34] px-4 py-3 flex items-center justify-between border-b border-white/5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-xs text-white">
                          T
                        </div>
                        <div>
                          <p className="text-xs font-bold leading-none text-white">Tecfag Atendimento</p>
                          <p className="text-[10px] text-emerald-400 leading-none mt-1">online</p>
                        </div>
                      </div>
                    </div>

                    {/* Chat Area com Wallpaper sutil */}
                    <div className="flex-1 p-3.5 overflow-y-auto flex flex-col justify-end bg-[#0b141a]">
                      {/* Balão WhatsApp Oficial */}
                      <div className="max-w-[90%] self-end rounded-2xl rounded-tr-xs bg-[#005c4b] text-white text-xs p-3 shadow-md space-y-2 border border-emerald-800/40">
                        {/* Header de Mídia ou Texto */}
                        {form.headerType === "TEXT" && form.headerText && (
                          <p className="font-bold text-white text-xs border-b border-emerald-700/60 pb-1">
                            {form.headerText}
                          </p>
                        )}
                        {form.headerType === "IMAGE" && (
                          <div className="w-full h-28 rounded-lg bg-emerald-950/60 flex flex-col items-center justify-center border border-emerald-800/50 text-emerald-300">
                            <ImageIcon className="h-8 w-8 mb-1 opacity-70" />
                            <span className="text-[10px] font-semibold">Imagem do Cabeçalho</span>
                          </div>
                        )}
                        {form.headerType === "VIDEO" && (
                          <div className="w-full h-28 rounded-lg bg-emerald-950/60 flex flex-col items-center justify-center border border-emerald-800/50 text-emerald-300">
                            <VideoIcon className="h-8 w-8 mb-1 opacity-70" />
                            <span className="text-[10px] font-semibold">Vídeo de Apresentação</span>
                          </div>
                        )}
                        {form.headerType === "DOCUMENT" && (
                          <div className="p-2.5 rounded-lg bg-emerald-950/60 flex items-center gap-2 border border-emerald-800/50 text-emerald-200">
                            <FileText className="h-5 w-5 text-emerald-400 shrink-0" />
                            <span className="text-[10px] font-medium truncate">Documento_Oficial.pdf</span>
                          </div>
                        )}

                        {/* Corpo Interpolado */}
                        <p className="whitespace-pre-wrap leading-relaxed font-sans text-white/95">
                          {livePreviewBody || "Digite a mensagem do template para ver a prévia..."}
                        </p>

                        {/* Rodapé */}
                        {form.footerText && (
                          <p className="text-[10px] text-white/60 italic pt-0.5 border-t border-emerald-700/40">
                            {form.footerText}
                          </p>
                        )}

                        {/* Horário & Double Check */}
                        <div className="flex items-center justify-end gap-1 text-[9px] text-white/70 pt-0.5">
                          <span>17:15</span>
                          <span className="text-sky-400 font-bold">✓✓</span>
                        </div>
                      </div>

                      {/* Botões do WhatsApp abaixo do balão */}
                      {form.buttonType !== "NONE" && form.buttons.length > 0 && (
                        <div className="max-w-[90%] self-end w-full mt-1.5 space-y-1">
                          {form.buttons.map((btn, bIdx) => (
                            <div
                              key={bIdx}
                              className="w-full py-2 px-3 rounded-xl bg-[#1f2c34] text-sky-400 text-center font-semibold text-xs border border-white/5 flex items-center justify-center gap-1.5 shadow-xs"
                            >
                              {btn.type === "URL" ? (
                                <ExternalLink className="h-3 w-3 text-sky-400" />
                              ) : btn.type === "PHONE_NUMBER" ? (
                                <PhoneCall className="h-3 w-3 text-sky-400" />
                              ) : (
                                <MessageSquare className="h-3 w-3 text-sky-400" />
                              )}
                              <span>{btn.text || `Botão ${bIdx + 1}`}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer Fixo do Sheet */}
          <div className="px-6 py-4 border-t border-border flex items-center justify-between bg-muted/20 shrink-0">
            <button
              type="button"
              onClick={() => setForm(null)}
              className="px-4 py-2 rounded-xl text-xs font-semibold border border-border text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving || !form?.name || !form?.bodyText}
              onClick={() => void save()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer shadow-soft"
            >
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <SendIcon className="h-3.5 w-3.5" />}
              <span>{saving ? "Enviando à Meta..." : form?.metaTemplateId ? "Salvar Alterações" : "Enviar para Análise da Meta"}</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function SendIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
