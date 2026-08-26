import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import React, { useState, useRef } from "react";
import { useChat } from "@/hooks/useChatState";
import { usePermissions } from "@/hooks/usePermissions";
import { X, Check, ShieldAlert, Camera, Eye, EyeOff, Plus, Shield, Sun, Moon, Monitor } from "lucide-react";
import { motion } from "framer-motion";
import { useTheme } from "@/hooks/useTheme";

export function ProfileModal() {
  const {
    operatorProfile,
    updateOperatorProfile,
    isProfileModalOpen,
    setIsProfileModalOpen,
    logout,
    currentGroup,
    setActiveView,
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

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Predefined avatar selections for rapid mock fidelity
  const presetAvatars = [
    "https://i.pravatar.cc/160?img=12", // Default Fagner
    "https://i.pravatar.cc/160?img=33", // Alternative Male
    "https://i.pravatar.cc/160?img=47", // Female 1
    "https://i.pravatar.cc/160?img=60", // Female 2
    "https://i.pravatar.cc/160?img=68", // Alternative Male 2
  ];

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
            
            // Tamanho otimizado para avatar
            const size = 120;
            canvas.width = size;
            canvas.height = size;
            
            if (ctx) {
              // Redimensiona preenchendo o quadrado do avatar de forma proporcional
              const minSize = Math.min(img.width, img.height);
              const sx = (img.width - minSize) / 2;
              const sy = (img.height - minSize) / 2;
              
              ctx.drawImage(img, sx, sy, minSize, minSize, 0, 0, size, size);
              
              // Exporta em JPEG de qualidade média para ocupar pouquíssimo espaço (cerca de 3-5KB)
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

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateOperatorProfile({
      name,
      email,
      avatar,
      status,
    });
    setIsProfileModalOpen(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 select-none"
    >
      {/* Hidden input for local upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />

      {/* Modal Wrapper */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ type: "spring", damping: 25, stiffness: 280 }}
        className="w-full max-w-lg rounded-3xl bg-card border border-border shadow-card overflow-hidden flex flex-col"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-line px-6 py-4.5 bg-muted/20">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            <h3 className="text-base font-extrabold text-foreground">Configurações de Perfil</h3>
          </div>
          <button
            onClick={() => setIsProfileModalOpen(false)}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted text-muted-foreground transition cursor-pointer"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </header>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 space-y-5">
          {/* Avatar and Status Switcher Area */}
          <div className="flex flex-col sm:flex-row items-center gap-6 pb-2">
            {/* Main Avatar Display */}
            <div onClick={handleAvatarClick} className="relative group cursor-pointer">
              <img
                src={avatar}
                alt="Avatar Preview"
                className="h-20 w-20 rounded-full object-cover border-2 border-primary shadow-soft"
              />
              <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="h-5 w-5 text-white" />
              </div>
            </div>

            {/* Quick Status Select */}
            <div className="flex-1 space-y-2 text-center sm:text-left">
              <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                Status Operacional
              </label>
              <div className="flex flex-wrap justify-center sm:justify-start gap-2">
                <button
                  type="button"
                  onClick={() => setStatus("disponivel")}
                  className={`flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition cursor-pointer ${
                    status === "disponivel"
                      ? "bg-emerald-500 border-emerald-500 text-white shadow-soft"
                      : "bg-card border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${status === "disponivel" ? "bg-white" : "bg-emerald-500"}`} />
                  Disponível
                </button>
                <button
                  type="button"
                  onClick={() => setStatus("pausa")}
                  className={`flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition cursor-pointer ${
                    status === "pausa"
                      ? "bg-amber-500 border-amber-500 text-white shadow-soft"
                      : "bg-card border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${status === "pausa" ? "bg-white" : "bg-amber-500"}`} />
                  Em Pausa
                </button>
                <button
                  type="button"
                  onClick={() => setStatus("desconectado")}
                  className={`flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition cursor-pointer ${
                    status === "desconectado"
                      ? "bg-gray-500 border-gray-500 text-white shadow-soft"
                      : "bg-card border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${status === "desconectado" ? "bg-white" : "bg-gray-400"}`} />
                  Desconectado
                </button>
              </div>
            </div>
          </div>

          {/* Quick Avatar Presets */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider">
              Escolher Foto Pré-definida
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {presetAvatars.map((avUrl, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setAvatar(avUrl)}
                  className={`relative rounded-full overflow-hidden border-2 transition cursor-pointer hover:opacity-90 ${
                    avatar === avUrl ? "border-primary scale-105" : "border-transparent"
                  }`}
                >
                  <img src={avUrl} alt="" className="h-10 w-10 object-cover" />
                  {avatar === avUrl && (
                    <span className="absolute inset-0 bg-primary/20 flex items-center justify-center text-white">
                      <Check className="h-4.5 w-4.5 stroke-[3]" />
                    </span>
                  )}
                </button>
              ))}
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleAvatarClick}
                    className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-border bg-muted hover:bg-border transition cursor-pointer text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-4.5 w-4.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Subir do Computador</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* User Fields */}
          <div className="space-y-3">
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
                className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
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
                className="h-10 w-full rounded-xl bg-muted px-3.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
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
                  className="h-10 w-full rounded-xl bg-muted px-3.5 pr-10 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Tema do Sistema / Aparência */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                Tema / Aparência
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`flex h-9.5 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-bold transition cursor-pointer ${
                    theme === "light"
                      ? "bg-primary border-primary text-primary-foreground shadow-soft"
                      : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Sun className="h-4 w-4" />
                  <span>Claro</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`flex h-9.5 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-bold transition cursor-pointer ${
                    theme === "dark"
                      ? "bg-primary border-primary text-primary-foreground shadow-soft"
                      : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Moon className="h-4 w-4" />
                  <span>Escuro</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("system")}
                  className={`flex h-9.5 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-bold transition cursor-pointer ${
                    theme === "system"
                      ? "bg-primary border-primary text-primary-foreground shadow-soft"
                      : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Monitor className="h-4 w-4" />
                  <span>Automático</span>
                </button>
              </div>
            </div>

            {/* Grupo de Acesso & Permissões */}
            <div className="rounded-xl border border-border bg-card/60 p-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Shield className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider">
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
                    setIsProfileModalOpen(false);
                    setActiveView("groups");
                  }}
                  className="text-[11px] font-bold text-primary hover:underline cursor-pointer px-2 py-1 rounded-lg hover:bg-primary/10 transition"
                >
                  Gerenciar Permissões →
                </button>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-line flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                logout();
                setIsProfileModalOpen(false);
              }}
              className="text-xs font-extrabold text-red-500 hover:text-red-600 transition-colors cursor-pointer hover:underline bg-transparent border-0 px-1 py-1"
            >
              Fazer Logout
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setIsProfileModalOpen(false)}
                className="h-10 rounded-xl border border-border bg-card px-5 text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="h-10 rounded-xl bg-primary px-6 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-soft"
              >
                Salvar Alterações
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
