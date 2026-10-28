import React, { useCallback, useEffect, useRef, useState } from "react";
import { useOnboarding } from "@/hooks/useOnboarding";
import { createTrainingStore } from "@/lib/onboarding/frame-store";
import type { TrainingFrameBridge, TrainingFrameConfig, TrainingFrameElement } from "@/lib/onboarding/frame-types";
import type { TourTargetState } from "@/hooks/useTourTarget";
import { mapTrainingRect } from "@/lib/onboarding/frame-geometry";

export function OnboardingWorkspace({ onTargetChange }: { onTargetChange: (state: TourTargetState) => void }) {
  const tour = useOnboarding();
  if (!tour.isRunnerActive || !tour.currentStep || !tour.progress?.runId) return null;
  return <WorkspaceSession key={tour.progress.runId} onTargetChange={onTargetChange} />;
}
function WorkspaceSession({ onTargetChange }: { onTargetChange: (state: TourTargetState) => void }) {
  const tour = useOnboarding(), handlers = useRef({ tour, onTargetChange }); handlers.current = { tour, onTargetChange };
  const iframe = useRef<TrainingFrameElement | null>(null), bridge = useRef<TrainingFrameBridge | null>(null);
  const [status, setStatus] = useState("Abrindo as telas do treinamento…");
  const [config] = useState<TrainingFrameConfig>(() => {
    const { progress, eligibilityContext: ctx, operatorFirstName } = tour;
    if (!progress?.runId || !ctx.permissions) throw Error("Treinamento sem identidade ou permissões.");
    const store = createTrainingStore({ tenantId: progress.tenantId, operatorId: progress.operatorId,
      operatorName: `${operatorFirstName} (treinamento)`, role: ctx.role || "operator", permissions: ctx.permissions,
      allowedChannels: [...(ctx.allowedChannels || [])], isCommercialConsultant: ctx.isCommercialConsultant === true });
    return { ...store, store, runId: progress.runId,
      onReady: (next) => { bridge.current?.dispose(); bridge.current = next; const step = handlers.current.tour.currentStep; if (step) void next.prepare(step); setStatus("Treinamento • dados fictícios"); },
      onTarget: (element) => {
        const frame = iframe.current;
        if (!element || !frame || element.ownerDocument !== frame.contentDocument || !element.isConnected) { handlers.current.onTargetChange({ element: null, rect: null, found: false }); return; }
        const r = element.getBoundingClientRect(), f = frame.getBoundingClientRect();
        const rect = mapTrainingRect(r, f, frame.clientWidth, frame.clientHeight);
        const dialog = element.closest('[role="dialog"]')?.getBoundingClientRect();
        const avoidRect = dialog ? mapTrainingRect(dialog, f, frame.clientWidth, frame.clientHeight) : null;
        handlers.current.onTargetChange({ element, found: !!rect, rect, avoidRect });
      },
      onReceipt: (stepId, runId) => handlers.current.tour.satisfyCurrentInteractiveStep(stepId, runId),
      onReplay: () => { const current = handlers.current.tour; if (current.currentStep?.id === "profile.replay") { current.satisfyCurrentInteractiveStep(current.currentStep.id, progress.runId!); current.openTourEntryModal(); } },
      onError: (error) => { handlers.current.tour.setTargetNotFoundReason(error); if (error) setStatus(error); else setStatus("Treinamento • dados fictícios"); },
    };
  });
  const attach = useCallback((node: HTMLIFrameElement | null) => {
    iframe.current = node as TrainingFrameElement | null;
    if (node) {
      const frame = node as TrainingFrameElement; frame.trainingConfig = config;
      // Set context before starting a request, so the child cannot mount without its guard.
      frame.src = "/chat/assistente";
    }
  }, [config]);
  useEffect(() => {
    const step = tour.currentStep; if (step && bridge.current) void bridge.current.prepare(step);
    handlers.current.onTargetChange({ element: null, rect: null, found: false });
  }, [tour.currentStep?.id]);
  useEffect(() => () => { bridge.current?.dispose(); handlers.current.onTargetChange({ element: null, rect: null, found: false }); }, []);
  const mobile = tour.currentStep?.id === "profile.mobile";
  return <section aria-label="Telas do sistema em treinamento" className="fixed inset-0 z-[10080] flex flex-col bg-background text-foreground">
    <header className="flex min-h-9 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 py-1 text-xs">
      <span data-tour="welcome.dialog welcome.practice" className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" />{status}</span>
      <button type="button" onClick={() => void tour.pauseTour()} className="rounded-lg border border-border px-3 py-1">Pausar treinamento</button>
    </header>
    <div className="flex min-h-0 flex-1 justify-center overflow-hidden bg-muted/20">
      <iframe ref={attach} data-onboarding-frame="true" title="Sistema com dados fictícios para treinamento"
        className="h-full border-0 bg-background" style={{ width: mobile ? "min(390px, 100%)" : "100%" }}
        sandbox="allow-scripts allow-same-origin allow-forms" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-write 'none'" />
    </div>
  </section>;
}
