import React, { useState, useEffect } from "react";
import { useChat } from "@/hooks/useChatState";
import { usePermissions } from "@/hooks/usePermissions";
import {
  House,
  Users,
  Settings,
  Clock,
  ClipboardCheck,
  Eye,
  BarChart2,
  Video,
  ChevronDown,
  Building2,
  Contact,
  Shield,
  Wallet,
  Bot,
  PhoneCall,
  Columns3,
  BriefcaseBusiness,
  Keyboard,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { getAiPersona } from "@/lib/ai-persona";
import { ProfilePopover } from "@/components/chat/ProfileModal";

export function Sidebar() {
  const { tenant, setTenant, availableTenants, activeView, setActiveView, operatorProfile, sessionRole, setIsProfileModalOpen, currentGroup } = useChat();
  const { canAccessView } = usePermissions();
  const [showDropdown, setShowDropdown] = useState(false);
  const persona = getAiPersona(tenant || "valem");

  const navItems = [
    ...(tenant === "tecfag" ? [{ id: "commercialHome", icon: House, label: "Início" }] : []),
    { id: "chat", icon: Users, label: "Chat" },
    { id: "crm", icon: Columns3, label: "Negociações" },
    { id: "tasks", icon: ClipboardCheck, label: "Tarefas" },
    { id: "contacts", icon: Contact, label: "Base de Clientes" },
    { id: "wallet", icon: Wallet, label: "Minha Carteira" },
  ].filter((item) => canAccessView(item.id as any));

  const decorativeItems = [
    ...(tenant === "tecfag" && sessionRole === "admin" ? [
      { id: "commercialManagement", icon: BriefcaseBusiness, label: "Gestão Comercial", isAvailable: true },
      { id: "commercialBi", icon: BarChart2, label: "War Room", isAvailable: true },
    ] : []),
    { id: "valentina", icon: Bot,      label: persona.name,          isAvailable: true },
    { id: "ligacoes",  icon: PhoneCall, label: "Ligações",           isAvailable: true },
    { id: "monitor",   icon: Eye,       label: "Monitorar",          isAvailable: true },
    { id: "analytics", icon: BarChart2, label: "Estatísticas",       isAvailable: true },
    { id: "groups",    icon: Shield,    label: "Grupo de Acesso",    isAvailable: true },
    { id: "settings",  icon: Settings,  label: "Ajustes",            isAvailable: true },
  ].filter((item) => canAccessView(item.id as any));

  // Redirecionamento automático caso a view atual não seja permitida
  useEffect(() => {
    if ((activeView === "commercialHome" || activeView === "commercialManagement" || activeView === "commercialBi") && tenant !== "tecfag") {
      setActiveView("chat");
      return;
    }
    if (!canAccessView(activeView)) {
      const firstAllowed = [...navItems, ...decorativeItems][0]?.id;
      if (firstAllowed) {
        setActiveView(firstAllowed as any);
      }
    }
  }, [activeView, currentGroup, tenant]);


  return (
    <aside className="flex h-full w-14 md:w-[72px] shrink-0 flex-col items-center justify-between py-2.5 md:py-4.5 relative z-50 select-none overflow-hidden">
      <div className="flex flex-col items-center w-full flex-1 min-h-0 overflow-hidden">
        {/* Tenant Switcher Logo */}
        <div className="relative shrink-0 mb-2 md:mb-4">
          <motion.button
            whileHover={availableTenants.length > 1 ? { scale: 1.05 } : {}}
            whileTap={availableTenants.length > 1 ? { scale: 0.95 } : {}}
            onClick={() => availableTenants.length > 1 && setShowDropdown(!showDropdown)}
            className={`group relative flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-xl md:rounded-2xl bg-card border border-border shadow-soft transition-all hover:border-primary ${
              availableTenants.length > 1 ? "cursor-pointer" : "cursor-default"
            }`}
            title={availableTenants.length > 1 ? "Alternar Empresa" : `Empresa: ${tenant === "tecfag" ? "Tecfag" : "Valem"}`}
          >
            <AnimatePresence mode="wait">
              <motion.img
                key={tenant}
                initial={{ rotateY: -90, opacity: 0 }}
                animate={{ rotateY: 0, opacity: 1 }}
                exit={{ rotateY: 90, opacity: 0 }}
                transition={{ duration: 0.3 }}
                src={tenant === "tecfag" ? "/logo_tecfag.png" : "/logo_valem.jpg"}
                alt="Logo"
                className="h-8 w-8 md:h-10 md:w-10 rounded-lg md:rounded-xl object-cover"
              />
            </AnimatePresence>
            {availableTenants.length > 1 && (
              <span className="absolute -bottom-1 -right-1 md:-bottom-1.5 md:right-0 grid h-3.5 w-3.5 md:h-4 md:w-4 place-items-center rounded-full bg-primary text-[8px] md:text-[9px] font-bold text-primary-foreground">
                <ChevronDown className="h-2 w-2 md:h-2.5 md:w-2.5" />
              </span>
            )}
          </motion.button>

          {/* Tenant Switcher Dropdown */}
          <AnimatePresence>
            {showDropdown && availableTenants.length > 1 && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, x: -10 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.9, x: -10 }}
                  transition={{ type: "spring", damping: 20, stiffness: 300 }}
                  className="absolute left-14 top-0 z-50 w-48 rounded-2xl bg-card p-2 border border-border shadow-card origin-left"
                >
                  <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Empresa Ativa
                  </div>
                  {availableTenants.includes("tecfag") && (
                    <button
                      onClick={() => {
                        setTenant("tecfag");
                        setShowDropdown(false);
                      }}
                      className={`mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold transition hover:bg-muted ${
                        tenant === "tecfag" ? "text-primary bg-primary-soft/50" : "text-foreground"
                      }`}
                    >
                      <img
                        src="/logo_tecfag.png"
                        alt="TF"
                        className="h-6 w-6 rounded-lg object-cover bg-white"
                      />
                      <div>
                        <div>Tecfag Chat</div>
                        <div className="text-[10px] font-normal text-muted-foreground">Abrir sistema Tecfag</div>
                      </div>
                    </button>
                  )}
                  {availableTenants.includes("valem") && (
                    <button
                      onClick={() => {
                        setTenant("valem");
                        setShowDropdown(false);
                      }}
                      className={`mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold transition hover:bg-muted ${
                        tenant === "valem" ? "text-primary bg-primary-soft/50" : "text-foreground"
                      }`}
                    >
                      <img
                        src="/logo_valem.jpg"
                        alt="V"
                        className="h-6 w-6 rounded-lg object-cover bg-white"
                      />
                      <div>
                        <div>Valem Chat</div>
                        <div className="text-[10px] font-normal text-muted-foreground">Abrir sistema Valem</div>
                      </div>
                    </button>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation Items (Scrollável silenciosamente se a tela for muito baixa) */}
        <div className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden scrollbar-none flex flex-col items-center py-1">
          <nav className="flex flex-col items-center gap-1.5 md:gap-2.5 w-full">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <motion.button
                  key={item.id}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => setActiveView(item.id as any)}
                  aria-label={item.label}
                  className={`relative grid h-9 w-9 md:h-11 md:w-11 place-items-center rounded-xl md:rounded-2xl cursor-pointer group transition-colors duration-150 shrink-0 ${
                    isActive
                      ? "bg-primary-soft text-primary font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="activeTabIndicator"
                      className="absolute -left-3 md:-left-6 top-1/2 h-5 md:h-7 w-[3px] -translate-y-1/2 rounded-r bg-primary"
                      transition={{ type: "spring", stiffness: 350, damping: 25 }}
                    />
                  )}
                  <Icon className="h-4 w-4 md:h-5 md:w-5" strokeWidth={isActive ? 2.25 : 1.75} />
                  {/* Floating tooltip — mesmo padrão dos módulos inferiores */}
                  <span className="absolute left-12 md:left-14 scale-0 opacity-0 rounded-xl bg-foreground px-3 py-1.5 text-xs font-semibold text-background group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 ease-out whitespace-nowrap pointer-events-none shadow-lg z-50">
                    {item.label}
                  </span>
                </motion.button>
              );
            })}

            <div className="my-1 md:my-1.5 h-[1px] w-6 md:w-8 bg-line shrink-0" />

            {/* Decorative / Future Navigation Items */}
            {decorativeItems.map((item, index) => {
              const Icon = item.icon;
              if (item.isAvailable) {
                const isActive = activeView === item.id;
                return (
                  <motion.button
                    key={index}
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => setActiveView(item.id as any)}
                    aria-label={item.label}
                    className={`relative grid h-9 w-9 md:h-11 md:w-11 place-items-center rounded-xl md:rounded-2xl cursor-pointer group transition-colors duration-150 shrink-0 ${
                      isActive
                        ? "bg-primary-soft text-primary font-semibold"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    title={item.label}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="activeTabIndicator"
                        className="absolute -left-3 md:-left-6 top-1/2 h-5 md:h-7 w-[3px] -translate-y-1/2 rounded-r bg-primary"
                        transition={{ type: "spring", stiffness: 350, damping: 25 }}
                      />
                    )}
                    <Icon className="h-4 w-4 md:h-5 md:w-5" strokeWidth={isActive ? 2.25 : 1.75} />
                    {/* Floating tooltip */}
                    <span className="absolute left-12 md:left-14 scale-0 opacity-0 rounded-xl bg-foreground px-3 py-1.5 text-xs font-semibold text-background group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 ease-out whitespace-nowrap pointer-events-none shadow-lg z-50">
                      {item.label}
                    </span>
                  </motion.button>
                );
              }

              return (
                <motion.button
                  key={index}
                  whileHover={{ scale: 0.98 }}
                  className="relative grid h-9 w-9 md:h-11 md:w-11 place-items-center rounded-xl md:rounded-2xl text-muted-foreground/50 hover:bg-muted/40 cursor-not-allowed group transition-colors duration-150 shrink-0"
                  title={`${item.label} (Brevemente)`}
                  disabled
                >
                  <Icon className="h-4 w-4 md:h-5 md:w-5" strokeWidth={1.75} />
                  {/* Floating tooltip */}
                  <span className="absolute left-12 md:left-14 scale-0 opacity-0 rounded bg-foreground px-2 py-1 text-xs text-background group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 ease-out whitespace-nowrap pointer-events-none">
                    {item.label}
                  </span>
                </motion.button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Bottom Profile / User Avatar */}
      <div className="flex flex-col items-center gap-2 md:gap-3 shrink-0 pt-2 md:pt-3 border-t border-line/40 w-full">
        {/* Dica de Atalhos de Teclado */}
        <div
          className="relative grid h-7 w-7 md:h-8 md:w-8 place-items-center rounded-lg md:rounded-xl text-muted-foreground/60 hover:text-primary hover:bg-primary-soft/40 transition-colors group cursor-help shrink-0"
          title="Navegação por Teclado: Setas ↑/↓ para módulos · Setas ←/→ para abas"
          aria-label="Navegação por Teclado: Setas ↑/↓ para módulos · Setas ←/→ para abas"
        >
          <Keyboard className="h-3.5 w-3.5 md:h-4 md:w-4" />
          <span className="absolute left-12 md:left-14 bottom-0 scale-0 opacity-0 rounded-xl bg-foreground px-3 py-1.5 text-[11px] font-semibold text-background group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 ease-out whitespace-nowrap pointer-events-none shadow-lg z-50">
            Setas ↑ / ↓ : Módulos <br /> Setas ← / → : Abas
          </span>
        </div>

        <ProfilePopover side="right" align="end" sideOffset={14}>
          <button
            className="relative block h-8 w-8 md:h-10 md:w-10 rounded-full cursor-pointer group transition-transform hover:scale-105 active:scale-95 shrink-0"
            aria-label="Editar Meu Perfil"
          >
            <img
              src={operatorProfile.avatar}
              alt={operatorProfile.name}
              className="h-8 w-8 md:h-10 md:w-10 rounded-full object-cover border border-border"
            />
            <span className={`absolute bottom-0 right-0 h-2 w-2 md:h-2.5 md:w-2.5 rounded-full border border-card ${
              operatorProfile.status === "disponivel"
                ? "bg-primary"
                : operatorProfile.status === "pausa"
                ? "bg-amber-500"
                : "bg-gray-400"
            }`} />
            {/* Floating tooltip */}
            <span className="absolute left-12 md:left-14 bottom-0 scale-0 opacity-0 rounded-xl bg-foreground px-3 py-1.5 text-xs font-semibold text-background group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 ease-out whitespace-nowrap pointer-events-none shadow-lg z-50">
              Editar Meu Perfil
            </span>
          </button>
        </ProfilePopover>
      </div>
    </aside>
  );
}
