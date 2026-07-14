// ══════════════════════════════════════════════════════════════════════════════
// 🔒 VENDEDOR TAB — Placeholder "Em breve" com roadmap
// ══════════════════════════════════════════════════════════════════════════════

import React from "react";
import { motion } from "framer-motion";
import { Lock, ShoppingBag, ArrowRight, FileText, RefreshCw, TrendingUp } from "lucide-react";

export function VendedorTab() {
  const roadmap = [
    {
      icon: FileText,
      title: "Propostas Automáticas",
      desc: "Geração inteligente de propostas personalizadas com base no perfil do lead.",
    },
    {
      icon: RefreshCw,
      title: "Follow-ups Inteligentes",
      desc: "Sequências automáticas de follow-up com timing otimizado por IA.",
    },
    {
      icon: TrendingUp,
      title: "Previsão de Conversão",
      desc: "Score preditivo de probabilidade de fechamento para cada lead no pipeline.",
    },
  ];

  return (
    <div className="flex items-center justify-center h-full">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        className="flex flex-col items-center max-w-md w-full"
      >
        {/* Ícone central */}
        <div className="grid h-20 w-20 place-items-center rounded-3xl bg-muted border border-border shadow-soft mb-5">
          <Lock className="h-8 w-8 text-muted-foreground/60" />
        </div>

        {/* Título e descrição */}
        <div className="flex items-center gap-2 mb-2">
          <ShoppingBag className="h-5 w-5 text-violet-600" />
          <h2 className="text-lg font-extrabold text-foreground">Agente Vendedor</h2>
        </div>
        <p className="text-sm text-muted-foreground font-medium text-center">
          Em desenvolvimento — em breve disponível
        </p>
        <p className="text-xs text-muted-foreground/70 text-center mt-2 leading-relaxed max-w-sm">
          O Agente Vendedor será responsável por automatizar o processo de vendas,
          desde a geração de propostas até o acompanhamento inteligente dos leads
          qualificados pelo SDR.
        </p>

        {/* Roadmap preview */}
        <div className="w-full mt-8 space-y-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center mb-3">
            Funcionalidades Planejadas
          </p>
          {roadmap.map((item, idx) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.1 + idx * 0.08 }}
                className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft"
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-600">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-foreground">{item.title}</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">{item.desc}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
