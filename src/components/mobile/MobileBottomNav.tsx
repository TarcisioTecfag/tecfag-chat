import React, { useState } from "react";
import {
  Check,
  LayoutGrid,
  LogOut,
  Moon,
  Monitor,
  Settings2,
  Sun,
  X,
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { usePermissions } from "@/hooks/usePermissions";
import { useTheme } from "@/hooks/useTheme";
import { getMobileNavigationModules } from "@/lib/module-catalog";
import type { ViewId } from "@/lib/rbac";
import { AnimatePresence, motion } from "framer-motion";

export const MobileBottomNav: React.FC = () => {
  const {
    activeView,
    setActiveView,
    setSelectedChatId,
    operatorProfile,
    updateOperatorProfile,
    setIsProfileModalOpen,
    logout,
    sessionRole,
    tenant,
    setTenant,
    availableTenants,
    isCommercialConsultant,
  } = useChat();
  const { canAccessView } = usePermissions();
  const { theme, setTheme } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const {
    bottomItems,
    drawerPrimaryItems,
    drawerSecondaryItems,
  } = getMobileNavigationModules(
    {
      tenant,
      sessionRole,
      isCommercialConsultant,
      canAccessView,
    },
    4
  );

  const canSwitchTenant = availableTenants.length > 1;
  const isCurrentInBottomBar = bottomItems.some((item) => item.id === activeView);

  const handleTabClick = (viewId: ViewId) => {
    setSelectedChatId(null);
    setActiveView(viewId);
    setDrawerOpen(false);
  };

  const handleStatusChange = (status: "disponivel" | "pausa" | "desconectado") => {
    updateOperatorProfile({ status });
  };

  return (
    <>
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              key="mobile-nav-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-xs"
            />
            <motion.div
              key="mobile-nav-drawer"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className="fixed inset-x-0 bottom-0 z-[90] max-h-[85dvh] rounded-t-3xl bg-card border-t border-border shadow-2xl flex flex-col overflow-hidden select-none"
            >
              {/* Handle & Close */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border/60 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="relative shrink-0">
                    <img
                      src={operatorProfile.avatar}
                      alt={operatorProfile.name}
                      className="h-10 w-10 rounded-full object-cover border border-border"
                    />
                    <span
                      className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card ${
                        operatorProfile.status === "disponivel"
                          ? "bg-primary"
                          : operatorProfile.status === "pausa"
                          ? "bg-amber-500"
                          : "bg-gray-400"
                      }`}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-foreground truncate">
                      {operatorProfile.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {operatorProfile.role || "Operador"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      setIsProfileModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-muted/60 hover:bg-muted text-xs font-semibold text-foreground transition cursor-pointer"
                  >
                    <Settings2 className="h-3.5 w-3.5 text-primary" />
                    <span>Perfil</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="p-1.5 rounded-full bg-muted/60 text-muted-foreground hover:text-foreground transition cursor-pointer"
                    aria-label="Fechar menu"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Status & Tema Rápidos */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="rounded-2xl bg-muted/30 border border-border/60 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                      Status de Atendimento
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          { id: "disponivel", label: "Online", dot: "bg-primary" },
                          { id: "pausa", label: "Pausa", dot: "bg-amber-500" },
                          { id: "desconectado", label: "Offline", dot: "bg-gray-400" },
                        ] as const
                      ).map((st) => {
                        const active = operatorProfile.status === st.id;
                        return (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => handleStatusChange(st.id)}
                            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-[11px] font-semibold transition cursor-pointer ${
                              active
                                ? "bg-card text-foreground shadow-xs border border-border"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <span className={`h-2 w-2 rounded-full ${st.dot}`} />
                            <span>{st.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-muted/30 border border-border/60 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                      Aparência
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          { id: "light", label: "Claro", icon: Sun },
                          { id: "dark", label: "Escuro", icon: Moon },
                          { id: "system", label: "Auto", icon: Monitor },
                        ] as const
                      ).map((t) => {
                        const Icon = t.icon;
                        const active = theme === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setTheme(t.id)}
                            className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-xl text-[11px] font-semibold transition cursor-pointer ${
                              active
                                ? "bg-card text-foreground shadow-xs border border-border"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            <span>{t.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Tenant Switcher (Quando habilitado para múltiplos tenants) */}
                {canSwitchTenant && (
                  <div className="rounded-2xl bg-muted/30 border border-border/60 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                      Alternar Empresa
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {availableTenants.includes("tecfag") && (
                        <button
                          type="button"
                          onClick={() => {
                            setTenant("tecfag");
                            setDrawerOpen(false);
                          }}
                          className={`flex items-center gap-2.5 rounded-xl p-2 text-left text-xs font-semibold transition cursor-pointer border ${
                            tenant === "tecfag"
                              ? "bg-primary/10 text-primary border-primary/30"
                              : "bg-card text-foreground border-border/60 hover:bg-muted"
                          }`}
                        >
                          <img
                            src="/logo_tecfag.png"
                            alt="Tecfag"
                            className="h-6 w-6 rounded-lg object-cover bg-white shrink-0"
                          />
                          <span className="truncate flex-1">Tecfag</span>
                          {tenant === "tecfag" && <Check className="h-3.5 w-3.5 shrink-0" />}
                        </button>
                      )}
                      {availableTenants.includes("valem") && (
                        <button
                          type="button"
                          onClick={() => {
                            setTenant("valem");
                            setDrawerOpen(false);
                          }}
                          className={`flex items-center gap-2.5 rounded-xl p-2 text-left text-xs font-semibold transition cursor-pointer border ${
                            tenant === "valem"
                              ? "bg-primary/10 text-primary border-primary/30"
                              : "bg-card text-foreground border-border/60 hover:bg-muted"
                          }`}
                        >
                          <img
                            src="/logo_valem.jpg"
                            alt="Valem"
                            className="h-6 w-6 rounded-lg object-cover bg-white shrink-0"
                          />
                          <span className="truncate flex-1">Valem</span>
                          {tenant === "valem" && <Check className="h-3.5 w-3.5 shrink-0" />}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Módulos Principais */}
                {drawerPrimaryItems.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                      Operação & Comercial
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {drawerPrimaryItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeView === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleTabClick(item.id)}
                            className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl p-3 border text-center transition cursor-pointer ${
                              isActive
                                ? "bg-primary/10 border-primary/30 text-primary font-bold"
                                : "bg-muted/20 border-border/60 text-foreground hover:bg-muted/50 font-medium"
                            }`}
                          >
                            <Icon className="h-5 w-5" strokeWidth={isActive ? 2.25 : 1.8} />
                            <span className="text-[11px] leading-tight line-clamp-1">
                              {item.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Módulos de Gestão, IA e Configurações */}
                {drawerSecondaryItems.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                      Gestão, Inteligência & Sistema
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {drawerSecondaryItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeView === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleTabClick(item.id)}
                            className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl p-3 border text-center transition cursor-pointer ${
                              isActive
                                ? "bg-primary/10 border-primary/30 text-primary font-bold"
                                : "bg-muted/20 border-border/60 text-foreground hover:bg-muted/50 font-medium"
                            }`}
                          >
                            <Icon className="h-5 w-5" strokeWidth={isActive ? 2.25 : 1.8} />
                            <span className="text-[11px] leading-tight line-clamp-1">
                              {item.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Botão Sair */}
                <div className="pt-2 border-t border-border/60">
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      logout();
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-500 text-xs font-bold hover:bg-red-500/15 transition cursor-pointer"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Encerrar Sessão</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border/80 px-2 py-1.5 flex justify-around items-center shadow-lg select-none">
        {bottomItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id && !drawerOpen;
          return (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => handleTabClick(item.id)}
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.04 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className={`relative flex flex-col items-center justify-center flex-1 py-1 px-1 transition-colors cursor-pointer rounded-2xl ${
                isActive
                  ? "text-primary font-bold"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="mobileNavActiveTab"
                  className="absolute inset-0 bg-primary/10 rounded-2xl -z-10 border border-primary/15"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}

              <div className={`transition-transform duration-200 ${isActive ? "scale-110" : ""}`}>
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.25 : 1.9} />
              </div>

              <span
                className={`text-[10px] mt-0.5 tracking-tight font-extrabold transition-colors truncate max-w-[68px] ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {item.shortLabel}
              </span>
            </motion.button>
          );
        })}

        {/* Botão Menu / Mais Módulos */}
        <motion.button
          type="button"
          onClick={() => setDrawerOpen((prev) => !prev)}
          whileTap={{ scale: 0.9 }}
          whileHover={{ scale: 1.04 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          aria-label="Mais módulos e perfil"
          aria-expanded={drawerOpen}
          className={`relative flex flex-col items-center justify-center flex-1 py-1 px-1 transition-colors cursor-pointer rounded-2xl ${
            drawerOpen || !isCurrentInBottomBar
              ? "text-primary font-bold"
              : "text-muted-foreground hover:text-foreground font-medium"
          }`}
        >
          {(drawerOpen || !isCurrentInBottomBar) && (
            <motion.div
              layoutId="mobileNavActiveTab"
              className="absolute inset-0 bg-primary/10 rounded-2xl -z-10 border border-primary/15"
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            />
          )}

          <div
            className={`transition-transform duration-200 ${
              drawerOpen || !isCurrentInBottomBar ? "scale-110" : ""
            }`}
          >
            <LayoutGrid className="w-5 h-5" strokeWidth={2.1} />
          </div>

          <span
            className={`text-[10px] mt-0.5 tracking-tight font-extrabold transition-colors ${
              drawerOpen || !isCurrentInBottomBar ? "text-primary" : "text-muted-foreground"
            }`}
          >
            Menu
          </span>
        </motion.button>
      </nav>
    </>
  );
};
