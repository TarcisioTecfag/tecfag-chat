import React, { useState, useEffect } from "react";
import { Plus, Trash2, Key, Globe, Loader2, Copy, Check, X } from "lucide-react";
import { toast } from "sonner";
import { SystemTooltip } from "@/components/ui/tooltip";

interface WebhookSubscription {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  secret?: string; 
}

const AVAILABLE_EVENTS = [
  "deal.created",
  "deal.stage_changed",
  "deal.won",
  "deal.lost",
  "message.received",
  "message.sent",
  "conversation.status_changed",
  "contact.created"
];

export function WebhookSettingsTab({ tenant }: { tenant: string }) {
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newSub, setNewSub] = useState({ name: "", url: "", events: [] as string[] });
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  useEffect(() => {
    loadSubscriptions();
  }, [tenant]);

  const loadSubscriptions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings/webhooks?tenantId=${tenant}`);
      if (res.ok) {
        const data = await res.json();
        setSubscriptions(data);
      }
    } catch (e) {
      toast.error("Erro ao carregar webhooks.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newSub.name || !newSub.url || newSub.events.length === 0) {
      toast.error("Preencha todos os campos.");
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings/webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newSub }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreatedSecret(data.secret);
        setNewSub({ name: "", url: "", events: [] });
        setIsModalOpen(false);
        loadSubscriptions();
        toast.success("Webhook criado com sucesso.");
      } else {
        toast.error(data.error || "Erro ao criar webhook.");
      }
    } catch (e) {
      toast.error("Erro de conexão.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja remover esta integração?")) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings/webhooks/${id}`, { method: "DELETE" });
      if (res.ok) {
        loadSubscriptions();
        toast.success("Webhook removido.");
      }
    } catch (e) {
      toast.error("Erro ao deletar webhook.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-extrabold text-foreground">Webhooks de Saída (Outgoing)</h3>
        <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-extrabold text-primary-foreground">
          <Plus className="h-4 w-4" /> Nova Integração
        </button>
      </div>

      {loading ? <Loader2 className="animate-spin" /> : (
        <div className="grid gap-4">
          {subscriptions.map(sub => (
            <div key={sub.id} className="rounded-2xl border border-border bg-card p-4 flex items-center justify-between">
              <div>
                <h4 className="font-bold text-foreground">{sub.name}</h4>
                <p className="text-xs text-muted-foreground">{sub.url}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {sub.events.map(e => <span key={e} className="rounded-lg bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{e}</span>)}
                </div>
              </div>
              <button onClick={() => handleDelete(sub.id)} className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-6 shadow-soft space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-extrabold">Nova Assinatura de Webhook</h3>
              <button onClick={() => setIsModalOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            <input placeholder="Nome da Integração" className="w-full rounded-lg border p-2 text-xs" value={newSub.name} onChange={e => setNewSub({...newSub, name: e.target.value})} />
            <input placeholder="URL de destino (https://...)" className="w-full rounded-lg border p-2 text-xs" value={newSub.url} onChange={e => setNewSub({...newSub, url: e.target.value})} />
            <div className="grid grid-cols-2 gap-2">
              {AVAILABLE_EVENTS.map(event => (
                <label key={event} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={newSub.events.includes(event)} onChange={e => {
                    const next = e.target.checked ? [...newSub.events, event] : newSub.events.filter(i => i !== event);
                    setNewSub({...newSub, events: next});
                  }} />
                  {event}
                </label>
              ))}
            </div>
            <button onClick={handleCreate} className="w-full rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground">Salvar Webhook</button>
          </div>
        </div>
      )}

      {createdSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border p-6 shadow-soft space-y-4">
            <h3 className="font-extrabold text-amber-500">IMPORTANTE: Chave Secreta</h3>
            <p className="text-xs">Copie esta chave agora, ela não será exibida novamente.</p>
            <div className="flex gap-2 rounded-lg bg-muted p-2 text-xs font-mono break-all">{createdSecret}</div>
            <button onClick={() => setCreatedSecret(null)} className="w-full rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground">Entendido, copiei.</button>
          </div>
        </div>
      )}
    </div>
  );
}
