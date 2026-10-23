import { DEFAULT_ADMIN_PERMISSIONS, DEFAULT_DENY_PERMISSIONS } from "../rbac";
import { strictAccessEnabled } from "./rollout";

/** The legacy fallback is retained until explicit tenant rollout. Shared by sessions and push. */
export function effectiveLegacyGroup(group: any, role: string, tenantId: string) {
  if (group) return group;
  const fallback = { id: "group-admin", name: "Administrador", tenantId, allowedTenants: [tenantId],
    allowedChannels: ["whatsapp", "instagram", "messenger", "livechat"], canCreateUser: true, canResetPassword: true,
    canEditProfile: true, canCaptureChat: true, canTransferChat: true, canFinishChat: true, canViewAllChats: true,
    canOverrideChat: true, permissions: DEFAULT_ADMIN_PERMISSIONS };
  if (role === "admin" || !strictAccessEnabled(tenantId)) return fallback;
  return { ...fallback, id: "ungrouped-denied", name: "Sem grupo de acesso", allowedChannels: [],
    canCreateUser: false, canResetPassword: false, canEditProfile: false, canCaptureChat: false, canTransferChat: false,
    canFinishChat: false, canViewAllChats: false, canOverrideChat: false, permissions: DEFAULT_DENY_PERMISSIONS };
}
