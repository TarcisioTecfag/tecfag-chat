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
  Laptop,
  Palette,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useDensity } from "@/hooks/useDensity";
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
  const { density, setDensity } = useDensity();

  // Local Form States
  const [activeTab, setActiveTab] = useState<"perfil" | "aparencia">("perfil");
  const [showAvatarPicker, setShowAvatarPicker] = useState<boolean>(false);
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
    <div className="flex flex-col h-full w-full select-none text-foreground">
      {/* Hidden input for local upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />

      {/* Header com Segmented Control de Abas & Fechar */}
      <header className="flex items-center justify-between border-b border-border/60 px-3.5 py-2.5 bg-muted/20 shrink-0">
        <div className="flex items-center p-0.5 rounded-lg bg-muted/60 border border-border/50 text-xs">
          <button
            type="button"
            onClick={() => {
              setActiveTab("perfil");
              setShowAvatarPicker(false);
            }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
              activeTab === "perfil"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <User className="h-3.5 w-3.5" />
            <span>Perfil</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("aparencia");
              setShowAvatarPicker(false);
            }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
              activeTab === "aparencia"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Palette className="h-3.5 w-3.5" />
            <span>Aparência</span>
          </button>
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

      {/* Form Body */}
      <form onSubmit={handleSave} className="flex-1 flex flex-col justify-between p-3.5 space-y-3">
        {activeTab === "perfil" ? (
          <div className="space-y-3">
            {/* Profile Card & Operational Status */}
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-2.5">
              <div className="flex items-center gap-3">
                {/* Main Avatar Display */}
                <div
                  onClick={() => setShowAvatarPicker((prev) => !prev)}
                  className="relative group cursor-pointer shrink-0"
                  title="Clique para alterar foto ou ícone"
                >
                  <img
                    src={avatar}
                    alt="Avatar Preview"
                    className="h-12 w-12 rounded-full object-cover border-2 border-border/80 group-hover:border-primary/60 transition shadow-xs"
                  />
                  <span
                    className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card ${
                      status === "disponivel"
                        ? "bg-emerald-500"
                        : status === "pausa"
                        ? "bg-amber-500"
                        : "bg-zinc-400"
                    }`}
                  />
                  <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera className="h-3.5 w-3.5 text-white" />
                  </div>
                </div>

                {/* Operator Details */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-foreground truncate">{name || "Operador"}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-primary/10 text-primary border border-primary/20 shrink-0">
                      {sessionRole === "admin" ? "Admin" : "Atendente"}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">{email}</div>
                  <button
                    type="button"
                    onClick={() => setShowAvatarPicker((prev) => !prev)}
                    className="text-[10px] font-medium text-primary hover:underline cursor-pointer flex items-center gap-1 mt-0.5"
                  >
                    {showAvatarPicker ? "Fechar galeria" : "Alterar foto / ícone"}
                  </button>
                </div>
              </div>

              {/* Progressive Avatar Picker */}
              {showAvatarPicker && (
                <div className="pt-2 border-t border-border/50 space-y-2 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
                    <span>Ícones do Sistema</span>
                    <button
                      type="button"
                      onClick={handleAvatarClick}
                      className="text-primary hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Subir do PC</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-5 gap-1.5">
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
                                onClick={() => {
                                  setAvatar(uri);
                                  setShowAvatarPicker(false);
                                }}
                                className={`relative h-9 w-9 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                                  isSelected
                                    ? "ring-2 ring-primary ring-offset-1 ring-offset-card scale-105"
                                    : "hover:scale-105 opacity-85 hover:opacity-100"
                                }`}
                                style={{
                                  backgroundColor: preset.bgColor,
                                  border: `1.5px solid ${preset.borderColor}`,
                                }}
                              >
                                <Icon className="h-4 w-4" style={{ color: preset.color }} />
                                {isSelected && (
                                  <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                                    <Check className="h-2 w-2 stroke-[3]" />
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

                    <button
                      type="button"
                      onClick={handleAvatarClick}
                      className="h-9 w-9 rounded-lg border border-dashed border-border/80 bg-muted/30 hover:bg-muted hover:border-primary/50 text-muted-foreground hover:text-foreground flex items-center justify-center transition cursor-pointer"
                      title="Subir foto do PC"
                    >
                      <Camera className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Status Operacional Minimalista */}
              <div className="pt-1.5 border-t border-border/40 space-y-1">
                <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider block">
                  Status Operacional
                </label>
                <div className="grid grid-cols-3 gap-1 bg-muted/40 p-1 rounded-lg border border-border/40">
                  <button
                    type="button"
                    onClick={() => setStatus("disponivel")}
                    className={`flex h-7 items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                      status === "disponivel"
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-xs"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Disponível
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus("pausa")}
                    className={`flex h-7 items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                      status === "pausa"
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shadow-xs"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    Pausa
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus("desconectado")}
                    className={`flex h-7 items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                      status === "desconectado"
                        ? "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border border-zinc-500/30 shadow-xs"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-zinc-400" />
                    Offline
                  </button>
                </div>
              </div>
            </div>

            {/* Inputs de Edição */}
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">
                  Nome de Usuário
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 w-full rounded-lg bg-muted/40 px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border/50"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">
                  E-mail de Acesso
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-8 w-full rounded-lg bg-muted/40 px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border/50"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">
                  Senha
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-8 w-full rounded-lg bg-muted/40 px-2.5 pr-8 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Grupo de Acesso */}
              <div className="rounded-lg border border-border/50 bg-muted/20 px-2.5 py-1.5 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Shield className="h-3.5 w-3.5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[9px] uppercase font-bold text-muted-foreground">Grupo de Acesso</div>
                    <div className="text-xs font-semibold text-foreground truncate">
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
                    className="text-[11px] font-medium text-primary hover:underline cursor-pointer shrink-0"
                  >
                    Gerenciar →
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3.5 py-1">
            {/* Tema / Aparência */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">
                  Tema / Aparência
                </label>
                <span className="text-[10px] text-muted-foreground capitalize">
                  {theme === "light" ? "Modo Claro" : theme === "dark" ? "Modo Escuro" : "Automático"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 bg-muted/40 p-1 rounded-xl border border-border/40">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                    theme === "light"
                      ? "bg-background text-foreground shadow-xs border border-border/50 font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
                  }`}
                >
                  <Sun className="h-3.5 w-3.5" />
                  <span>Claro</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                    theme === "dark"
                      ? "bg-background text-foreground shadow-xs border border-border/50 font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
                  }`}
                >
                  <Moon className="h-3.5 w-3.5" />
                  <span>Escuro</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("system")}
                  className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                    theme === "system"
                      ? "bg-background text-foreground shadow-xs border border-border/50 font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
                  }`}
                >
                  <Monitor className="h-3.5 w-3.5" />
                  <span>Auto</span>
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Sincroniza automaticamente com o seu sistema operacional ou fixa o contraste preferido.
              </p>
            </div>

            {/* Densidade da Tela */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">
                  Densidade da Tela
                </label>
                <span className="text-[10px] font-mono text-muted-foreground font-semibold">
                  {density === "auto" ? "Notebook 75% Auto" : `${density}%`}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1 bg-muted/40 p-1 rounded-xl border border-border/40">
                <button
                  type="button"
                  onClick={() => setDensity("auto")}
                  title="Detecta telas de notebook automaticamente (75%) e monitores (100%)"
                  className={`flex h-7 items-center justify-center gap-1 rounded-lg text-[11px] transition cursor-pointer ${
                    density === "auto"
                      ? "bg-background text-foreground shadow-xs border border-border/50 font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
                  }`}
                >
                  <Laptop className="h-3 w-3" />
                  <span>Auto</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDensity("75")}
                  title="Proporção compacta 75% (ideal para notebook com espaço máximo)"
                  className={`flex h-7 items-center justify-center rounded-lg text-[11px] transition cursor-pointer ${
                    density === "75"
                      ? "bg-background text-foreground shadow-xs border border-border/50 font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
                  }`}
                >
                  <span>75%</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDensity("85")}
                  title="Escala equilibrada intermediária (85%)"
                  className={`flex h-7 items-center justify-center rounded-lg text-[11px] transition cursor-pointer ${
                    density === "85"
                      ? "bg-background text-foreground shadow-xs border border-border/50 font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
                  }`}
                >
                  <span>85%</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDensity("100")}
                  title="Escala padrão sem zoom (100% para monitores grandes)"
                  className={`flex h-7 items-center justify-center rounded-lg text-[11px] transition cursor-pointer ${
                    density === "100"
                      ? "bg-background text-foreground shadow-xs border border-border/50 font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
                  }`}
                >
                  <span>100%</span>
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Recomendamos <strong>Auto</strong> ou <strong>75%</strong> para notebooks corporativos, aumentando a área visível do CRM e chat.
              </p>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="pt-2.5 border-t border-border/60 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={() => {
              logout();
              onClose();
            }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-500 hover:bg-red-500/10 px-2 py-1 rounded-md transition-colors cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sair</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-lg border border-border/60 bg-muted/30 px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="h-8 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition cursor-pointer shadow-xs"
            >
              {isSubmitting ? "Salvando..." : "Salvar"}
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
