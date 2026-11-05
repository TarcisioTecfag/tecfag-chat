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
  Check,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { getAiPersona } from "@/lib/ai-persona";
import { ProfilePopover } from "@/components/chat/ProfileModal";
import { getDesktopSidebarModules, resolveAuthorizedActiveView } from "@/lib/module-catalog";

export function Sidebar() {
  const { tenant, setTenant, availableTenants, activeView, setActiveView, operatorProfile, sessionRole, setIsProfileModalOpen, currentGroup, isCommercialConsultant } = useChat();
  const { canAccessView } = usePermissions();
  const [showDropdown, setShowDropdown] = useState(false);
  const persona = getAiPersona(tenant || "valem");
  const canSwitchTenant = availableTenants.length > 1;

  useEffect(() => {
    if (!showDropdown) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowDropdown(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showDropdown]);

  const moduleAccessCtx = {
    tenant,
    sessionRole,
    isCommercialConsultant,
    canAccessView,
  };

  const { navItems, decorativeItems } = getDesktopSidebarModules(moduleAccessCtx);
  const totalVisibleModules = navItems.length + decorativeItems.length;
  const isCompactModuleSet = totalVisibleModules > 0 && totalVisibleModules <= 7;
  const isDenseModuleSet = totalVisibleModules >= 10;

  const navButtonSizeClass = isCompactModuleSet
    ? "h-11 w-11 md:h-12 md:w-12 rounded-2xl"
    : isDenseModuleSet
    ? "h-7 w-7 md:h-[30px] md:w-[30px] [@media(max-height:640px)]:h-[26px] [@media(max-height:640px)]:w-[26px] [@media(min-height:760px)]:h-8 [@media(min-height:760px)]:w-8 [@media(min-height:880px)]:h-9 [@media(min-height:880px)]:w-9 rounded-xl"
    : "h-9 w-9 xl:h-10 xl:w-10 rounded-xl md:rounded-2xl";

  const navIconSizeClass = isCompactModuleSet
    ? "h-5 w-5 md:h-[22px] md:w-[22px]"
    : isDenseModuleSet
    ? "h-3.5 w-3.5 md:h-4 md:w-4 [@media(min-height:880px)]:h-[18px] [@media(min-height:880px)]:w-[18px]"
    : "h-4 w-4 xl:h-[18px] xl:w-[18px]";

  const activeIndicatorSizeClass = isCompactModuleSet
    ? "-left-2 md:-left-2.5 h-6 md:h-7 w-[3.5px]"
    : isDenseModuleSet
    ? "-left-1.5 md:-left-2 h-4 md:h-[18px] w-[3px]"
    : "-left-2 md:-left-2.5 h-5 md:h-6 w-[3px]";

  const logoTooltipLabel = canSwitchTenant
    ? "Alternar Empresa"
    : `Empresa: ${tenant === "tecfag" ? "Tecfag" : "Valem"}`;

  // Redirecionamento automático caso a view atual não seja permitida
  useEffect(() => {
    const resolved = resolveAuthorizedActiveView(activeView, moduleAccessCtx);
    if (resolved && resolved !== activeView) {
      setActiveView(resolved);
    }
  }, [activeView, currentGroup, isCommercialConsultant, tenant, sessionRole]);


  return (
    <aside
      className={`vp-sidebar-rail flex h-full w-14 md:w-[72px] shrink-0 flex-col items-center justify-between ${
        isDenseModuleSet ? "py-1.5 md:py-2" : "py-2.5 md:py-4.5"
      } relative ${
        showDropdown ? "z-[120]" : "z-50 hover:z-[110]"
      } select-none overflow-visible`}
    >
      <div className="flex flex-col items-center w-full flex-1 min-h-0 overflow-visible">
        {/* Tenant Switcher Logo */}
        <div
          className={`relative shrink-0 ${
            isDenseModuleSet
              ? "mb-1 md:mb-1.5 [@media(min-height:820px)]:mb-2.5"
              : "mb-2 md:mb-4"
          } z-[130]`}
        >
          <motion.button
            type="button"
            whileHover={canSwitchTenant ? { scale: 1.05 } : {}}
            whileTap={canSwitchTenant ? { scale: 0.95 } : {}}
            onClick={() => canSwitchTenant && setShowDropdown((prev) => !prev)}
            className={`group relative flex ${
              isDenseModuleSet
                ? "h-9 w-9 md:h-10 md:w-10 [@media(min-height:820px)]:h-11 [@media(min-height:820px)]:w-11"
                : "h-10 w-10 md:h-12 md:w-12"
            } items-center justify-center rounded-xl md:rounded-2xl bg-card border shadow-soft transition-all ${
              showDropdown && canSwitchTenant
                ? "border-primary ring-2 ring-primary/25"
                : "border-border hover:border-primary"
            } ${canSwitchTenant ? "cursor-pointer" : "cursor-default"}`}
            aria-label={logoTooltipLabel}
            aria-expanded={showDropdown && canSwitchTenant}
          >
            <AnimatePresence mode="wait">
              <motion.img
                key={tenant}
                initial={{ rotateY: -90, opacity: 0 }}
                animate={{ rotateY: 0, opacity: 1 }}
                exit={{ rotateY: 90, opacity: 0 }}
                transition={{ duration: 0.25 }}
                src={tenant === "tecfag" ? "/logo_tecfag.png" : "/logo_valem.jpg"}
                alt="Logo"
                className={`${
                  isDenseModuleSet
                    ? "h-7 w-7 md:h-8 md:w-8 [@media(min-height:820px)]:h-9 [@media(min-height:820px)]:w-9"
                    : "h-8 w-8 md:h-10 md:w-10"
                } rounded-lg md:rounded-xl object-cover`}
              />
            </AnimatePresence>
            {canSwitchTenant && (
              <span className="absolute -bottom-1 -right-1 grid h-4 w-4 md:h-[18px] md:w-[18px] place-items-center rounded-full bg-primary text-primary-foreground ring-2 ring-card shadow-md transition-transform duration-200">
                <ChevronDown
                  className={`h-2.5 w-2.5 transition-transform duration-200 ${
                    showDropdown ? "-rotate-90" : ""
                  }`}
                  strokeWidth={2.75}
                />
              </span>
            )}
            {!showDropdown && (
              <span className="absolute left-[calc(100%+14px)] md:left-[calc(100%+20px)] scale-0 opacity-0 rounded-xl bg-foreground px-3 py-1.5 text-xs font-semibold text-background group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 ease-out whitespace-nowrap pointer-events-none shadow-lg z-50">
                {logoTooltipLabel}
              </span>
            )}
          </motion.button>

          {/* Tenant Switcher Dropdown */}
          <AnimatePresence>
            {showDropdown && canSwitchTenant && (
              <>
                <div
                  className="fixed inset-0 z-[125]"
                  onClick={() => setShowDropdown(false)}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, x: -8 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.94, x: -8 }}
                  transition={{ type: "spring", damping: 22, stiffness: 320 }}
                  className="absolute left-[calc(100%+14px)] md:left-[calc(100%+20px)] top-0 z-[130] w-56 rounded-2xl bg-card p-2 border border-border shadow-2xl origin-left"
                >
                  <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Empresa Ativa
                  </div>
                  {availableTenants.includes("tecfag") && (
                    <button
                      type="button"
                      onClick={() => {
                        setTenant("tecfag");
                        setShowDropdown(false);
                      }}
                      className={`mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold transition cursor-pointer ${
                        tenant === "tecfag"
                          ? "text-primary bg-primary-soft/60 border border-primary/25"
                          : "text-foreground hover:bg-muted border border-transparent"
                      }`}
                    >
                      <img
                        src="/logo_tecfag.png"
                        alt="TF"
                        className="h-7 w-7 rounded-lg object-cover bg-white shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">Tecfag Chat</div>
                        <div className="text-[10px] font-normal text-muted-foreground truncate">
                          Abrir sistema Tecfag
                        </div>
                      </div>
                      {tenant === "tecfag" && <Check className="h-4 w-4 text-primary shrink-0" />}
                    </button>
                  )}
                  {availableTenants.includes("valem") && (
                    <button
                      type="button"
                      onClick={() => {
                        setTenant("valem");
                        setShowDropdown(false);
                      }}
                      className={`mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold transition cursor-pointer ${
                        tenant === "valem"
                          ? "text-primary bg-primary-soft/60 border border-primary/25"
                          : "text-foreground hover:bg-muted border border-transparent"
                      }`}
                    >
                      <img
                        src="/logo_valem.jpg"
                        alt="V"
                        className="h-7 w-7 rounded-lg object-cover bg-white shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">Valem Chat</div>
                        <div className="text-[10px] font-normal text-muted-foreground truncate">
                          Abrir sistema Valem
                        </div>
                      </div>
                      {tenant === "valem" && <Check className="h-4 w-4 text-primary shrink-0" />}
                    </button>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation Items */}
        <div
          className={`flex-1 min-h-0 w-full overflow-visible flex flex-col items-center ${
            isCompactModuleSet
              ? "justify-center -mt-2 md:-mt-3"
              : isDenseModuleSet
              ? "justify-between py-0.5"
              : "justify-center py-0.5"
          }`}
        >
          <nav
            className={`flex flex-col items-center w-full ${
              isCompactModuleSet
                ? "gap-2.5 md:gap-3.5"
                : isDenseModuleSet
                ? "flex-1 min-h-0 max-h-full justify-between gap-0.5"
                : "gap-1 xl:gap-2"
            }`}
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <motion.button
                  key={item.id}
                  data-tour={`nav.${item.id}`}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => setActiveView(item.id as any)}
                  aria-label={item.label}
                  className={`relative grid ${navButtonSizeClass} place-items-center cursor-pointer group transition-colors duration-150 shrink-0 ${
                    isActive
                      ? "bg-primary-soft text-primary font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="activeTabIndicator"
                      className={`absolute ${activeIndicatorSizeClass} top-1/2 -translate-y-1/2 rounded-r bg-primary`}
                      transition={{ type: "spring", stiffness: 350, damping: 25 }}
                    />
                  )}
                  <Icon className={navIconSizeClass} strokeWidth={isActive ? 2.25 : 1.75} />
                  {/* Floating tooltip — mesmo padrão dos módulos inferiores */}
                  <span className="absolute left-[calc(100%+14px)] md:left-[calc(100%+20px)] scale-0 opacity-0 rounded-xl bg-foreground px-3 py-1.5 text-xs font-semibold text-background group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 ease-out whitespace-nowrap pointer-events-none shadow-lg z-50">
                    {item.label}
                  </span>
                </motion.button>
              );
            })}

            {navItems.length > 0 && decorativeItems.length > 0 && (
              <div
                className={`${
                  isDenseModuleSet ? "my-0.5" : "my-0.5 xl:my-1"
                } h-[1px] w-6 md:w-8 bg-line shrink-0`}
              />
            )}

            {/* Decorative / Future Navigation Items */}
            {decorativeItems.map((item, index) => {
              const Icon = item.icon;
              if (item.isAvailable) {
                const isActive =
                  activeView === item.id ||
                  (item.id === "commercialManagement" && activeView === "commercialBi");
                return (
                  <motion.button
                    key={index}
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => setActiveView(item.id as any)}
                    aria-label={item.label}
                    className={`relative grid ${navButtonSizeClass} place-items-center cursor-pointer group transition-colors duration-150 shrink-0 ${
                      isActive
                        ? "bg-primary-soft text-primary font-semibold"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="activeTabIndicator"
                        className={`absolute ${activeIndicatorSizeClass} top-1/2 -translate-y-1/2 rounded-r bg-primary`}
                        transition={{ type: "spring", stiffness: 350, damping: 25 }}
                      />
                    )}
                    <Icon className={navIconSizeClass} strokeWidth={isActive ? 2.25 : 1.75} />
                    {/* Floating tooltip */}
                    <span className="absolute left-[calc(100%+14px)] md:left-[calc(100%+20px)] scale-0 opacity-0 rounded-xl bg-foreground px-3 py-1.5 text-xs font-semibold text-background group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 ease-out whitespace-nowrap pointer-events-none shadow-lg z-50">
                      {item.label}
                    </span>
                  </motion.button>
                );
              }

              return (
                <motion.button
                  key={index}
                  whileHover={{ scale: 0.98 }}
                  className={`relative grid ${navButtonSizeClass} place-items-center text-muted-foreground/50 hover:bg-muted/40 cursor-not-allowed group transition-colors duration-150 shrink-0`}
                  disabled
                >
                  <Icon className={navIconSizeClass} strokeWidth={1.75} />
                  {/* Floating tooltip */}
                  <span className="absolute left-[calc(100%+14px)] md:left-[calc(100%+20px)] scale-0 opacity-0 rounded bg-foreground px-2 py-1 text-xs text-background group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 ease-out whitespace-nowrap pointer-events-none">
                    {item.label}
                  </span>
                </motion.button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Bottom Profile / User Avatar */}
      <div
        className={`flex flex-col items-center ${
          isDenseModuleSet
            ? "gap-1 [@media(min-height:860px)]:gap-1.5 pt-1.5 mt-1"
            : "gap-1.5 xl:gap-2.5 pt-2 mt-1"
        } shrink-0 border-t border-line/40 w-full relative z-20 bg-background/95 backdrop-blur-xs`}
      >
        {/* Dica de Atalhos de Teclado — em modo denso (10+ módulos), exibe o ícone avulso apenas em telas altas (>=860px) para nunca espremer os módulos nem cortar o avatar */}
        <div
          data-tour="profile.keyboard-shortcuts"
          className={`relative ${
            isDenseModuleSet ? "hidden [@media(min-height:860px)]:grid" : "grid"
          } h-7 w-7 md:h-8 md:w-8 place-items-center rounded-lg md:rounded-xl text-muted-foreground/60 hover:text-primary hover:bg-primary-soft/40 transition-colors group cursor-help shrink-0`}
          aria-label="Navegação por Teclado: Setas ↑/↓ para módulos · Setas ←/→ para abas"
        >
          <Keyboard className="h-3.5 w-3.5 md:h-4 md:w-4" />
          <span className="absolute left-[calc(100%+14px)] md:left-[calc(100%+22px)] bottom-0 scale-0 opacity-0 rounded-xl bg-foreground px-3 py-1.5 text-[11px] font-semibold text-background group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 ease-out whitespace-nowrap pointer-events-none shadow-lg z-50">
            Setas ↑ / ↓ : Módulos <br /> Setas ← / → : Abas
          </span>
        </div>

        <ProfilePopover side="right" align="end" sideOffset={14}>
          <button
            data-tour="profile.trigger"
            className={`relative block ${
              isDenseModuleSet
                ? "h-8 w-8 md:h-9 md:w-9 [@media(min-height:860px)]:h-10 [@media(min-height:860px)]:w-10"
                : "h-8 w-8 md:h-10 md:w-10"
            } rounded-full cursor-pointer group transition-transform hover:scale-105 active:scale-95 shrink-0`}
            aria-label="Editar Meu Perfil"
          >
            <img
              src={operatorProfile.avatar}
              alt={operatorProfile.name}
              className="h-full w-full rounded-full object-cover border border-border"
            />
            <span className={`absolute bottom-0 right-0 h-2 w-2 md:h-2.5 md:w-2.5 rounded-full border border-card ${
              operatorProfile.status === "disponivel"
                ? "bg-primary"
                : operatorProfile.status === "pausa"
                ? "bg-amber-500"
                : "bg-gray-400"
            }`} />
            {/* Floating tooltip */}
            <span className="absolute left-[calc(100%+14px)] md:left-[calc(100%+20px)] bottom-0 scale-0 opacity-0 rounded-xl bg-foreground px-3 py-1.5 text-xs font-semibold text-background group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 ease-out whitespace-nowrap pointer-events-none shadow-lg z-50 text-left">
              Editar Meu Perfil
              {isDenseModuleSet && (
                <span className="block text-[10px] font-normal opacity-80 mt-0.5">
                  Atalhos: ↑/↓ Módulos · ←/→ Abas
                </span>
              )}
            </span>
          </button>
        </ProfilePopover>
      </div>
    </aside>
  );
}
