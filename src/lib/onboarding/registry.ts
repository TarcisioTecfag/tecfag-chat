import type { TourCommand, TourSurfaceId } from "./types";

export type OnboardingSurfaceHandler = (
  command: TourCommand,
) => Promise<void> | void;

export interface OnboardingAdapterScope {
  tenantId: string;
  operatorId: string;
  runId: string;
  surface?: TourSurfaceId | string;
}

export interface OnboardingAdapterHandle {
  tenantId: string;
  operatorId: string;
  runId: string;
  surface: TourSurfaceId | string;
  ready?: boolean;
  prepare?: (command?: TourCommand) => Promise<void> | void;
  handler?: OnboardingSurfaceHandler;
  onCommand?: OnboardingSurfaceHandler;
  cleanup?: () => void;
}

function makeAdapterKey(
  tenantId: string,
  operatorId: string,
  runId: string,
  surface: TourSurfaceId | string,
): string {
  return `${tenantId}::${operatorId}::${runId}::${surface}`;
}

export class OnboardingSurfaceRegistry {
  private adapters = new Map<string, OnboardingAdapterHandle>();
  private listeners = new Set<() => void>();

  register(
    handleOrScope: OnboardingAdapterHandle,
    callbacks?: {
      onCommand?: OnboardingSurfaceHandler;
      prepare?: (command?: TourCommand) => Promise<void> | void;
      cleanup?: () => void;
    },
  ): () => void {
    const handle: OnboardingAdapterHandle = callbacks
      ? {
          ...handleOrScope,
          ready: handleOrScope.ready ?? true,
          onCommand: callbacks.onCommand ?? handleOrScope.onCommand,
          handler: callbacks.onCommand ?? handleOrScope.handler,
          prepare: callbacks.prepare ?? handleOrScope.prepare,
          cleanup: callbacks.cleanup ?? handleOrScope.cleanup,
        }
      : {
          ...handleOrScope,
          ready: handleOrScope.ready ?? true,
        };

    const key = makeAdapterKey(
      handle.tenantId,
      handle.operatorId,
      handle.runId,
      handle.surface,
    );
    this.adapters.set(key, handle);
    this.notify();

    return () => {
      const current = this.adapters.get(key);
      if (current === handle) {
        try {
          current.cleanup?.();
        } catch {}
        this.adapters.delete(key);
        this.notify();
      }
    };
  }

  getAdapter(
    tenantId: string,
    operatorId: string,
    runId: string,
    surface: TourSurfaceId | string,
  ): OnboardingAdapterHandle | undefined {
    return this.adapters.get(makeAdapterKey(tenantId, operatorId, runId, surface));
  }

  hasSurface(scope: {
    tenantId: string;
    operatorId: string;
    runId: string;
    surface: TourSurfaceId | string;
  }): boolean {
    return this.adapters.has(
      makeAdapterKey(scope.tenantId, scope.operatorId, scope.runId, scope.surface),
    );
  }

  dispatch(
    scope: {
      tenantId: string;
      operatorId: string;
      runId: string;
      surface?: TourSurfaceId | string;
    },
    command: TourCommand,
  ): boolean {
    const targetSurface = scope.surface ?? command.surface;
    if (!targetSurface) return false;
    const handle = this.getAdapter(
      scope.tenantId,
      scope.operatorId,
      scope.runId,
      targetSurface,
    );
    if (!handle) return false;
    const fn = handle.onCommand ?? handle.handler ?? handle.prepare;
    if (!fn) return false;
    try {
      void fn(command);
      return true;
    } catch {
      return false;
    }
  }

  clearIdentity(tenantId: string, operatorId: string): void {
    const prefix = `${tenantId}::${operatorId}::`;
    for (const [key, handle] of this.adapters.entries()) {
      if (key.startsWith(prefix)) {
        try {
          handle.cleanup?.();
        } catch {}
        this.adapters.delete(key);
      }
    }
    this.notify();
  }

  clearAll(): void {
    for (const handle of this.adapters.values()) {
      try {
        handle.cleanup?.();
      } catch {}
    }
    this.adapters.clear();
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {}
    }
  }
}

export const onboardingRegistry = new OnboardingSurfaceRegistry();
