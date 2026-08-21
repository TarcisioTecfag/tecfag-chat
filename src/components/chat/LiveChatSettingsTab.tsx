// ══════════════════════════════════════════════════════════════════════════════
// ⚙️ LIVE CHAT SETTINGS TAB — Aba "Live Chat" no SettingsView
// Credenciais Tray, comportamento do widget e script de instalação
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect } from "react";
import { Globe, CheckCircle2, AlertCircle, Copy, Check, Loader2, ExternalLink, Save, Settings } from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { toast } from "sonner";

interface TrayConfig {
  apiAddress: string;
  consumerKey: string;
  consumerSecret: string;
  proactiveMessage: string;
  proactiveDelaySec: number;
  sessionTtlHours: number;
  attackQualifyScore: number;
  accessTokenExpiresAt?: string;
}

export function LiveChatSettingsTab() {
  const { tenant } = useChat();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState<TrayConfig>({
    apiAddress: "https://valemvalvulaseembalagens.corpsuite.com.br/web_api",
    consumerKey: "",
    consumerSecret: "",
    proactiveMessage: "Olá! Posso te ajudar com informações sobre nossos produtos?",
    proactiveDelaySec: 60,
    sessionTtlHours: 4,
    attackQualifyScore: 70,
  });

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${BACKEND_URL}/api/livechat/tray-config?tenantId=${tenant}`);
        if (res.ok) {
          const data = await res.json();
          setConfigured(data.configured);
          if (data.config) {
            setForm((prev) => ({ ...prev, ...data.config }));
          }
        }
      } catch (e) {
        console.error("Erro ao carregar config Tray:", e);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [tenant]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/livechat/tray-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant, ...form }),
      });
      if (res.ok) {
        toast.success("Configurações salvas com sucesso!");
        setConfigured(!!form.consumerKey);
      } else {
        toast.error("Erro ao salvar configurações.");
      }
    } catch {
      toast.error("Erro de comunicação com o servidor.");
    } finally {
      setIsSaving(false);
    }
  };

  const widgetScript = `<!-- Valem Chat Widget -->
<link rel="stylesheet" href="${BACKEND_URL}/valem-chat.css">
<script src="${BACKEND_URL}/valem-chat.iife.js"
  data-tenant="${tenant}"
  data-ws="${BACKEND_URL?.replace("https://", "wss://")?.replace("http://", "ws://")}/ws/livechat"
  defer>
</script>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(widgetScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Código copiado!");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5 overflow-y-auto max-h-full pb-4">
      {/* ── Card: Tray Commerce ────────────────────────────────────────── */}
      <div className="rounded-2xl bg-card border border-border p-6 shadow-soft">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">Tray Commerce</h3>
              <p className="text-xs text-muted-foreground">Integração com a loja para busca de produtos no chat</p>
            </div>
          </div>
          {configured === null ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Verificando...
            </span>
          ) : configured ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Conectado
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-600">
              <AlertCircle className="h-3.5 w-3.5" /> Não configurado
            </span>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">API Address</label>
            <input
              type="text"
              value={form.apiAddress}
              onChange={(e) => setForm((p) => ({ ...p, apiAddress: e.target.value }))}
              placeholder="https://sujaloja.corpsuite.com.br/web_api"
              className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Consumer Key</label>
              <input
                type="text"
                value={form.consumerKey}
                onChange={(e) => setForm((p) => ({ ...p, consumerKey: e.target.value }))}
                placeholder="Chave da Tray"
                className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Consumer Secret</label>
              <input
                type="password"
                value={form.consumerSecret}
                onChange={(e) => setForm((p) => ({ ...p, consumerSecret: e.target.value }))}
                placeholder="••••••••"
                className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
            Para obter as credenciais: abra um chamado no suporte Tray → "INTEGRAÇÕES API" solicitando um aplicativo pontual.
          </p>

          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-extrabold hover:bg-primary/90 transition cursor-pointer shadow-soft disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Salvar e Conectar
          </button>
        </form>
      </div>

      {/* ── Card: Comportamento do Widget ─────────────────────────────── */}
      <div className="rounded-2xl bg-card border border-border p-6 shadow-soft">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Comportamento do Chat</h3>
            <p className="text-xs text-muted-foreground">Configure quando e como a Valentina aborda os visitantes</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">Mensagem proativa</label>
            <textarea
              value={form.proactiveMessage}
              onChange={(e) => setForm((p) => ({ ...p, proactiveMessage: e.target.value }))}
              rows={2}
              className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Timer proativo (s)</label>
              <input
                type="number"
                value={form.proactiveDelaySec}
                onChange={(e) => setForm((p) => ({ ...p, proactiveDelaySec: Number(e.target.value) }))}
                className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">TTL sessão (h)</label>
              <input
                type="number"
                value={form.sessionTtlHours}
                onChange={(e) => setForm((p) => ({ ...p, sessionTtlHours: Number(e.target.value) }))}
                className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Score atacado (0–100)</label>
              <input
                type="number"
                value={form.attackQualifyScore}
                onChange={(e) => setForm((p) => ({ ...p, attackQualifyScore: Number(e.target.value) }))}
                min={0} max={100}
                className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Mínimo para bridge WA</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Card: Script de instalação ────────────────────────────────── */}
      <div className="rounded-2xl bg-card border border-border p-6 shadow-soft">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Script de Instalação</h3>
            <p className="text-xs text-muted-foreground">Cole este código no {"<head>"} de todas as páginas da loja Tray</p>
          </div>
        </div>

        <div className="relative">
          <pre className="bg-muted/50 rounded-xl p-4 text-[11px] font-mono text-foreground overflow-x-auto border border-border whitespace-pre-wrap">
            {widgetScript}
          </pre>
          <button
            onClick={handleCopy}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-border text-[11px] font-semibold hover:bg-muted transition cursor-pointer"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copiado!" : "Copiar"}
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <a
            href="/test-chat.html"
            target="_blank"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-extrabold bg-muted text-foreground border border-border hover:bg-muted/80 transition cursor-pointer"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir página de teste
          </a>
          <p className="text-[11px] text-muted-foreground">Simula o widget sem precisar publicar na Tray</p>
        </div>
      </div>
    </div>
  );
}