import { Checkbox } from "@/components/ui/checkbox";
import type { CrmPermissions } from "@/lib/rbac";

const controls = [
  ["canViewCrm", "Acessar negociações", "Consultar o CRM da empresa."],
  ["canViewAllDeals", "Consultar negociações de outros operadores", "Sem esta opção, a consulta é limitada ao responsável."],
  ["canCreateDeals", "Criar negociações", "Cadastrar uma nova oportunidade."],
  ["canEditDeals", "Editar informações da negociação", "Alterar os dados comerciais permitidos."],
  ["canMoveStages", "Mover etapas", "Movimentar oportunidades entre etapas."],
  ["canCloseDeals", "Fechar negociações", "Marcar como ganha ou perdida."],
  ["canManagePipelines", "Gerenciar funis e etapas", "Criar e configurar os funis da empresa."],
  ["canManageProducts", "Gerenciar catálogo de produtos", "Criar e alterar produtos do catálogo."],
  ["canManageProposals", "Gerenciar propostas", "Criar propostas e alterar seu status."],
  ["canDeleteDeals", "Excluir negociações", "Enviar à lixeira ou excluir permanentemente; editar não concede este direito."],
  ["canExportDeals", "Exportar negociações", "Exportar somente os registros que o operador pode consultar."],
] as const satisfies ReadonlyArray<readonly [keyof CrmPermissions, string, string]>;

export function CrmGroupPermissions({ permissions, search, onChange }: {
  permissions: CrmPermissions;
  search: string;
  onChange: (key: keyof CrmPermissions, value: boolean) => void;
}) {
  const query = search.trim().toLocaleLowerCase("pt-BR");
  const visible = controls.filter(([, label, description]) => `${label} ${description}`.toLocaleLowerCase("pt-BR").includes(query));
  if (!visible.length) return null;
  return <section className="rounded-2xl border border-border bg-card overflow-hidden">
    <h3 className="px-4 py-3 bg-muted/20 text-xs font-black uppercase tracking-wide">Negociações e funis</h3>
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {visible.map(([key, label, description]) => <label key={key} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-3 cursor-pointer">
        <Checkbox checked={permissions[key] === true} onCheckedChange={(value) => onChange(key, value === true)} />
        <span><span className="text-xs font-bold block">{label}</span><span className="text-[10px] text-muted-foreground block">{description}</span></span>
      </label>)}
    </div>
  </section>;
}
