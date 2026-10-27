import { useEffect, useRef } from "react";
import { onboardingRegistry } from "@/lib/onboarding/registry";
import type { TourCommand, TourSurfaceId } from "@/lib/onboarding/types";
import { useOptionalOnboarding } from "./useOnboarding";

/**
 * Registers a component surface adapter with the OnboardingSurfaceRegistry
 * scoped by tenantId, operatorId, and active runId.
 * Automatically unregisters on unmount or when tenant/operator/runId changes.
 */
export function useOnboardingAdapter(
  surface: TourSurfaceId,
  onCommand: (command: TourCommand) => void | Promise<void>,
  reset?: () => void,
): void {
  const onboarding = useOptionalOnboarding();
  const handlerRef = useRef(onCommand);
  const resetRef = useRef(reset);

  handlerRef.current = onCommand;
  resetRef.current = reset;

  const tenantId =
    onboarding?.progress?.tenantId ??
    onboarding?.eligibilityContext.tenantId ??
    "";
  const operatorId =
    onboarding?.progress?.operatorId ??
    onboarding?.eligibilityContext.operatorId ??
    "";
  const runId = onboarding?.progress?.runId ?? "";

  useEffect(() => {
    if (!tenantId || !operatorId || !runId) return;

    const unregister = onboardingRegistry.register({
      tenantId,
      operatorId,
      runId,
      surface,
      ready: true,
      onCommand: (cmd: TourCommand) => handlerRef.current(cmd),
      cleanup: () => resetRef.current?.(),
    });

    return () => {
      unregister();
    };
  }, [tenantId, operatorId, runId, surface]);
}
