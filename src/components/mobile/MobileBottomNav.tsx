import React from "react";
import { BriefcaseBusiness, House, MessageSquare, Users, Wallet } from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { usePermissions } from "@/hooks/usePermissions";
import { motion } from "framer-motion";

export const MobileBottomNav: React.FC = () => {
  const { activeView, setActiveView, setSelectedChatId, operatorProfile, sessionRole, tenant, isCommercialConsultant } = useChat();
  const { canAccessView } = usePermissions();

  const handleTabClick = (viewId: string) => {
    setSelectedChatId(null);
    setActiveView(viewId as any);
  };

  const navItems = [
    ...(tenant === "tecfag" && isCommercialConsultant
      ? [
          {
            id: "commercialHome",
            label: "Início",
            icon: <House className="w-5 h-5 stroke-[2.2]" />,
          },
        ]
      : tenant !== "tecfag"
      ? [
          {
            id: "valentina",
            label: "Início",
            icon: (
              <div className="relative w-5.5 h-5.5">
                <img
                  src={operatorProfile?.avatar || "/vendedor.png"}
                  alt={operatorProfile?.name || "Usuário"}
                  className="w-5.5 h-5.5 rounded-full object-cover border border-primary/30"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80";
                  }}
                />
                <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-white" />
              </div>
            ),
          },
        ]
      : []),
    {
      id: "chat",
      label: "Atendimentos",
      icon: <MessageSquare className="w-5 h-5 stroke-[2.2]" />,
    },
    {
      id: "contacts",
      label: "Clientes",
      icon: <Users className="w-5 h-5 stroke-[2.2]" />,
    },
    {
      id: "wallet",
      label: "Carteira",
      icon: <Wallet className="w-5 h-5 stroke-[2.2]" />,
    },
    ...(tenant === "tecfag" && sessionRole === "admin" ? [{
      id: "commercialManagement",
      label: "Gestão",
      icon: <BriefcaseBusiness className="w-5 h-5 stroke-[2.2]" />,
    }] : []),
  ].filter((item) => canAccessView(item.id as any));

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border/80 px-2 py-1.5 flex justify-around items-center shadow-lg select-none">
      {navItems.map((item) => {
        const isActive = activeView === item.id;
        return (
          <motion.button
            key={item.id}
            onClick={() => handleTabClick(item.id)}
            whileTap={{ scale: 0.90 }}
            whileHover={{ scale: 1.04 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className={`relative flex flex-col items-center justify-center flex-1 py-1 px-1 transition-colors cursor-pointer rounded-2xl ${
              isActive
                ? "text-primary font-bold"
                : "text-muted-foreground hover:text-foreground font-medium"
            }`}
          >
            {/* Sliding Active Pill */}
            {isActive && (
              <motion.div
                layoutId="mobileNavActiveTab"
                className="absolute inset-0 bg-primary/10 rounded-2xl -z-10 border border-primary/15"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}

            <div className={`transition-transform duration-200 ${isActive ? "scale-110" : ""}`}>
              {item.icon}
            </div>

            <span
              className={`text-[10px] mt-0.5 tracking-tight font-extrabold transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {item.label}
            </span>
          </motion.button>
        );
      })}
    </nav>
  );
};
