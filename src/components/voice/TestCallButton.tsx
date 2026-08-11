import React, { useState, useEffect } from "react";
import { PhoneCall, Sparkles, X, Loader2, CheckCircle2, AlertCircle, Key } from "lucide-react";

export function TestCallButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [phone, setPhone] = useState("14998364338");
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Carregar credenciais salvas no localStorage para facilitar
  useEffect(() => {
    const savedSid = localStorage.getItem("twilio_test_sid") || "";
    const savedToken = localStorage.getItem("twilio_test_token") || "";
    if (savedSid) setAccountSid(savedSid);
    if (savedToken) setAuthToken(savedToken);
  }, []);

  const handleCall = async (overridePhone?: string) => {
    const targetPhone = overridePhone || phone;
    setLoading(true);
    setStatusMsg({ type: "info", text: `Iniciando ligação para ${targetPhone}...` });

    try {
      if (accountSid) localStorage.setItem("twilio_test_sid", accountSid);
      if (authToken) localStorage.setItem("twilio_test_token", authToken);

      const res = await fetch("/api/trigger-outbound-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: targetPhone,
          accountSid: accountSid.trim() || undefined,
          authToken: authToken.trim() || undefined,
          fromPhone: "+55143980186",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "CredentialsMissing") {
          setIsOpen(true);
          setStatusMsg({
            type: "error",
            text: "Insira o Account SID e Auth Token do Twilio abaixo para autorizar o disparo da chamada.",
          });
        } else {
          setStatusMsg({
            type: "error",
            text: `Erro Twilio: ${data.message || "Não foi possível completar a chamada."}`,
          });
        }
        return;
      }

      setStatusMsg({
        type: "success",
        text: `✅ LIGAÇÃO DISPARADA! Seu celular (${targetPhone}) vai tocar nos próximos segundos. SID: ${data.callSid}`,
      });
    } catch (err: any) {
      setStatusMsg({
        type: "error",
        text: `Erro de conexão: ${err?.message || String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Botão de disparo rápido no Header */}
      <button
        onClick={() => handleCall("14998364338")}
        disabled={loading}
        className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-md hover:shadow-lg transition-all cursor-pointer disabled:opacity-50"
        title="Disparar ligação de teste imediata para 14998364338"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-white" />
        ) : (
          <PhoneCall className="h-4 w-4 text-white animate-bounce" />
        )}
        <span>TESTE: Valentina ligar para (14) 99836-4338</span>
      </button>

      {/* Modal de Configuração de Credenciais & Status */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-500" />
                Disparar Chamada de Teste (Twilio)
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {statusMsg && (
              <div
                className={`p-3 rounded-2xl text-xs flex items-start gap-2.5 ${
                  statusMsg.type === "success"
                    ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                    : statusMsg.type === "error"
                    ? "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                    : "bg-blue-500/10 text-blue-500 border border-blue-500/20"
                }`}
              >
                {statusMsg.type === "success" && <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />}
                {statusMsg.type === "error" && <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
                {statusMsg.type === "info" && <Loader2 className="h-4 w-4 shrink-0 animate-spin mt-0.5" />}
                <span>{statusMsg.text}</span>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-muted-foreground block mb-1">
                  Número de Destino
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Ex: 14998364338"
                  className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="pt-2 border-t border-border/50">
                <div className="flex items-center gap-1.5 text-xs font-bold text-foreground mb-2">
                  <Key className="h-3.5 w-3.5 text-amber-500" />
                  Credenciais Twilio (Copia do Console Twilio)
                </div>

                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground block mb-0.5">
                      Account SID
                    </label>
                    <input
                      type="text"
                      value={accountSid}
                      onChange={(e) => setAccountSid(e.target.value)}
                      placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full px-3 py-1.5 rounded-lg bg-background border border-border text-xs font-mono text-foreground"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground block mb-0.5">
                      Auth Token
                    </label>
                    <input
                      type="password"
                      value={authToken}
                      onChange={(e) => setAuthToken(e.target.value)}
                      placeholder="• • • • • • • • • • • • • • • •"
                      className="w-full px-3 py-1.5 rounded-lg bg-background border border-border text-xs font-mono text-foreground"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                onClick={() => setIsOpen(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleCall()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                Disparar Ligação Agora! 🚀
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
