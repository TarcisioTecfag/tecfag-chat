import { registerShutdownTask } from "../../src/lib/graceful-shutdown";
import { startEventLoopWatchdog } from "../../src/lib/event-loop-watchdog";

/**
 * Plugin Nitro: Watchdog de Event Loop em worker thread dedicada.
 * - Detecta atrasos transitórios (>= 3s) na thread principal e loga as operações ativas.
 * - Detecta congelamentos permanentes de CPU (>= 10s) mesmo com a thread principal 100% travada,
 *   gravando diagnóstico direto no stderr do Railway.
 * - Em congelamento irreversível (>= 60s em produção), encerra o container congelado via SIGKILL
 *   para que o Railway (restartPolicyType: ON_FAILURE) suba uma instância limpa em segundos.
 */
export default function eventLoopWatchdogPlugin(nitroApp: {
  hooks: { hook: (name: string, handler: () => void | Promise<void>) => void };
}) {
  const isProd = process.env.NODE_ENV === "production";
  const explicitlyEnabled = process.env.EVENT_LOOP_WATCHDOG_ENABLED === "true";
  const explicitlyDisabled = process.env.EVENT_LOOP_WATCHDOG_ENABLED === "false";

  if (explicitlyDisabled || (!isProd && !explicitlyEnabled)) {
    return;
  }

  const handle = startEventLoopWatchdog();
  const stopWatchdog = async () => {
    await handle.stop();
  };

  nitroApp.hooks.hook("close", stopWatchdog);
  registerShutdownTask("event-loop-watchdog", "workers", stopWatchdog);
}
