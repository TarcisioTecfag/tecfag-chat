import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Tenant = { id: string; name: string };
type GlobalGroup = { id: string; name: string; allowedTenants: string[] };
type GlobalAccount = { id: string; email: string; groupId: string | null; homeTenantId: string };
type LocalGroup = { id: string; name: string };
type Member = {
  id: string;
  accountId: string | null;
  tenantId: string;
  name: string;
  role: string;
  groupId: string | null;
};
type AccessData = {
  tenants: Tenant[];
  groups: GlobalGroup[];
  accounts: GlobalAccount[];
  localGroups: Record<string, LocalGroup[]>;
  memberships: Record<string, Member[]>;
};

const API = `${import.meta.env.VITE_BACKEND_URL || ""}/api/platform/access`;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Ocorreu um erro ao atualizar o acesso.";

export function MultiTenantAccessPanel() {
  const { tenant, operators, currentOperatorId } = useChat();
  const [data, setData] = useState<AccessData | null>(null);
  const [groupId, setGroupId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupTenants, setGroupTenants] = useState<string[]>([]);
  const [operatorId, setOperatorId] = useState("");
  const [localGroupIds, setLocalGroupIds] = useState<Record<string, string>>({});
  const [targetRoles, setTargetRoles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const response = await fetch(API, { credentials: "include" });
    if (response.status === 403) return;
    if (!response.ok) throw new Error("Não foi possível carregar os acessos multiempresa.");
    const next: AccessData = await response.json();
    setData(next);
  };

  useEffect(() => {
    refresh().catch((error) => toast.error(error.message));
  }, [tenant]);
  if (!data) return null;

  const selectedGroup = data.groups.find((group) => group.id === groupId);
  const targets = (selectedGroup?.allowedTenants ?? []).filter((id) => id !== tenant);
  const post = async (payload: Record<string, unknown>) => {
    const response = await fetch(API, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    return { response, result };
  };

  const saveGroup = async () => {
    setBusy(true);
    try {
      const { response, result } = await post({
        action: "save-group",
        id: groupId || undefined,
        name: groupName,
        allowedTenants: groupTenants,
      });
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar o grupo.");
      const ownEmail = operators.find((operator) => operator.id === currentOperatorId)?.email;
      if (
        groupId &&
        data.accounts.some((account) => account.groupId === groupId && account.email === ownEmail)
      ) {
        window.location.reload();
        return;
      }
      await refresh();
      setGroupId(result.id);
      toast.success("Grupo multiempresa salvo.");
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const assignMember = async (confirmExisting = false) => {
    setBusy(true);
    try {
      const payload = {
        action: "assign-member",
        operatorId,
        groupId,
        localGroupIds,
        targetRoles,
        confirmExisting,
      };
      const { response, result } = await post(payload);
      if (response.status === 409 && result.existingOperator && !confirmExisting) {
        const existing = result.existingOperator;
        const confirmed = window.confirm(
          `Já existe ${existing.name} (${existing.role}) em ${existing.tenantId}. Vincular este operador à mesma conta de login?`,
        );
        if (confirmed) {
          setBusy(false);
          await assignMember(true);
        }
        return;
      }
      if (!response.ok) throw new Error(result.error || "Não foi possível adicionar a pessoa.");
      await refresh();
      toast.success("Acesso multiempresa atualizado.");
      if (operatorId === currentOperatorId) window.location.reload();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (account: GlobalAccount) => {
    if (
      !window.confirm(
        `Remover ${account.email} do grupo multiempresa? O acesso ao tenant de origem continuará disponível.`,
      )
    )
      return;
    setBusy(true);
    try {
      const { response, result } = await post({ action: "remove-member", accountId: account.id });
      if (!response.ok) throw new Error(result.error || "Não foi possível remover o acesso.");
      if (
        account.email === operators.find((operator) => operator.id === currentOperatorId)?.email
      ) {
        window.location.reload();
        return;
      }
      await refresh();
      toast.success("Acesso adicional removido.");
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lg:col-span-3 rounded-2xl border border-primary/30 bg-primary-soft/10 p-5 space-y-5">
      <div>
        <h3 className="text-sm font-extrabold">Acesso multiempresa</h3>
        <p className="text-xs text-muted-foreground">
          O grupo autoriza a troca de empresa. Cada pessoa mantém as permissões locais de cada
          sistema.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end">
        <div className="space-y-1">
          <label className="text-xs font-semibold block">Grupo global</label>
          <Select
            value={groupId || "__new__"}
            onValueChange={(val) => {
              const id = val === "__new__" ? "" : val;
              const group = data.groups.find((item) => item.id === id);
              setGroupId(id);
              setGroupName(group?.name ?? "");
              setGroupTenants(group?.allowedTenants ?? []);
            }}
          >
            <SelectTrigger className="w-full bg-card">
              <SelectValue placeholder="Novo grupo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__new__">Novo grupo</SelectItem>
              {data.groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="text-xs font-semibold">
          Nome do grupo
          <input
            className="mt-1 w-full rounded-lg border bg-card p-2"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="Acesso Valem + Tecfag"
          />
        </label>
        <button
          disabled={busy || !groupName || groupTenants.length === 0}
          onClick={saveGroup}
          className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
        >
          Salvar grupo
        </button>
      </div>
      <div className="flex flex-wrap gap-4">
        {data.tenants.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-xs cursor-pointer">
            <Checkbox
              checked={groupTenants.includes(item.id)}
              onCheckedChange={(checked) =>
                setGroupTenants((current) =>
                  checked
                    ? [...current, item.id]
                    : current.filter((id) => id !== item.id),
                )
              }
            />
            {item.name}
          </label>
        ))}
      </div>

      {selectedGroup && selectedGroup.allowedTenants.includes(tenant) && (
        <div className="space-y-3 border-t pt-4">
          <h4 className="text-xs font-bold">Adicionar ou alterar uma pessoa neste grupo</h4>
          <Select
            value={operatorId || "__none__"}
            onValueChange={(val) => setOperatorId(val === "__none__" ? "" : val)}
          >
            <SelectTrigger className="w-full bg-card text-xs">
              <SelectValue placeholder={`Selecione um usuário de ${tenant}`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Selecione um usuário de {tenant}</SelectItem>
              {operators.map((operator) => (
                <SelectItem key={operator.id} value={operator.id}>
                  {operator.name} — {operator.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {targets.map((targetTenant) => (
            <div key={targetTenant} className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold block">Papel em {targetTenant}</label>
                <Select
                  value={targetRoles[targetTenant] || "__none__"}
                  onValueChange={(val) =>
                    setTargetRoles((current) => ({
                      ...current,
                      [targetTenant]: val === "__none__" ? "" : val,
                    }))
                  }
                >
                  <SelectTrigger className="w-full bg-card text-xs">
                    <SelectValue placeholder="Manter atual; novo operador" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Manter atual; novo operador</SelectItem>
                    <SelectItem value="agent">Operador</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold block">Grupo local em {targetTenant}</label>
                <Select
                  value={localGroupIds[targetTenant] || "__none__"}
                  onValueChange={(val) =>
                    setLocalGroupIds((current) => ({
                      ...current,
                      [targetTenant]: val === "__none__" ? "" : val,
                    }))
                  }
                >
                  <SelectTrigger className="w-full bg-card text-xs">
                    <SelectValue
                      placeholder={
                        targetRoles[targetTenant] === "admin"
                          ? "Permissões de administrador"
                          : "Selecione um grupo local"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      {targetRoles[targetTenant] === "admin"
                        ? "Permissões de administrador"
                        : "Selecione um grupo local"}
                    </SelectItem>
                    {(data.localGroups[targetTenant] || []).map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
          <button
            disabled={busy || !operatorId}
            onClick={() => assignMember()}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
          >
            Adicionar ao grupo
          </button>
        </div>
      )}

      <div className="border-t pt-4 space-y-2">
        <h4 className="text-xs font-bold">Pessoas com conta multiempresa</h4>
        {data.accounts
          .filter((account) => account.groupId)
          .map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-xs"
            >
              <div>
                <strong>{account.email}</strong>
                <span className="ml-2 text-muted-foreground">
                  {data.groups.find((group) => group.id === account.groupId)?.name}
                </span>
                <div className="text-muted-foreground">
                  {Object.values(data.memberships)
                    .flat()
                    .filter((member) => member.accountId === account.id)
                    .map((member) => member.tenantId)
                    .join(" · ")}
                </div>
              </div>
              <button
                disabled={busy}
                onClick={() => removeMember(account)}
                className="text-red-600 font-semibold disabled:opacity-50"
              >
                Remover
              </button>
            </div>
          ))}
      </div>
    </section>
  );
}
