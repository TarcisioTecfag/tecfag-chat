import { createContext, useContext } from "react";

/** Optional portal destination for an isolated editor/dialog; null preserves normal behavior. */
export const PortalScope = createContext<HTMLElement | null>(null);
export function usePortalScope() {
  return useContext(PortalScope);
}
