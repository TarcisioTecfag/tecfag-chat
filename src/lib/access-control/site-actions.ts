import type { ChatPermissions } from "../rbac";
export type SiteOperatorAction = "operator_message" | "take_over" | "release_to_ai" | "close_chat";
export function canPerformSiteAction(operatorId: string, chat: { operatorId: string | null; status: string },
  action: SiteOperatorAction, permissions: Partial<ChatPermissions>): boolean {
  const owner = chat.operatorId === operatorId;
  switch (action) {
    case "operator_message": return owner && chat.status === "operator_took_over";
    case "take_over": return !!chat.operatorId && !owner ? permissions.canOverrideChat === true : permissions.canCaptureChat === true;
    case "release_to_ai": return owner && permissions.canTransferChat === true;
    case "close_chat": return owner && permissions.canFinishChat === true;
    default: return false;
  }
}
