import React, { useState, useEffect } from "react";
import { Plus, Trash2, Globe, Loader2, Copy, Check, X, Power, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SystemTooltip } from "@/components/ui/tooltip";

interface WebhookSubscription {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  secretPreview?: string;
  secret?: string;
  createdAt?: string;
}

const AVAILABLE_EVENTS: Array<{ value: string; label: string; category: string }> = [
  { value: "deal.created", label: "Negociação criada", category: "CRM" },
  { value: "deal.updated", label: "Negociação atualizada (etapa, dono, valor, status)", category: "CRM" },
  { value: "deal.won", label: "Negociação ganha", category: "CRM" },
  { value: "deal.lost", label: "Negociação perdida", category: "CRM" },
  { value: "conversation.created", label: "Nova conversa iniciada", category: "Chat" },
  { value: "message.received", label: "Mensagem recebida de cliente", category: "Chat" },
  { value: "triage.mode_changed", label: "Modo da triagem IA alterado", category: "IA" },
];

export function WebhookSettingsTab({ tenant }: { tenant: string }) {
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newSub, setNewSub] = useState({ name: "", url: "", events: [] as string[] });
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  useEffect(() => {
    void loadSubscriptions();
  }, [tenant]);

  const loadSubscriptions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings/webhooks`);
      if (res.ok) {
        const data = await res.json();
        setSubscriptions(Array.isArray(data) ? data : Array.isArray(data?.subscriptions) ? data.subscriptions : []);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error || "Erro ao carregar webhooks.");
      }
    } catch {
      toast.error("Erro ao carregar webhooks.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newSub.name.trim() || !newSub.url.trim() || newSub.events.length === 0) {
      toast.error("Informe nome, URL HTTPS e ao menos um evento.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings/webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newSub.name.trim(),
          url: newSub.url.trim(),
          events: newSub.events,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCreatedSecret(data.secret || null);
        setCopiedSecret(false);
        setNewSub({ name: "", url: "", events: [] });
        setIsModalOpen(false);
        await loadSubscriptions();
        toast.success("Webhook criado com sucesso.");
      } else {
        toast.error(data.error || "Erro ao criar webhook.");
      }
    } catch {
      toast.error("Erro de conexão.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (sub: WebhookSubscription) => {
    setTogglingId(sub.id);
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings/webhooks/${encodeURIComponent(sub.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !sub.isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSubscriptions((prev) =>
          prev.map((item) => (item.id === sub.id ? { ...item, isActive: !sub.isActive } : item)),
        );
        toast.success(!sub.isActive ? "Webhook ativado." : "Webhook pausado.");
      } else {
        toast.error(data.error || "Erro ao atualizar webhook.");
      }
    } catch {
      toast.error("Erro ao atualizar webhook.");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings/webhooks/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setPendingDeleteId(null);
        await loadSubscriptions();
        toast.success("Webhook removido.");
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Erro ao deletar webhook.");
      }
    } catch {
      toast.error("Erro ao deletar webhook.");
    }
  };

  const handleCopySecret = async () => {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      setCopiedSecret(true);
      toast.success("Secret HMAC copiado.");
    } catch {
      toast.error("Não foi possível copiar automaticamente.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-extrabold text-foreground">Webhooks de Saída (Webhook Hub)</h3>
          <p className="text-xs text-muted-foreground">
            Entregas em tempo real assinadas com HMAC-SHA256 (<code className="text-[11px]">X-Webhook-Signature</code>) e retentativa exponencial automática.
          </p>
        </div>
        <SystemTooltip content="Cadastrar nova URL HTTPS para receber eventos em tempo real">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-extrabold text-primary-foreground hover:opacity-90 transition cursor-pointer"
          >
            <Plus className="h-4 w-4" /> Nova Integração
          </button>
        </SystemTooltip>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando subscrições...
        </div>
      ) : subscriptions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center space-y-2">
          <Globe className="h-8 w-8 mx-auto text-muted-foreground/60" />
          <p className="text-sm font-bold text-foreground">Nenhum webhook configurado</p>
          <p className="text-xs text-muted-foreground">
            Cadastre uma URL HTTPS para receber eventos como <code>deal.created</code>, <code>deal.updated</code> e <code>message.received</code> sem precisar fazer polling.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {subscriptions.map((sub) => (
            <div
              key={sub.id}
              className="rounded-2xl border border-border bg-card p-4 flex items-start justify-between gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-bold text-foreground">{sub.name}</h4>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      sub.isActive
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {sub.isActive ? "Ativo" : "Pausado"}
                  </span>
                  {sub.secretPreview && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                      <ShieldCheck className="h-3 w-3" /> {sub.secretPreview}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground break-all">{sub.url}</p>
                <div className="pt-1 flex flex-wrap gap-1">
                  {(sub.events || []).map((e) => (
                    <span
                      key={e}
                      className="rounded-lg bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground"
                    >
                      {e}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <SystemTooltip content={sub.isActive ? "Pausar entregas deste webhook" : "Reativar entregas deste webhook"}>
                  <button
                    type="button"
                    disabled={togglingId === sub.id}
                    onClick={() => handleToggleActive(sub)}
                    className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition cursor-pointer disabled:opacity-50"
                  >
                    {togglingId === sub.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Power className="h-4 w-4" />
                    )}
                  </button>
                </SystemTooltip>

                {pendingDeleteId === sub.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleDelete(sub.id)}
                      className="rounded-lg bg-destructive px-2.5 py-1.5 text-[11px] font-bold text-destructive-foreground hover:opacity-90 cursor-pointer"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(null)}
                      className="rounded-lg bg-muted px-2 py-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <SystemTooltip content="Remover subscrição de webhook">
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(sub.id)}
                      className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </SystemTooltip>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-6 shadow-soft space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-extrabold">Nova Assinatura de Webhook</h3>
              <SystemTooltip content="Fechar">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 rounded-lg hover:bg-muted cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </SystemTooltip>
            </div>
            <input
              placeholder="Nome da Integração (ex: Painel Comercial)"
              className="w-full rounded-lg border border-border bg-background p-2.5 text-xs text-foreground"
              value={newSub.name}
              onChange={(e) => setNewSub({ ...newSub, name: e.target.value })}
            />
            <input
              placeholder="URL HTTPS de destino (https://...)"
              className="w-full rounded-lg border border-border bg-background p-2.5 text-xs text-foreground"
              value={newSub.url}
              onChange={(e) => setNewSub({ ...newSub, url: e.target.value })}
            />
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
                Eventos suportados
              </p>
              <div className="grid grid-cols-1 gap-1.5 max-h-60 overflow-y-auto pr-1">
                {AVAILABLE_EVENTS.map((ev) => {
                  const selected = newSub.events.includes(ev.value);
                  return (
                    <button
                      key={ev.value}
                      type="button"
                      onClick={() => {
                        const next = selected
                          ? newSub.events.filter((i) => i !== ev.value)
                          : [...newSub.events, ev.value];
                        setNewSub({ ...newSub, events: next });
                      }}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition cursor-pointer ${
                        selected
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      <div className="min-w-0">
                        <span className="font-mono font-bold text-foreground">{ev.value}</span>
                        <span className="ml-2 text-[11px] text-muted-foreground">{ev.label}</span>
                      </div>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold shrink-0">
                        {ev.category}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={handleCreate}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Salvar Webhook
            </button>
          </div>
        </div>
      )}

      {createdSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-6 shadow-soft space-y-4">
            <h3 className="font-extrabold text-amber-500">IMPORTANTE: Chave Secreta HMAC</h3>
            <p className="text-xs text-muted-foreground">
              Copie esta chave agora para validar o header <code>X-Webhook-Signature</code>. Ela não será exibida novamente em texto claro.
            </p>
            <div className="flex items-center gap-2 rounded-lg bg-muted p-2.5 text-xs font-mono break-all">
              <span className="flex-1">{createdSecret}</span>
              <SystemTooltip content="Copiar secret">
                <button
                  type="button"
                  onClick={handleCopySecret}
                  className="p-1.5 rounded-md hover:bg-background transition cursor-pointer shrink-0"
                >
                  {copiedSecret ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </SystemTooltip>
            </div>
            <button
              type="button"
              onClick={() => setCreatedSecret(null)}
              className="w-full rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground cursor-pointer"
            >
              Entendido, copiei
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
