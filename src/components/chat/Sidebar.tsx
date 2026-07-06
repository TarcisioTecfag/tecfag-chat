import React, { useState } from "react";
import { useChat } from "@/hooks/useChatState";
import {
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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function Sidebar() {
  const { tenant, setTenant, activeView, setActiveView, operatorProfile, setIsProfileModalOpen, currentGroup } = useChat();
  const [showDropdown, setShowDropdown] = useState(false);

  const toggleTenant = () => {
    setTenant(tenant === "tecfag" ? "valem" : "tecfag");
  };

  const navItems = [
    { id: "chat", icon: Users, label: "Chat" },
    { id: "contacts", icon: Contact, label: "Base de Clientes" },
  ];

  const decorativeItems = [
    { id: "settings", icon: Settings, label: "Ajustes", isAvailable: true },
    { id: "groups", icon: Shield, label: "Grupo de Acesso", isAvailable: true },
    { id: "monitor", icon: Eye, label: "Monitorar", isAvailable: true },
    { icon: Clock, label: "Histórico" },
    { icon: ClipboardCheck, label: "Tarefas" },
    { icon: BarChart2, label: "Estatísticas" },
  ];

  return (
    <aside className="flex h-full w-[72px] shrink-0 flex-col items-center justify-between py-6 relative z-50">
      <div className="flex flex-col items-center gap-10 w-full">
        {/* Tenant Switcher Logo */}
        <div className="relative">
          <motion.button
            whileHover={currentGroup && currentGroup.allowedTenants.length > 1 ? { scale: 1.05 } : {}}
            whileTap={currentGroup && currentGroup.allowedTenants.length > 1 ? { scale: 0.95 } : {}}
            onClick={() => currentGroup && currentGroup.allowedTenants.length > 1 && setShowDropdown(!showDropdown)}
            className={`group relative flex h-12 w-12 items-center justify-center rounded-2xl bg-card border border-border shadow-soft transition-all hover:border-primary ${
              currentGroup && currentGroup.allowedTenants.length > 1 ? "cursor-pointer" : "cursor-default"
            }`}
            title={currentGroup && currentGroup.allowedTenants.length > 1 ? "Alternar Empresa" : `Empresa: ${tenant === "tecfag" ? "Tecfag" : "Valem"}`}
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
                className="h-10 w-10 rounded-xl object-cover"
              />
            </AnimatePresence>
            {currentGroup && currentGroup.allowedTenants.length > 1 && (
              <span className="absolute -bottom-1.5 right-0 grid h-4 w-4 place-items-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                <ChevronDown className="h-2.5 w-2.5" />
              </span>
            )}
          </motion.button>

          {/* Tenant Switcher Dropdown */}
          <AnimatePresence>
            {showDropdown && currentGroup && currentGroup.allowedTenants.length > 1 && (
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
                  {currentGroup.allowedTenants.includes("tecfag") && (
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
                        <div className="text-[10px] font-normal text-muted-foreground">API Oficial Meta</div>
                      </div>
                    </button>
                  )}
                  {currentGroup.allowedTenants.includes("valem") && (
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
                        <div className="text-[10px] font-normal text-muted-foreground">Baileys API</div>
                      </div>
                    </button>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation Items */}
        <nav className="flex flex-col items-center gap-3 w-full">
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
                className={`relative grid h-11 w-11 place-items-center rounded-2xl cursor-pointer group transition-colors duration-150 ${
                  isActive
                    ? "bg-primary-soft text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                title={item.label}
              >
                {isActive && (
                  <motion.span
                    layoutId="activeTabIndicator"
                    className="absolute -left-6 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r bg-primary"
                    transition={{ type: "spring", stiffness: 350, damping: 25 }}
                  />
                )}
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.25 : 1.75} />
              </motion.button>
            );
          })}

          <div className="my-2 h-[1px] w-8 bg-line" />

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
                  className={`relative grid h-11 w-11 place-items-center rounded-2xl cursor-pointer group transition-colors duration-150 ${
                    isActive
                      ? "bg-primary-soft text-primary font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  title={item.label}
                >
                  {isActive && (
                    <motion.span
                      layoutId="activeTabIndicator"
                      className="absolute -left-6 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r bg-primary"
                      transition={{ type: "spring", stiffness: 350, damping: 25 }}
                    />
                  )}
                  <Icon className="h-5 w-5" strokeWidth={isActive ? 2.25 : 1.75} />
                  {/* Floating tooltip */}
                  <span className="absolute left-14 scale-0 opacity-0 rounded bg-foreground px-2 py-1 text-xs text-background group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 ease-out whitespace-nowrap pointer-events-none">
                    {item.label}
                  </span>
                </motion.button>
              );
            }

            return (
              <motion.button
                key={index}
                whileHover={{ scale: 0.98 }}
                className="relative grid h-11 w-11 place-items-center rounded-2xl text-muted-foreground/50 hover:bg-muted/40 cursor-not-allowed group transition-colors duration-150"
                title={`${item.label} (Brevemente)`}
                disabled
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} />
                {/* Floating tooltip */}
                <span className="absolute left-14 scale-0 opacity-0 rounded bg-foreground px-2 py-1 text-xs text-background group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 ease-out whitespace-nowrap pointer-events-none">
                  {item.label}
                </span>
              </motion.button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Profile / User Avatar */}
      <div className="flex flex-col items-center gap-4">
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsProfileModalOpen(true)}
          className="relative block h-10 w-10 rounded-full cursor-pointer"
          title="Editar Meu Perfil"
        >
          <img
            src={operatorProfile.avatar}
            alt={operatorProfile.name}
            className="h-10 w-10 rounded-full object-cover border border-border"
          />
          <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-card ${
            operatorProfile.status === "disponivel"
              ? "bg-emerald-500"
              : operatorProfile.status === "pausa"
              ? "bg-amber-500"
              : "bg-gray-400"
          }`} />
        </motion.button>
      </div>
    </aside>
  );
}
