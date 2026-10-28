import { useEffect, useRef } from "react";
import type { TourStep } from "@/lib/onboarding/types";
import { registerTrainingSurface } from "@/lib/onboarding/frame-controller";

/** Registers the existing component's own controls only inside the isolated training frame. */
export function useTrainingSurface(name: string, prepare: (step: TourStep) => boolean | void) {
  const current = useRef(prepare); current.current = prepare;
  useEffect(() => registerTrainingSurface(window, name, (step) => current.current(step)), [name]);
}
