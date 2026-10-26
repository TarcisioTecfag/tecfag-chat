import React from "react";
import { ShoppingBag, Wrench, HelpCircle, ChevronRight } from "lucide-react";

interface ModuleSelectionProps {
  onSelectModule: (moduleName: string) => void;
}

export const ModuleSelection: React.FC<ModuleSelectionProps> = ({ onSelectModule }) => {
  const modules = [
    {
      id: "orcamento",
      title: "Orçamento de Máquinas",
      description: "Seladoras, envasadoras, datadores e mais",
      icon: ShoppingBag,
      color: "text-[#E50914]",
      bgColor: "bg-red-50",
      borderColor: "hover:border-red-300",
    },
    {
      id: "suporte",
      title: "Suporte Técnico / Peças",
      description: "Assistência técnica e peças de reposição",
      icon: Wrench,
      color: "text-amber-600",
      bgColor: "bg-amber-50",
      borderColor: "hover:border-amber-300",
    },
    {
      id: "duvidas",
      title: "Outras Dúvidas",
      description: "Prazo de entrega, garantia, informações gerais",
      icon: HelpCircle,
      color: "text-neutral-700",
      bgColor: "bg-neutral-100",
      borderColor: "hover:border-neutral-400",
    },
  ];

  return (
    <div className="my-4 space-y-2.5 message-enter">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1 mb-2">
        Selecione uma opção para agilizar:
      </p>
      <div className="grid gap-2">
        {modules.map((mod) => {
          const Icon = mod.icon;
          return (
            <button
              key={mod.id}
              onClick={() => onSelectModule(mod.title)}
              className={`flex items-center justify-between p-3 rounded-xl bg-white border border-slate-200/80 shadow-sm transition-all duration-200 hover:shadow-md ${mod.borderColor} group text-left w-full`}
            >
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-lg ${mod.bgColor} ${mod.color} transition-transform group-hover:scale-105`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-800 group-hover:text-[#E50914] transition-colors">
                    {mod.title}
                  </h4>
                  <p className="text-xs text-slate-500 line-clamp-1">{mod.description}</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-transform group-hover:translate-x-0.5 flex-shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
};
