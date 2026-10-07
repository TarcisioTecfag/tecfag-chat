import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  HelpCircle,
  Clock,
  MessageSquare,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  Check,
  Coffee,
  PowerOff,
  UserCheck,
  Sparkles,
} from "lucide-react";

interface StatusWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function StatusWizardModal({ isOpen, onClose }: StatusWizardModalProps) {
  const [currentStep, setCurrentStep] = useState(0);

  if (!isOpen) return null;

  const steps = [
    {
      id: "status-overview",
      badge: "Passo 1 de 3",
      title: "Seus Status de Atendimento",
      subtitle: "Mantenha sua equipe e clientes cientes da sua disponibilidade.",
    },
    {
      id: "auto-reply",
      badge: "Passo 2 de 3",
      title: "Resposta Automática de Ausência",
      subtitle: "Nunca deixe um cliente no vácuo enquanto estiver afastado.",
    },
    {
      id: "anti-spam-rules",
      badge: "Passo 3 de 3",
      title: "Blindagem Anti-Spam & Retorno",
      subtitle: "Tranquilidade garantida: comunicação limpa e retomada imediata.",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      {/* Backdrop click */}
      <div className="fixed inset-0" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="relative z-10 w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border/80 px-6 py-4 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <HelpCircle className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Como funciona o Status & Auto-Resposta</h3>
              <p className="text-[11px] text-muted-foreground">{steps[currentStep].badge}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Stepper Indicator */}
        <div className="px-6 pt-4 pb-1">
          <div className="grid grid-cols-3 gap-2">
            {steps.map((st, idx) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setCurrentStep(idx)}
                className={`group flex flex-col gap-1 text-left cursor-pointer transition`}
              >
                <div
                  className={`h-1.5 w-full rounded-full transition-all duration-300 ${
                    idx === currentStep
                      ? "bg-primary"
                      : idx < currentStep
                      ? "bg-primary/40"
                      : "bg-muted"
                  }`}
                />
                <span
                  className={`text-[10px] font-semibold truncate transition-colors ${
                    idx === currentStep ? "text-primary font-bold" : "text-muted-foreground/80 group-hover:text-foreground"
                  }`}
                >
                  {idx + 1}. {idx === 0 ? "Status" : idx === 1 ? "Auto-resposta" : "Blindagem"}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Step Content */}
        <div className="p-6 pt-4 min-h-[310px] flex flex-col justify-between">
          <AnimatePresence mode="wait">
            {currentStep === 0 && (
              <motion.div
                key="step-0"
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                transition={{ duration: 0.2 }}
                className="space-y-3.5"
              >
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-foreground">{steps[0].title}</h4>
                  <p className="text-xs text-muted-foreground">{steps[0].subtitle}</p>
                </div>

                <div className="space-y-2 pt-1">
                  {/* Disponível */}
                  <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                    <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                      <UserCheck className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        <span className="font-bold text-foreground">Disponível</span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.2 text-[9px] font-bold text-primary">
                          Ativo
                        </span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">
                        Você está pronto para atender. Notificações sonoras, toasts e mensagens chegam instantaneamente.
                      </p>
                    </div>
                  </div>

                  {/* Em Pausa */}
                  <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                    <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      <Coffee className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        <span className="font-bold text-foreground">Em Pausa</span>
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.2 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                          Auto-resposta ativa
                        </span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">
                        Pausa para almoço, descanso ou reunião. O sistema sabe que você está ausente e avisa seus clientes.
                      </p>
                    </div>
                  </div>

                  {/* Desconectado */}
                  <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3">
                    <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <PowerOff className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-gray-400" />
                        <span className="font-bold text-foreground">Desconectado</span>
                        <span className="rounded-full bg-muted px-2 py-0.2 text-[9px] font-bold text-muted-foreground">
                          Auto-resposta ativa
                        </span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">
                        Expediente encerrado ou fora do sistema. A auto-resposta também atende o cliente informando a pausa.
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {currentStep === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                transition={{ duration: 0.2 }}
                className="space-y-3.5"
              >
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-foreground">{steps[1].title}</h4>
                  <p className="text-xs text-muted-foreground">
                    Quando você estiver em <strong className="text-amber-600 dark:text-amber-400">Em Pausa</strong> ou <strong className="text-foreground">Desconectado</strong>, o sistema responde automaticamente ao cliente no WhatsApp:
                  </p>
                </div>

                {/* WhatsApp Chat Simulation Card */}
                <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5 space-y-2.5 shadow-inner">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground border-b border-border/50 pb-1.5 font-medium">
                    <span className="flex items-center gap-1.5 text-foreground font-bold">
                      <MessageSquare className="h-3 w-3 text-emerald-500" />
                      Simulação no WhatsApp
                    </span>
                    <span>Hoje · 12:35</span>
                  </div>

                  {/* Balão do Cliente */}
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-xs text-foreground shadow-sm space-y-0.5">
                      <p className="text-[10px] font-bold text-primary">Cliente</p>
                      <p className="text-xs leading-relaxed">Olá, boa tarde! Gostaria de uma informação sobre o pedido.</p>
                      <div className="text-[9px] text-muted-foreground text-right">12:35</div>
                    </div>
                  </div>

                  {/* Balão da Auto-Resposta do Sistema */}
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary/10 border border-primary/20 px-3 py-2 text-xs text-foreground shadow-sm space-y-0.5">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-primary">
                        <Sparkles className="h-3 w-3" />
                        <span>Você (Auto-resposta do Sistema)</span>
                      </div>
                      <p className="text-xs font-semibold text-foreground leading-relaxed">
                        Olá, estou em minha pausa, logo te retorno
                      </p>
                      <div className="text-[9px] text-primary/80 font-mono text-right flex items-center justify-end gap-1">
                        <span>12:35</span>
                        <Check className="h-2.5 w-2.5 text-primary stroke-[3]" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl bg-card border border-border/60 p-3 text-[11px] text-muted-foreground flex items-center gap-2.5">
                  <Clock className="h-4 w-4 shrink-0 text-amber-500" />
                  <span>
                    O cliente fica tranquilo sabendo que sua mensagem foi recebida e que terá retorno em breve.
                  </span>
                </div>
              </motion.div>
            )}

            {currentStep === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                transition={{ duration: 0.2 }}
                className="space-y-3.5"
              >
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-foreground">{steps[2].title}</h4>
                  <p className="text-xs text-muted-foreground">{steps[2].subtitle}</p>
                </div>

                <div className="space-y-2.5 pt-1">
                  {/* Regra Anti-Spam */}
                  <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm">
                    <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5 text-xs">
                      <span className="font-bold text-foreground">Proteção Inteligente Anti-Spam</span>
                      <p className="text-muted-foreground leading-relaxed">
                        Se o cliente enviar várias mensagens em sequência, o sistema <strong>não repete</strong> a resposta. Há um intervalo de segurança de 20 minutos por conversa.
                      </p>
                    </div>
                  </div>

                  {/* Retorno e Continuidade */}
                  <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm">
                    <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Check className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5 text-xs">
                      <span className="font-bold text-foreground">Retorno Instantâneo ao Cockpit</span>
                      <p className="text-muted-foreground leading-relaxed">
                        Assim que você mudar seu status de volta para <strong>Disponível</strong>, a auto-resposta cessa imediatamente e você pode prosseguir o atendimento com o cliente normalmente na sua aba <em>Meus</em>.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-center">
                  <p className="text-xs font-semibold text-primary">
                    Tudo pronto! Você já pode usar seus status com total tranquilidade.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer Controls */}
          <div className="flex items-center justify-between border-t border-border/80 pt-4 mt-4">
            {currentStep > 0 ? (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
                className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Voltar</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                Fechar
              </button>
            )}

            {currentStep < steps.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => Math.min(steps.length - 1, prev + 1))}
                className="flex items-center gap-1 rounded-xl bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition shadow-soft cursor-pointer"
              >
                <span>Próximo</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition shadow-soft cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Entendi, tudo pronto!</span>
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
