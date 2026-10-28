import { useLocation, useNavigate } from "@tanstack/react-router";
import { useChat } from "@/hooks/useChatState";
import { useTrainingSurface } from "@/hooks/useTrainingSurface";
import type { TrainingFrameElement } from "@/lib/onboarding/frame-types";
import { buildAppRoutePath } from "@/lib/app-routes";

/** Opens the existing screen inside the demo iframe; the parent screen is untouched. */
export function TrainingNavigation() {
  const chat = useChat(), location = useLocation(), navigate = useNavigate();
  useTrainingSurface("navigation", (step) => {
    if (!chat.isAuthenticated || chat.isRestoringSession) return false;
    const config = (window.frameElement as TrainingFrameElement | null)?.trainingConfig;
    if (!config) return false;
    const detail = step.surface.startsWith("crm.deal") || step.id === "tasks.reschedule" || step.id === "crm.file-preview";
    const view = detail ? "crm" : step.view;
    const path = detail ? `/crm/deals/${encodeURIComponent(config.store.primaryDealId)}` : buildAppRoutePath(view);
    if (chat.activeView !== view) chat.setActiveView(view);
    if (location.pathname !== path && !(view === "chat" && location.pathname.startsWith("/chat/"))) void navigate({ to: path as never, replace: true });
    const profile = step.chapterId === "profile" && !["profile.entry", "profile.quick-status", "profile.status-help", "profile.keyboard", "profile.mobile", "profile.notifications"].includes(step.id);
    if (chat.isProfileModalOpen !== profile) chat.setIsProfileModalOpen(profile);
    if (view === "chat") {
      const assistant = step.surface === "chat.assistant" || ["chat.message-source", "chat.message-source-states"].includes(step.id);
      const queue = step.id === "chat.queue-all" || step.id === "chat.other-owner" ? "todos" : step.id === "chat.queue-waiting" || step.id === "chat.capture" ? "fila" : step.id === "chat.queue-bot" ? "automacao" : step.id === "chat.queue-closed" || step.id === "chat.reopen" ? "finalizados" : "meus";
      const selected = step.id === "profile.mobile" ? null : assistant ? "valentina" : step.id === "chat.other-owner" ? "demo:conv-3" : queue === "fila" ? "demo:conv-2" : queue === "automacao" ? "demo:conv-4" : queue === "finalizados" ? "demo:conv-5" : config.store.conversations[0].id;
      if (chat.activeQueue !== queue) chat.setActiveQueue(queue);
      if (chat.selectedChatId !== selected) chat.setSelectedChatId(selected);
      const details = step.surface === "chat.details-panel" || step.surface === "chat.journey-modal";
      if (chat.rightSidebarOpen !== details) chat.setRightSidebarOpen(details);
      if (chat.activeQueue !== queue || chat.selectedChatId !== selected || chat.rightSidebarOpen !== details) return false;
    }
    return chat.activeView === view && chat.isProfileModalOpen === profile && (location.pathname === path || (view === "chat" && (location.pathname === "/chat" || location.pathname.startsWith("/chat/"))));
  });
  return null;
}
