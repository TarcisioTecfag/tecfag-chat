import React, { useState } from "react";
import {
  CheckCircle2,
  PowerOff,
  QrCode,
  RefreshCw,
  Smartphone,
  X,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useOptionalOnboarding } from "@/hooks/useOnboarding";
import { useOnboardingAdapter } from "@/hooks/useOnboardingAdapter";
import { WhatsappConnectionsPanel } from "./WhatsappConnectionsPanel";

interface PersonalWhatsappConnectionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PersonalWhatsappConnectionsDialog({
  open,
  onOpenChange,
}: PersonalWhatsappConnectionsDialogProps) {
  const onboarding = useOptionalOnboarding();
  const [simulatedQrReady, setSimulatedQrReady] = useState(true);

  useOnboardingAdapter("personalWhatsappModal", (cmd) => {
    if (cmd.command === "openPersonalWhatsappModal") {
      onOpenChange(true);
    } else if (cmd.command === "simulatePersonalWhatsappPair") {
      setSimulatedQrReady(true);
    }
  });

  if (!open) return null;

  const isDemo = Boolean(onboarding?.isDemoMode);
  const demoStatus = onboarding?.demoState.personalWhatsappStatus ?? "connected";
  const demoPhone =
    onboarding?.demoState.personalWhatsappPhone ?? "+55 11 98888-0199";

  return (
    <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
      <div
        data-tour="whatsapp.personal-modal"
        className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-500">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">
                Meu WhatsApp (Conexão Individual)
              </h2>
              <p className="text-xs text-muted-foreground">
                Consulte o status do seu número comercial e realize o pareamento por QR Code.
              </p>
            </div>
          </div>

          <SystemTooltip content="Fechar janela">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-xl border border-border bg-muted/60 p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </SystemTooltip>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isDemo ? (
            <div className="space-y-4">
              <div
                data-tour="whatsapp.personal-status"
                className="flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4"
              >
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  <div>
                    <div className="text-sm font-bold">
                      Conexão Individual (Demonstração):{" "}
                      {demoStatus === "connected"
                        ? "Conectada"
                        : demoStatus === "qr_ready"
                          ? "Aguardando leitura de QR"
                          : "Desconectada"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Número vinculado: {demoPhone}
                    </div>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-500">
                  Simulação Segura
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-tour="whatsapp.personal-connect"
                  onClick={() => setSimulatedQrReady(true)}
                  className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Conectar / Parear (Simulado)</span>
                </button>

                <button
                  type="button"
                  data-tour="whatsapp.personal-disconnect"
                  onClick={() => setSimulatedQrReady(false)}
                  className="flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-bold text-rose-500"
                >
                  <PowerOff className="h-3.5 w-3.5" />
                  <span>Desconectar (Simulado)</span>
                </button>
              </div>

              {simulatedQrReady && (
                <div
                  data-tour="whatsapp.personal-qr"
                  className="flex items-center gap-4 rounded-2xl border border-border bg-muted/30 p-4"
                >
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-border bg-white p-2 text-slate-900">
                    <QrCode className="h-16 w-16" />
                  </div>
                  <div className="space-y-1 text-xs">
                    <p className="font-bold">
                      QR Code Demonstrativo de Pareamento
                    </p>
                    <p className="text-muted-foreground">
                      No uso real, abra o WhatsApp no seu celular em Aparelhos Conectados → Conectar um aparelho e aponte a câmera para o QR Code gerado aqui.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <WhatsappConnectionsPanel compact />
          )}
        </div>
      </div>
    </div>
  );
}
