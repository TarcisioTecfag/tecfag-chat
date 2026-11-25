import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronUp, Globe } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { SystemTooltip } from "@/components/ui/tooltip";
import { readSiteContext } from "@/lib/livechat/site-context";

const campaignLabels: Record<string, string> = {
  utm_source: "Origem",
  utm_medium: "Meio",
  utm_campaign: "Campanha",
  utm_content: "Conteúdo",
  utm_term: "Termo",
};

export interface SiteContextPanelProps {
  context: unknown;
  defaultExpanded?: boolean;
}

export function SiteContextPanel({ context, defaultExpanded = false }: SiteContextPanelProps) {
  const value = readSiteContext(context);
  const contentId = useId();
  const contextKey = value
    ? `${value.capturedAt}|${value.entry.url}|${value.page.url}|${value.product?.url ?? ""}`
    : "";
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [contextKey, defaultExpanded]);

  if (!value) return null;

  const summaryParts = [
    value.entry.utm.utm_source || value.entry.utm.utm_campaign || "",
    value.product?.name || value.page.title || value.entry.title || "",
  ].filter(Boolean);
  const summaryText =
    summaryParts.length > 0
      ? summaryParts.join(" · ")
      : "Clique para ver página, origem e campanha";

  const link = (url: string, label: string) => (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline break-all"
    >
      {label || url}
    </a>
  );

  return (
    <section
      className="rounded-xl border border-border bg-card/60 p-2.5 text-xs"
      aria-label="Origem e contexto do site"
    >
      <SystemTooltip
        content={
          expanded ? "Recolher origem e contexto do site" : "Expandir origem e contexto do site"
        }
      >
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-controls={contentId}
          className="group w-full flex items-center justify-between gap-2 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-6 w-6 rounded-lg flex items-center justify-center shrink-0 bg-primary/10 text-primary">
              <Globe className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-semibold text-foreground truncate">
                Origem e contexto do site
              </h4>
              <p className="text-[10px] text-muted-foreground truncate">{summaryText}</p>
            </div>
          </div>

          <span
            aria-hidden="true"
            className="p-1 rounded-lg text-muted-foreground group-hover:text-foreground group-hover:bg-muted transition shrink-0"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        </button>
      </SystemTooltip>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={contentId}
            key="site-context-details"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-2 mt-2 border-t border-border/60 space-y-2 max-h-60 overflow-y-auto pr-1 scrollbar-thin">
              <p>Página de entrada: {link(value.entry.url, value.entry.title)}</p>
              <p>Página no atendimento: {link(value.page.url, value.page.title)}</p>
              {value.entry.referrer && (
                <p>Referência: {link(value.entry.referrer, value.entry.referrer)}</p>
              )}
              {Object.entries(value.entry.utm).map(([key, item]) => (
                <p key={key} className="break-words">
                  {campaignLabels[key] || key}: {item}
                </p>
              ))}
              {value.product && (
                <div className="border-t border-border/60 pt-2 space-y-1">
                  <p className="font-medium">Última consulta de produto</p>
                  <p>{link(value.product.url, value.product.name || "Produto consultado")}</p>
                  {value.product.sku && <p>SKU informado: {value.product.sku}</p>}
                  {value.product.category && <p>Categoria informada: {value.product.category}</p>}
                </div>
              )}
              <p className="text-muted-foreground">
                Informações declaradas pelo navegador. Navegação e consulta de produto não confirmam
                compra ou adequação técnica.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
