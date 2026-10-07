// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro: {
    // HTML must be revalidated after a deploy; hashed /assets files remain immutable.
    routeRules: {
      "/": { headers: { "cache-control": "no-cache" } },
      "/chat/**": { headers: { "cache-control": "no-cache" } },
      "/crm/deals/**": { headers: { "cache-control": "no-cache" } },
      "/call/**": { headers: { "cache-control": "no-cache" } },
    },
    // Externalizar socket.io e groq-sdk do bundle do servidor
    // Eles usam APIs Node.js nativas e não podem ser bundlados
    externals: {
      external: ["socket.io", "groq-sdk"],
    },
    // Incluir explicitamente os plugins do servidor (ex: WebSocket handler)
    plugins: [
      "server/plugins/websocket.ts",
      "server/plugins/orphan-cleanup.ts",
      "server/plugins/recovery.ts",
    ],
  } as any,
});
