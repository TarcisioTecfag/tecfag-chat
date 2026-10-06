import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RefreshCw } from "lucide-react";

type Entry = {
  id: string;
  action: string;
  entityType: string;
  operatorName: string;
  itemCount: number;
  details: Record<string, unknown>;
  createdAt: string;
};

const labels: Record<string, string> = {
  delete_permanent: "Exclusão definitiva de negociações",
  delete_trash: "Negociações enviadas à lixeira",
  delete_contact: "Contato excluído",
  archive_account: "Empresa arquivada",
  delete_pipeline: "Funil excluído",
  delete_stage: "Etapa excluída",
  delete_product: "Produto excluído",
  delete_catalog_item: "Item de catálogo excluído",
  delete_custom_field: "Campo de cadastro excluído",
  delete_group: "Grupo de acesso excluído",
  delete_sector: "Setor excluído",
  delete_quick_response: "Resposta rápida excluída",
  delete_template: "Modelo de mensagem excluído",
  delete_operator: "Operador excluído",
  delete_voice_objective: "Objetivo de voz excluído",
  delete_voice_appointment: "Agendamento de voz excluído",
  delete_deal_activity: "Atividade de negociação excluída",
  delete_deal_product: "Produto removido da negociação",
  delete_deal_file: "Arquivo de negociação excluído",
  delete_knowledge_file: "Arquivo da base de conhecimento excluído",
  delete_knowledge_folder: "Pasta da base de conhecimento excluída",
  delete_meta_template: "Modelo da Meta excluído",
  bulk_update: "Negociações alteradas em massa",
  create_deals_for_companies: "Negociações criadas em massa",
  create_tasks: "Tarefas criadas em massa",
  reset_tenant: "Reinicialização de dados",
  bulk_voice_appointments: "Agendamentos de voz importados em massa",
  export: "Relatório exportado",
};

function summary(entry: Entry) {
  const details = entry.details || {};
  if (typeof details.filename === "string") return details.filename;
  if (Array.isArray(details.deals)) {
    return details.deals.slice(0, 3).map((deal: any) => deal.title || deal.id).join(", ") +
      (details.deals.length > 3 ? ` e mais ${details.deals.length - 3}` : "");
  }
  if (typeof details.name === "string") return details.name;
  return null;
}

export function CrmActionHistoryModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [kind, setKind] = useState("all");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (offset: number, append: boolean) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ offset: String(offset) });
      if (kind !== "all") params.set("kind", kind);
      const response = await fetch(`/api/crm/action-history?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Não foi possível carregar o histórico.");
      const data = await response.json();
      setEntries((current) => append ? [...current, ...data.entries] : data.entries);
      setHasMore(data.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao carregar o histórico.");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    if (isOpen) void load(0, false);
  }, [isOpen, load]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Histórico de ações</DialogTitle>
          <DialogDescription>Exclusões, ações em massa e exportações realizadas nesta empresa.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <select aria-label="Filtrar histórico" value={kind} onChange={(event) => setKind(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
            <option value="all">Todas as ações</option>
            <option value="deletion">Exclusões</option>
            <option value="bulk">Ações em massa</option>
            <option value="export">Exportações</option>
          </select>
          <button type="button" onClick={() => void load(0, false)} aria-label="Atualizar histórico" className="rounded-lg border border-border p-2 hover:bg-muted" disabled={loading}>
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {!loading && !error && entries.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma ação registrada.</p>}
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <strong>{labels[entry.action] || entry.action}</strong>
                <time className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString("pt-BR")}</time>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{entry.operatorName} · {entry.itemCount} {entry.itemCount === 1 ? "item" : "itens"}</p>
              {summary(entry) && <p className="mt-2 break-words text-xs">{summary(entry)}</p>}
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-primary">Ver detalhes</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2">{JSON.stringify(entry.details, null, 2)}</pre>
              </details>
            </div>
          ))}
          {loading && <div className="flex justify-center py-5"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {hasMore && !loading && <button type="button" onClick={() => void load(entries.length, true)} className="w-full rounded-lg border border-border p-2 text-xs font-semibold hover:bg-muted">Carregar mais</button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
