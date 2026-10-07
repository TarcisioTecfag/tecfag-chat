import React, { useState, useRef } from "react";
import { useChat } from "@/hooks/useChatState";
import { usePermissions } from "@/hooks/usePermissions";
import {
  X,
  Check,
  Camera,
  Eye,
  EyeOff,
  Plus,
  Shield,
  Sun,
  Moon,
  Monitor,
  User,
  Headphones,
  Briefcase,
  Crown,
  Zap,
  Bot,
  Sparkles,
  LogOut,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

export interface SystemAvatarPreset {
  id: string;
  name: string;
  colorName: string;
  color: string;
  bgColor: string;
  borderColor: string;
  svgPath: string;
  IconComponent: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

export const SYSTEM_AVATAR_PRESETS: SystemAvatarPreset[] = [
  {
    id: "consultor-red",
    name: "Consultor",
    colorName: "Tecfag Red",
    color: "#df3d3d",
    bgColor: "#221215",
    borderColor: "rgba(223, 61, 61, 0.45)",
    svgPath: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    IconComponent: User,
  },
  {
    id: "suporte-emerald",
    name: "Atendimento",
    colorName: "Valem Verde",
    color: "#2dc4a0",
    bgColor: "#0f221e",
    borderColor: "rgba(45, 196, 160, 0.45)",
    svgPath: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    IconComponent: Headphones,
  },
  {
    id: "comercial-blue",
    name: "Comercial",
    colorName: "Tech Blue",
    color: "#38bdf8",
    bgColor: "#0e1b2b",
    borderColor: "rgba(56, 189, 248, 0.45)",
    svgPath: '<rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    IconComponent: Briefcase,
  },
  {
    id: "lider-gold",
    name: "Liderança",
    colorName: "Âmbar Gold",
    color: "#fbbf24",
    bgColor: "#251c0e",
    borderColor: "rgba(251, 191, 36, 0.45)",
    svgPath: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/>',
    IconComponent: Crown,
  },
  {
    id: "gestor-violet",
    name: "Segurança",
    colorName: "Violeta",
    color: "#a78bfa",
    bgColor: "#1a142c",
    borderColor: "rgba(167, 139, 250, 0.45)",
    svgPath: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>',
    IconComponent: Shield,
  },
  {
    id: "agilidade-orange",
    name: "Agilidade",
    colorName: "Laranja Energia",
    color: "#f97316",
    bgColor: "#26160e",
    borderColor: "rgba(249, 115, 22, 0.45)",
    svgPath: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    IconComponent: Zap,
  },
  {
    id: "tech-cyan",
    name: "Tecnologia",
    colorName: "Ciano Neon",
    color: "#22d3ee",
    bgColor: "#0d2127",
    borderColor: "rgba(34, 211, 238, 0.45)",
    svgPath: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    IconComponent: Bot,
  },
  {
    id: "vip-rose",
    name: "Especialista",
    colorName: "Rosa VIP",
    color: "#ec4899",
    bgColor: "#271120",
    borderColor: "rgba(236, 72, 153, 0.45)",
    svgPath: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
    IconComponent: Sparkles,
  },
];

export function generateSvgAvatarDataUri(preset: SystemAvatarPreset): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <radialGradient id="glow-${preset.id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${preset.color}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${preset.bgColor}" stop-opacity="1"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" rx="50" fill="url(#glow-${preset.id})"/>
  <circle cx="50" cy="50" r="47" fill="none" stroke="${preset.borderColor}" stroke-width="2.5"/>
  <g fill="none" stroke="${preset.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" transform="translate(26, 26) scale(2)">
    ${preset.svgPath}
  </g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface ProfileModalFormProps {
  onClose: () => void;
}

export function ProfileModalForm({ onClose }: ProfileModalFormProps) {
  const {
    operatorProfile,
    updateOperatorProfile,
    logout,
    currentGroup,
    setActiveView,
    sessionRole,
  } = useChat();
  const { canAccessView } = usePermissions();
  const { theme, setTheme } = useTheme();

  // Local Form States
  const [name, setName] = useState(operatorProfile.name);
  const [email, setEmail] = useState(operatorProfile.email);
  const [password, setPassword] = useState("********");
  const [avatar, setAvatar] = useState(operatorProfile.avatar);
  const [status, setStatus] = useState(operatorProfile.status);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            const size = 120;
            canvas.width = size;
            canvas.height = size;

            if (ctx) {
              const minSize = Math.min(img.width, img.height);
              const sx = (img.width - minSize) / 2;
              const sy = (img.height - minSize) / 2;

              ctx.drawImage(img, sx, sy, minSize, minSize, 0, 0, size, size);
              const compressedBase64 = canvas.toDataURL("image/jpeg", 0.75);
              setAvatar(compressedBase64);
            }
          };
          img.src = reader.result;
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      await updateOperatorProfile({
        name,
        email,
        avatar,
        status,
      });
      toast.success("Perfil atualizado com sucesso!");
      onClose();
    } catch {
      toast.error("Erro ao salvar alterações de perfil.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full select-none">
      {/* Hidden input for local upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />

      {/* Header */}
      <header className="flex items-center justify-between border-b border-border/70 px-4 py-3 bg-muted/20 shrink-0">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
            Configurações de Perfil
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Scrollable Form Body */}
      <form onSubmit={handleSave} className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4 max-h-[calc(85vh-115px)]">
        {/* Profile Card & Operational Status */}
        <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3">
          <div className="flex items-center gap-3">
            {/* Main Avatar Display */}
            <div
              onClick={handleAvatarClick}
              className="relative group cursor-pointer shrink-0"
              title="Clique para trocar imagem do computador"
            >
              <img
                src={avatar}
                alt="Avatar Preview"
                className="h-14 w-14 rounded-full object-cover border-2 border-primary/40 shadow-soft"
              />
              <span
                className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card ${
                  status === "disponivel"
                    ? "bg-primary"
                    : status === "pausa"
                    ? "bg-amber-500"
                    : "bg-gray-400"
                }`}
              />
              <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="h-4 w-4 text-white" />
              </div>
            </div>

            {/* Operator Details */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-foreground truncate">{name || "Operador"}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 shrink-0">
                  {sessionRole === "admin" ? "Admin" : "Atendente"}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground truncate">{email}</div>
            </div>
          </div>

          {/* Quick Status Select */}
          <div className="space-y-1.5 pt-1">
            <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
              Status Operacional
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setStatus("disponivel")}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                  status === "disponivel"
                    ? "bg-primary border-primary text-primary-foreground shadow-xs"
                    : "bg-card border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    status === "disponivel" ? "bg-white" : "bg-primary"
                  }`}
                />
                Disponível
              </button>
              <button
                type="button"
                onClick={() => setStatus("pausa")}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                  status === "pausa"
                    ? "bg-amber-500 border-amber-500 text-white shadow-xs"
                    : "bg-card border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${status === "pausa" ? "bg-white" : "bg-amber-500"}`}
                />
                Em Pausa
              </button>
              <button
                type="button"
                onClick={() => setStatus("desconectado")}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                  status === "desconectado"
                    ? "bg-gray-500 border-gray-500 text-white shadow-xs"
                    : "bg-card border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    status === "desconectado" ? "bg-white" : "bg-gray-400"
                  }`}
                />
                Desconectado
              </button>
            </div>
          </div>
        </div>

        {/* Escolher Ícone na Paleta do Sistema */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider">
              Ícone de Perfil
            </label>
            <span className="text-[10px] text-muted-foreground/80 font-medium">Paleta do sistema</span>
          </div>

          <div className="grid grid-cols-5 gap-2 pt-0.5">
            {SYSTEM_AVATAR_PRESETS.map((preset) => {
              const uri = generateSvgAvatarDataUri(preset);
              const isSelected =
                avatar === uri ||
                (typeof avatar === "string" && avatar.includes(`glow-${preset.id}`));
              const Icon = preset.IconComponent;

              return (
                <TooltipProvider key={preset.id} delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setAvatar(uri)}
                        className={`relative h-11 w-11 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                          isSelected
                            ? "ring-2 ring-primary ring-offset-2 ring-offset-card scale-105"
                            : "hover:scale-105 opacity-85 hover:opacity-100"
                        }`}
                        style={{
                          backgroundColor: preset.bgColor,
                          border: `1.5px solid ${preset.borderColor}`,
                          boxShadow: isSelected ? `0 0 10px ${preset.borderColor}` : undefined,
                        }}
                      >
                        <Icon className="h-5 w-5" style={{ color: preset.color }} />
                        {isSelected && (
                          <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xs">
                            <Check className="h-2.5 w-2.5 stroke-[3]" />
                          </span>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px] font-medium">
                      {preset.name} · {preset.colorName}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })}

            {/* Custom image upload button */}
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleAvatarClick}
                    className="h-11 w-11 rounded-xl border-2 border-dashed border-border/80 bg-muted/30 hover:bg-muted hover:border-primary/50 text-muted-foreground hover:text-foreground flex flex-col items-center justify-center transition-all cursor-pointer group"
                  >
                    <Plus className="h-4 w-4 group-hover:scale-110 transition-transform" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[11px] font-medium">
                  Subir foto do PC
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* User Fields */}
        <div className="space-y-2.5">
          {/* Nome de usuário */}
          <div className="space-y-1">
            <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider">
              Nome de Usuário
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8.5 w-full rounded-lg bg-muted/60 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border/50"
            />
          </div>

          {/* Email do usuário */}
          <div className="space-y-1">
            <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider">
              E-mail do Usuário
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-8.5 w-full rounded-lg bg-muted/60 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border/50"
            />
          </div>

          {/* Senha do usuário */}
          <div className="space-y-1">
            <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider">
              Senha do Usuário
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-8.5 w-full rounded-lg bg-muted/60 px-3 pr-9 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* Tema do Sistema / Aparência */}
          <div className="space-y-1">
            <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
              Tema / Aparência
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                  theme === "light"
                    ? "bg-primary border-primary text-primary-foreground shadow-xs"
                    : "bg-muted/40 border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Sun className="h-3.5 w-3.5" />
                <span>Claro</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                  theme === "dark"
                    ? "bg-primary border-primary text-primary-foreground shadow-xs"
                    : "bg-muted/40 border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Moon className="h-3.5 w-3.5" />
                <span>Escuro</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme("system")}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                  theme === "system"
                    ? "bg-primary border-primary text-primary-foreground shadow-xs"
                    : "bg-muted/40 border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Monitor className="h-3.5 w-3.5" />
                <span>Auto</span>
              </button>
            </div>
          </div>

          {/* Grupo de Acesso & Permissões */}
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Shield className="h-3.5 w-3.5" />
              </div>
              <div>
                <div className="text-[9px] font-extrabold uppercase text-muted-foreground tracking-wider">
                  Grupo de Acesso
                </div>
                <div className="text-xs font-bold text-foreground">
                  {currentGroup?.name || "Administradores"}
                </div>
              </div>
            </div>
            {canAccessView("groups") && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  setActiveView("groups");
                }}
                className="text-[11px] font-bold text-primary hover:underline cursor-pointer px-2 py-0.5 rounded-md hover:bg-primary/10 transition"
              >
                Gerenciar →
              </button>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-border/70 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={() => {
              logout();
              onClose();
            }}
            className="flex items-center gap-1 text-xs font-bold text-red-500 hover:text-red-600 transition-colors cursor-pointer hover:underline"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Fazer Logout</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="h-8.5 rounded-lg bg-primary px-3.5 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition cursor-pointer shadow-xs"
            >
              {isSubmitting ? "Salvando..." : "Salvar Alterações"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/**
 * ProfilePopover: Mini Pop-up ancorado ao elemento disparador (avatar do operador).
 * Fecha automaticamente ao clicar fora ou pressionar ESC.
 */
export function ProfilePopover({
  children,
  side = "right",
  align = "end",
  sideOffset = 12,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  children: React.ReactNode;
  side?: "right" | "bottom" | "top" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={16}
        className="w-[370px] max-w-[calc(100vw-32px)] p-0 rounded-2xl bg-card/95 backdrop-blur-xl border border-border shadow-2xl z-[200] overflow-hidden flex flex-col text-foreground select-none"
      >
        <ProfileModalForm onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * ProfileModal legado: mantido para retrocompatibilidade caso acionado globalmente via isProfileModalOpen.
 * Renderiza o mesmo mini pop-up compacto com fechamento automático ao clicar fora.
 */
export function ProfileModal() {
  const { isProfileModalOpen, setIsProfileModalOpen } = useChat();

  if (!isProfileModalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs select-none"
      onClick={() => setIsProfileModalOpen(false)}
    >
      <div
        className="w-[370px] max-w-[calc(100vw-32px)] rounded-2xl bg-card/95 backdrop-blur-xl border border-border shadow-2xl overflow-hidden flex flex-col text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <ProfileModalForm onClose={() => setIsProfileModalOpen(false)} />
      </div>
    </div>
  );
}
