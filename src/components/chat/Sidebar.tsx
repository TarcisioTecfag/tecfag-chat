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
} from "lucide-react";

export function Sidebar() {
  const { tenant, setTenant, activeView, setActiveView, operatorProfile, setIsProfileModalOpen } = useChat();
  const [showDropdown, setShowDropdown] = useState(false);

  const toggleTenant = () => {
    setTenant(tenant === "tecfag" ? "valem" : "tecfag");
  };

  const navItems = [
    { id: "chat", icon: Users, label: "Chat" },
    { id: "contacts", icon: Contact, label: "Base de Clientes" },
    { id: "settings", icon: Settings, label: "Ajustes" },
  ];

  const decorativeItems = [
    { icon: Clock, label: "Histórico" },
    { icon: ClipboardCheck, label: "Tarefas" },
    { icon: Eye, label: "Monitorar" },
    { icon: BarChart2, label: "Estatísticas" },
  ];

  return (
    <aside className="flex h-full w-[72px] shrink-0 flex-col items-center justify-between py-6 relative z-50">
      <div className="flex flex-col items-center gap-10 w-full">
        {/* Tenant Switcher Logo */}
        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="group relative flex h-12 w-12 items-center justify-center rounded-2xl bg-card border border-border shadow-soft transition hover:border-primary cursor-pointer"
            title="Alternar Empresa"
          >
            <img
              src={tenant === "tecfag" ? "/logo_tecfag.png" : "/logo_valem.jpg"}
              alt="Logo"
              className="h-10 w-10 rounded-xl object-cover transition-transform group-hover:scale-105"
            />
            <span className="absolute -bottom-1.5 right-0 grid h-4 w-4 place-items-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
              <ChevronDown className="h-2.5 w-2.5" />
            </span>
          </button>

          {/* Tenant Switcher Dropdown */}
          {showDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
              <div className="absolute left-14 top-0 z-50 w-48 rounded-2xl bg-card p-2 border border-border shadow-card animate-in fade-in slide-in-from-left-2 duration-150">
                <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Empresa Ativa
                </div>
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
              </div>
            </>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="flex flex-col items-center gap-3 w-full">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id as "chat" | "contacts" | "settings")}
                aria-label={item.label}
                className={`relative grid h-11 w-11 place-items-center rounded-2xl transition-all duration-150 cursor-pointer group ${
                  isActive
                    ? "bg-primary-soft text-primary font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                title={item.label}
              >
                {isActive && (
                  <span className="absolute -left-6 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r bg-primary" />
                )}
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.25 : 1.75} />
              </button>
            );
          })}

          <div className="my-2 h-[1px] w-8 bg-line" />

          {/* Decorative / Future Navigation Items */}
          {decorativeItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={index}
                className="relative grid h-11 w-11 place-items-center rounded-2xl text-muted-foreground/50 hover:bg-muted/40 transition-colors duration-150 cursor-not-allowed group"
                title={`${item.label} (Brevemente)`}
                disabled
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} />
                {/* Floating tooltip */}
                <span className="absolute left-14 scale-0 rounded bg-foreground px-2 py-1 text-xs text-background group-hover:scale-100 transition-all duration-100 whitespace-nowrap">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Profile / User Avatar */}
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={() => setIsProfileModalOpen(true)}
          className="relative block h-10 w-10 rounded-full transition hover:scale-105 cursor-pointer"
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
        </button>
      </div>
    </aside>
  );
}
