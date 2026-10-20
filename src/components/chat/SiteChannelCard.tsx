// Cartão de habilitação do canal Site no núcleo de triagem industrial (somente perfil industrial).
import React, { useEffect, useState } from "react";
import { Globe, Loader2, Save, ShieldCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface SiteChannelState {
  sdrConfigured: boolean;
  sdrEnabled: boolean;
  siteChannelEnabled: boolean;
  siteAllowedOrigins: string[];
}

export function SiteChannelCard({ personaName, backendUrl }: { personaName: string; backendUrl: string }) {
  const [state, setState] = useState<SiteChannelState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [originsText, setOriginsText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${backendUrl}/api/valentina/site-channel`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data?.error || "Não foi possível carregar o canal do site.");
          return;
        }
        setState(data);
        setEnabled(Boolean(data.siteChannelEnabled));
        setOriginsText((data.siteAllowedOrigins || []).join("\n"));
      } catch {
        if (!cancelled) setLoadError("Erro de comunicação com o servidor.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendUrl]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const siteAllowedOrigins = originsText
        .split(/[\n,]/)
        .map((o) => o.trim())
        .filter(Boolean);
      const res = await fetch(`${backendUrl}/api/valentina/site-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteChannelEnabled: enabled, siteAllowedOrigins }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || "Não foi possível salvar.");
        return;
      }
      setState((prev) => (prev ? { ...prev, ...data } : prev));
      setOriginsText((data.siteAllowedOrigins || []).join("\n"));
      toast.success(enabled ? `Canal do site ativado para o ${personaName}.` : "Canal do site desativado.");
    } catch {
      toast.error("Erro de comunicação com o servidor.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-2xl bg-card border border-border p-6 shadow-soft">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Globe className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-foreground">Atendimento do {personaName} no site</h3>
          <p className="text-xs text-muted-foreground">
            O chat do site usa a mesma triagem, card e rodízio do WhatsApp. Respostas humanas pelo módulo de Conversas.
          </p>
        </div>
      </div>

      {loadError ? (
        <p className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4" /> {loadError}
        </p>
      ) : !state ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
        </div>
      ) : (
        <div className="space-y-4">
          {!state.sdrEnabled && (
            <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              O SDR do {personaName} está desativado. Mesmo com o canal ligado, o widget recusará conexões até o SDR ser habilitado.
            </p>
          )}
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
            <span className="text-sm font-semibold text-foreground">Aceitar conversas do widget do site</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
              disabled={!state.sdrConfigured}
            />
          </label>
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Origens autorizadas (uma por linha; vazio = qualquer site)
            </label>
            <textarea
              value={originsText}
              onChange={(e) => setOriginsText(e.target.value)}
              rows={3}
              placeholder="https://www.seusite.com.br"
              className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" /> Recomendado durante a homologação: informe apenas o domínio de teste.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !state.sdrConfigured}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar canal do site
          </button>
        </div>
      )}
    </div>
  );
}
