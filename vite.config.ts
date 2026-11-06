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
    // Evita que o TanStack Router separe micro-rotas wrapper (_chatKey-*.js, _-*.js) em chunks
    // minúsculos que podem dar 404 ao clicar em uma conversa após um novo deploy no Railway.
    // Os módulos pesados continuam em lazy loading protegido via lazyWithRetry.
    router: {
      codeSplittingOptions: {
        defaultBehavior: [],
      },
    },
  },
  nitro: {
    // Runtime persistente requerido por Baileys, WebSockets e workers no Railway.
    preset: "node_server",
    // HTML must be revalidated after a deploy; hashed /assets files remain immutable.
    routeRules: {
      "/": { headers: { "cache-control": "no-store, no-cache, must-revalidate" } },
      "/chat/**": { headers: { "cache-control": "no-store, no-cache, must-revalidate" } },
      "/contacts/**": { headers: { "cache-control": "no-store, no-cache, must-revalidate" } },
      "/negociacoes/**": { headers: { "cache-control": "no-store, no-cache, must-revalidate" } },
      "/crm/**": { headers: { "cache-control": "no-store, no-cache, must-revalidate" } },
      "/call/**": { headers: { "cache-control": "no-store, no-cache, must-revalidate" } },
    },
    // Externalizar socket.io, groq-sdk e extratores de documentos (pdf-parse/pdfjs-dist/mammoth/xlsx)
    // do bundle do servidor: pdfjs-dist carrega pdf.worker.mjs via caminho relativo em node_modules
    externals: {
      external: ["socket.io", "groq-sdk", "pdf-parse", "pdfjs-dist", "mammoth", "xlsx"],
    },
    // Incluir explicitamente os plugins do servidor (ex: WebSocket handler)
    plugins: [
      "server/plugins/websocket.ts",
      "server/plugins/orphan-cleanup.ts",
      "server/plugins/recovery.ts",
      "server/plugins/industrial-triage-recovery.ts",
    ],
  } as any,
});
