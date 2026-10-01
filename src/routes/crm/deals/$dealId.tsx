import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { Login } from "@/components/chat/Login";
import { DealDetailModal } from "@/components/crm/DealDetailModal";

export const Route = createFileRoute("/crm/deals/$dealId")({
  validateSearch: (search: Record<string, unknown>) => ({
    from: search.from === "chat" ? ("chat" as const) : ("crm" as const),
  }),
  component: DealPage,
});

function DealPage() {
  const { dealId } = Route.useParams();
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  const { tenant, isAuthenticated, setActiveView, setSelectedChatId } = useChat();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [pipelines, setPipelines] = useState<
    Array<{ id: string; stages: Array<{ id: string; name: string; orderIndex: number }> }>
  >([]);
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!authorized && !isAuthenticated) return;
    Promise.all([
      fetch("/api/crm/pipelines").then((response) =>
        response.ok ? response.json() : { pipelines: [] },
      ),
      fetch("/api/operators").then((response) =>
        response.ok ? response.json() : { operators: [] },
      ),
    ])
      .then(([pipelineData, operatorData]) => {
        setPipelines(pipelineData.pipelines || []);
        setOperators(Array.isArray(operatorData) ? operatorData : operatorData.operators || []);
      })
      .catch(() => {});
  }, [authorized, isAuthenticated]);

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
    setActiveView(from === "chat" ? "chat" : "crm");
    navigate({ to: "/" });
  };

  const openConversation = (conversationId: string) => {
    setSelectedChatId(conversationId);
    setActiveView("chat");
    navigate({ to: "/" });
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
