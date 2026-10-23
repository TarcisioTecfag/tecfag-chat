import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { Login } from "@/components/chat/Login";
import { DealDetailModal } from "@/components/crm/DealDetailModal";
import { fetchPipelinesCached, getCachedPipelinesSync } from "@/lib/crm/deal-prefetch";

export const Route = createFileRoute("/crm/deals/$dealId")({
  validateSearch: (search: Record<string, unknown>) => ({
    from:
      search.from === "chat"
        ? ("chat" as const)
        : search.from === "valentina"
        ? ("valentina" as const)
        : ("crm" as const),
  }),
  component: DealPage,
});

function DealPage() {
  const { dealId } = Route.useParams();
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  const {
    tenant,
    isAuthenticated,
    operators: globalOperators,
    refreshConversations,
    setActiveView,
    setSelectedChatId,
    activeChat,
  } = useChat();
  const [sessionChecked, setSessionChecked] = useState(() => Boolean(isAuthenticated));
  const [authorized, setAuthorized] = useState(() => Boolean(isAuthenticated));
  const [pipelines, setPipelines] = useState<
    Array<{ id: string; stages: Array<{ id: string; name: string; orderIndex: number }> }>
  >(() => getCachedPipelinesSync() || []);
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>(
    () => (Array.isArray(globalOperators) && globalOperators.length > 0 ? globalOperators : []),
  );

  useEffect(() => {
    if (isAuthenticated) {
      setAuthorized(true);
      setSessionChecked(true);
      return;
    }
    let active = true;
    fetch("/api/auth/session", { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("Sessão inválida");
        return response.json();
      })
      .then(() => {
        if (active) setAuthorized(true);
      })
      .catch(() => {
        if (active) setAuthorized(false);
      })
      .finally(() => {
        if (active) setSessionChecked(true);
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!authorized && !isAuthenticated) return;
    fetchPipelinesCached()
      .then((cachedList) => {
        if (Array.isArray(cachedList)) setPipelines(cachedList);
      })
      .catch(() => {});

    if (Array.isArray(globalOperators) && globalOperators.length > 0) {
      setOperators(globalOperators);
    } else {
      fetch("/api/operators")
        .then((response) => (response.ok ? response.json() : { operators: [] }))
        .then((operatorData) => {
          setOperators(Array.isArray(operatorData) ? operatorData : operatorData.operators || []);
        })
        .catch(() => {});
    }
  }, [authorized, isAuthenticated, globalOperators]);

  const operatorsMap = useMemo(
    () => new Map(operators.map((operator) => [operator.id, operator.name])),
    [operators],
  );
  const stages = pipelines.flatMap((pipeline) => pipeline.stages || []);
  const themeStyles = (
    tenant === "tecfag"
      ? { "--primary": "#df3d3d", "--primary-soft": "rgba(223, 61, 61, 0.15)" }
      : { "--primary": "#2dc4a0", "--primary-soft": "rgba(45, 196, 160, 0.15)" }
  ) as CSSProperties;

  const goBack = () => {
    const targetView = from === "chat" ? "chat" : from === "valentina" ? "valentina" : "crm";
    setActiveView(targetView);
    const targetPath =
      targetView === "chat"
        ? "/chat"
        : targetView === "valentina"
        ? "/ia/rodizio"
        : "/negociacoes/quadro";
    navigate({ to: targetPath as any });
  };

  const openConversation = async (conversationId: string) => {
    await refreshConversations(conversationId);
    setSelectedChatId(conversationId);
    setActiveView("chat");
    navigate({ to: "/chat/$chatKey", params: { chatKey: conversationId } });
  };

  if (!sessionChecked && !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  if (!authorized && !isAuthenticated) return <Login />;

  return (
    <main className="crm-deal-route h-screen overflow-hidden bg-background" style={themeStyles}>
      <DealDetailModal
        isOpen
        dealId={dealId}
        preferredContactId={from === "chat" ? activeChat?.contactId : undefined}
        onClose={goBack}
        onDealUpdated={() => {}}
        onOpenConversation={openConversation}
        pipelineStages={stages}
        operatorsMap={operatorsMap}
        backLabel={from === "chat" ? "Voltar ao atendimento" : "Voltar ao CRM"}
      />
    </main>
  );
}
