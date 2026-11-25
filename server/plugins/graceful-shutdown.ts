import type { Server } from "node:http";
import {
  installGracefulShutdownHandlers,
  registerHttpServerForShutdown,
  registerShutdownTask,
} from "../../src/lib/graceful-shutdown";
import { stopAllPeriodicWorkers } from "../../src/lib/periodic-worker";

/**
 * Plugin Nitro: Coordenador de encerramento gracioso (SIGTERM / SIGINT).
 * Garante a ordem:
 *   1. workers  -> para todos os loops/timers e dispara nitroApp.hooks.callHook("close")
 *   2. http     -> fecha SSE/WebSockets e aguarda drain das requisições HTTP em andamento
 *   3. services -> fecha sockets Baileys (SessionManager) e faz flush de auditorias MCP
 *   4. database -> encerra pools PostgreSQL via sql.end({ timeout }) com Terminate + TLS close_notify
 */
export default function gracefulShutdownPlugin(nitroApp: {
  hooks: {
    hook: (name: string, handler: (...args: any[]) => void | Promise<void>) => void;
    callHook?: (name: string, ...args: any[]) => Promise<void>;
  };
}) {
  let serverCaptured = false;
  const captureServer = (server: Server | undefined) => {
    if (!server || serverCaptured) return;
    serverCaptured = true;
    registerHttpServerForShutdown(server);
  };

  nitroApp.hooks.hook("listen", (server: Server) => {
    captureServer(server);
  });

  nitroApp.hooks.hook("request", (event: any) => {
    if (serverCaptured) return;
    const server: Server | undefined =
      event?.node?.res?.socket?.server || event?.req?.runtime?.node?.req?.socket?.server;
    captureServer(server);
  });

  registerShutdownTask("periodic-workers-and-nitro-close", "workers", async () => {
    await stopAllPeriodicWorkers(2_000);
    if (typeof nitroApp.hooks.callHook === "function") {
      try {
        await nitroApp.hooks.callHook("close");
      } catch (err) {
        console.warn(
          "[GracefulShutdown] Aviso ao executar hooks 'close' do Nitro:",
          err instanceof Error ? err.message : String(err ?? ""),
        );
      }
    }
  });

  registerShutdownTask("postgres-pools", "database", async () => {
    const { closeDatabasePools } = await import("../../src/db/index.js");
    const closed = await closeDatabasePools(4);
    console.log(`[GracefulShutdown] ${closed} pool(s) PostgreSQL encerrado(s) graciosamente.`);
  });

  installGracefulShutdownHandlers({ exitProcess: true });
}
