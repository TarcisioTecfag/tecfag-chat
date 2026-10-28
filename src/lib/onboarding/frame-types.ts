import type { GroupPermissions } from "@/lib/rbac";
import type { TourStep } from "./types";
import type { TrainingStore } from "./frame-store";

export interface TrainingFrameConfig {
  tenantId: string;
  operatorId: string;
  operatorName: string;
  role: string;
  permissions: GroupPermissions;
  allowedChannels: string[];
  isCommercialConsultant: boolean;
  runId: string;
  store: TrainingStore;
  onReady: (bridge: TrainingFrameBridge) => void;
  onTarget: (element: HTMLElement | null) => void;
  onReceipt: (stepId: string, runId: string) => void;
  onError: (error: string | null) => void;
  onReplay?: () => void;
}
export interface TrainingFrameBridge {
  prepare: (step: TourStep) => Promise<void>;
  dispose: () => void;
}
export interface TrainingFrameElement extends HTMLIFrameElement {
  trainingConfig?: TrainingFrameConfig;
}
