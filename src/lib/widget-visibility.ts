/**
 * widget-visibility.ts
 *
 * Define as regras estritas de visibilidade do mini pop-up flutuante 'Conversas' (CrmChatWidget).
 *
 * DIRETRIZ OFICIAL (08/10/2026):
 * 1. O mini pop-up de conversas DEVE aparecer APENAS nos módulos superiores:
 *    - Início (`commercialHome`)
 *    - Negociações (`crm` ou rota de deals `/crm/deals/*`)
 *    - Tarefas (`tasks`)
 *    - Base de Clientes (`contacts`)
 *    - Minha Carteira (`wallet`)
 *
 * 2. O ÚNICO módulo superior onde NÃO deve aparecer é no `chat` (pois já possui a tela de chat completa).
 *
 * 3. NÃO deve aparecer em NENHUM módulo ADM / inferior (abaixo da linha divisória):
 *    - Gestão Comercial (`commercialManagement`)
 *    - War Room (`commercialBi`)
 *    - Valentina / Fagner IA (`valentina`)
 *    - Ligações (`ligacoes`)
 *    - Monitorar (`monitor`)
 *    - Estatísticas (`analytics`)
 *    - Grupo de Acesso (`groups`)
 *    - Ajustes (`settings`)
 *    - Telas de chamada de voz/vídeo (`/call/*`)
 */

export const UPPER_MODULES_WITH_CHAT_WIDGET = [
  "commercialHome",
  "crm",
  "tasks",
  "contacts",
  "wallet",
] as const;

export type UpperModuleWithChatWidget = (typeof UPPER_MODULES_WITH_CHAT_WIDGET)[number];

const UPPER_MODULES_SET = new Set<string>(UPPER_MODULES_WITH_CHAT_WIDGET);

export function shouldShowMiniChatWidget({
  activeView,
  pathname = "/",
  isAuthenticated = true,
  isMobile = false,
}: {
  activeView?: string | null;
  pathname?: string;
  isAuthenticated?: boolean;
  isMobile?: boolean;
}): boolean {
  if (!isAuthenticated || isMobile) return false;

  const currentPath = pathname || "/";

  // Se estiver na rota de chat ou activeView for chat, nunca exibir (chat já tem a interface completa)
  const isChatRoute =
    currentPath === "/chat" ||
    currentPath.startsWith("/chat/") ||
    currentPath.startsWith("/chat");
  if (activeView === "chat" || isChatRoute) {
    return false;
  }

  // Se estiver em rota de chamada, nunca exibir
  if (currentPath.startsWith("/call")) {
    return false;
  }

  // Detalhe de negociação no CRM (/crm/deals/*)
  if (currentPath.startsWith("/crm/deals")) {
    return true;
  }

  // Deve ser estritamente um dos módulos superiores autorizados
  if (!activeView || !UPPER_MODULES_SET.has(activeView)) {
    return false;
  }

  return true;
}
