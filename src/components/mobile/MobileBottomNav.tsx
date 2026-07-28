import React from "react";
import { MessageSquare, Users, Wallet, Sparkles } from "lucide-react";
import { useChat } from "@/hooks/useChatState";

export const MobileBottomNav: React.FC = () => {
  const { activeView, setActiveView, setSelectedChatId, operatorProfile } = useChat();

  const handleTabClick = (viewId: string) => {
    // Ao clicar em qualquer aba inferior (especialmente Atendimentos),
    // reseta selectedChatId para mostrar a lista de conversas primeiro no mobile
    setSelectedChatId(null);
    setActiveView(viewId as any);
  };

  const navItems = [
    {
      id: "valentina",
      label: "Início",
      icon: (
        <div className="relative w-6 h-6">
          <img
            src={operatorProfile?.avatar || "/vendedor.png"}
            alt={operatorProfile?.name || "Usuário"}
            className="w-6 h-6 rounded-full object-cover border border-primary/30"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80";
            }}
          />
          <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-white" />
        </div>
      ),
    },
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
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border px-3 py-2 flex justify-around items-center shadow-lg">
      {navItems.map((item) => {
        const isActive = activeView === item.id;
        return (
          <button
            key={item.id}
            onClick={() => handleTabClick(item.id)}
            className={`flex flex-col items-center justify-center flex-1 py-1 px-2 transition-all cursor-pointer ${
              isActive
                ? "text-primary font-bold"
                : "text-muted-foreground hover:text-foreground font-medium"
            }`}
          >
            <div className={`transition-transform duration-200 ${isActive ? "scale-110" : ""}`}>
              {item.icon}
            </div>
            <span
              className={`text-[11px] mt-1 tracking-tight ${
                isActive ? "text-primary font-bold" : "text-muted-foreground"
              }`}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
