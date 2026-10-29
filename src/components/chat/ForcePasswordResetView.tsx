import React, { useState } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff, KeyRound, LogOut, ShieldCheck, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";
import { SystemTooltip } from "@/components/ui/tooltip";

export function ForcePasswordResetView() {
  const {
    tenant,
    operatorProfile,
    completeMandatoryPasswordChange,
    logout,
  } = useChat();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeTenant = tenant === "valem" ? "valem" : "tecfag";

  const themeStyles =
    activeTenant === "tecfag"
      ? ({
          "--primary": "#df3d3d",
          "--primary-soft": "rgba(223, 61, 61, 0.14)",
          "--primary-hover": "#c83232",
        } as React.CSSProperties)
      : ({
          "--primary": "#2dc4a0",
          "--primary-soft": "rgba(45, 196, 160, 0.14)",
          "--primary-hover": "#24a383",
        } as React.CSSProperties);

  const passwordsMatch =
    newPassword.trim().length >= 4 && newPassword.trim() === confirmPassword.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNew = newPassword.trim();
    const cleanConfirm = confirmPassword.trim();

    if (cleanNew.length < 4) {
      toast.error("A nova senha deve ter pelo menos 4 caracteres.");
      return;
    }
    if (cleanNew !== cleanConfirm) {
      toast.error("As senhas informadas não coincidem.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await completeMandatoryPasswordChange(cleanNew);
      if (!res.success && res.error) {
        toast.error(res.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex h-full w-full items-center justify-center bg-background p-4 text-foreground select-none font-sans overflow-y-auto"
      style={themeStyles}
    >
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", damping: 24, stiffness: 240 }}
        className="w-full max-w-[440px] rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-2xl"
      >
        {/* Cabeçalho harmonizado com o sistema */}
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                <ShieldCheck className="h-3 w-3" />
                Segurança da Conta
              </span>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-foreground">
                Redefina sua senha
              </h2>
            </div>
          </div>

          <img
            src={activeTenant === "tecfag" ? "/logo_tecfag.png" : "/logo_valem.jpg"}
            alt={activeTenant === "tecfag" ? "Tecfag" : "Valem"}
            className="h-9 w-auto rounded-lg border border-border bg-card p-1 object-contain"
          />
        </div>

        {/* Identificação do usuário */}
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3">
          {operatorProfile.avatar ? (
            <img
              src={operatorProfile.avatar}
              alt={operatorProfile.name}
              className="h-9 w-9 rounded-full object-cover border border-border shrink-0"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
              {(operatorProfile.name || "U").slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-foreground truncate">
              {operatorProfile.name || "Operador"}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {operatorProfile.email}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed mb-5">
          Uma redefinição de senha foi solicitada para a sua conta. Escolha abaixo a nova senha
          que achar melhor para continuar acessando o sistema.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Nova Senha */}
          <div className="relative rounded-xl border border-border bg-muted/30 px-4 py-2.5 transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mb-0.5">
              Nova Senha
            </label>
            <div className="flex items-center gap-2">
              <input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Digite sua nova senha (mín. 4 caracteres)"
                autoFocus
                required
                disabled={isSubmitting}
                className="block w-full bg-transparent text-sm text-foreground border-0 p-0 focus:outline-none focus:ring-0 placeholder:text-muted-foreground/50"
              />
              <SystemTooltip content={showNewPassword ? "Ocultar senha" : "Mostrar senha"}>
                <button
                  type="button"
                  onClick={() => setShowNewPassword((v) => !v)}
                  className="text-muted-foreground hover:text-foreground transition cursor-pointer p-1"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </SystemTooltip>
            </div>
          </div>

          {/* Confirmar Nova Senha */}
          <div className="relative rounded-xl border border-border bg-muted/30 px-4 py-2.5 transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mb-0.5">
              Confirmar Nova Senha
            </label>
            <div className="flex items-center gap-2">
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a nova senha escolhida"
                required
                disabled={isSubmitting}
                className="block w-full bg-transparent text-sm text-foreground border-0 p-0 focus:outline-none focus:ring-0 placeholder:text-muted-foreground/50"
              />
              <SystemTooltip content={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}>
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="text-muted-foreground hover:text-foreground transition cursor-pointer p-1"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </SystemTooltip>
            </div>
          </div>

          {/* Indicador visual discreto de validação */}
          <div className="flex items-center justify-between text-[11px] px-1">
            <span
              className={
                newPassword.trim().length >= 4
                  ? "text-emerald-500 font-medium inline-flex items-center gap-1"
                  : "text-muted-foreground"
              }
            >
              <CheckCircle2 className="h-3 w-3" />
              Mínimo de 4 caracteres
            </span>
            {confirmPassword.length > 0 && (
              <span
                className={
                  passwordsMatch
                    ? "text-emerald-500 font-medium"
                    : "text-destructive font-medium"
                }
              >
                {passwordsMatch ? "Senhas coincidem" : "Senhas diferentes"}
              </span>
            )}
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <button
              type="submit"
              disabled={isSubmitting || !passwordsMatch}
              className="w-full py-3 px-4 rounded-xl bg-primary hover:opacity-95 disabled:opacity-50 text-primary-foreground text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:cursor-not-allowed"
            >
              <KeyRound className="h-4 w-4" />
              {isSubmitting ? "Salvando nova senha..." : "Salvar Nova Senha e Entrar"}
            </button>

            <button
              type="button"
              onClick={() => logout()}
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 rounded-xl border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sair da conta
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
