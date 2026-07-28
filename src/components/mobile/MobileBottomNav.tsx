import React from "react";
import { Users, ClipboardList, Wallet, BarChart3, Menu } from "lucide-react";
import { useChat } from "@/hooks/useChatState";

export const MobileBottomNav: React.FC = () => {
  const { activeView, setActiveView, operatorProfile } = useChat();

  const navItems = [
    {
      id: "valentina",
      label: "Início",
      icon: (
        <div className="relative w-7 h-7">
          <img
            src={operatorProfile?.avatar || "/vendedor.png"}
            alt={operatorProfile?.name || "Usuário"}
            className="w-7 h-7 rounded-full object-cover border border-gray-200"
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
      icon: <Users className="w-5 h-5 stroke-[2.2]" />,
    },
    {
      id: "tasks",
      label: "Tarefas",
      icon: <ClipboardList className="w-5 h-5 stroke-[2.2]" />,
    },
    {
      id: "wallet",
      label: "Contatos",
      icon: <Wallet className="w-5 h-5 stroke-[2.2]" />,
    },
    {
      id: "analytics",
      label: "Relatórios",
      icon: <BarChart3 className="w-5 h-5 stroke-[2.2]" />,
    },
    {
      id: "settings",
      label: "Mais",
      icon: <Menu className="w-5 h-5 stroke-[2.2]" />,
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-lg border-t border-gray-100 px-2 py-1.5 flex justify-between items-center shadow-lg">
      {navItems.map((item) => {
        const isActive = activeView === item.id;
        return (
          <button
            key={item.id}
            onClick={() => setActiveView(item.id as any)}
            className={`flex flex-col items-center justify-center flex-1 py-1 px-1 transition-all cursor-pointer ${
              isActive ? "text-emerald-600 font-bold" : "text-gray-400 hover:text-gray-600 font-medium"
            }`}
          >
            <div className={`transition-transform duration-200 ${isActive ? "scale-110" : ""}`}>
              {item.icon}
            </div>
            <span className={`text-[10px] mt-1 tracking-tight ${isActive ? "text-emerald-600 font-bold" : "text-gray-500"}`}>
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
