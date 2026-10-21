import { readSiteContext } from "@/lib/livechat/site-context";

const campaignLabels: Record<string, string> = {
  utm_source: "Origem",
  utm_medium: "Meio",
  utm_campaign: "Campanha",
  utm_content: "Conteúdo",
  utm_term: "Termo",
};
export function SiteContextPanel({ context }: { context: unknown }) {
  const value = readSiteContext(context);
  if (!value) return null;
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
      className="rounded-lg border border-border p-3 space-y-2 text-xs"
      aria-label="Origem e contexto do site"
    >
      <h4 className="font-semibold">Origem e contexto do site</h4>
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
        <div className="border-t pt-2 space-y-1">
          <p className="font-medium">Última consulta de produto</p>
          <p>{link(value.product.url, value.product.name || "Produto consultado")}</p>
          {value.product.sku && <p>SKU informado: {value.product.sku}</p>}
          {value.product.category && <p>Categoria informada: {value.product.category}</p>}
        </div>
      )}
      <p className="text-muted-foreground">
        Informações declaradas pelo navegador. Navegação e consulta de produto não confirmam compra
        ou adequação técnica.
      </p>
    </section>
  );
}
