// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },
  },
  nitro: {
    // @whiskeysockets/baileys usa process.hrtime.bigint() que quebra quando bundlado pelo Nitro.
    // Externalizando, o Node.js nativo resolve o módulo em runtime sem bundling.
    externals: {
      external: ["socket.io", "groq-sdk", "@whiskeysockets/baileys"],
    },
    plugins: ["server/plugins/websocket.ts"],
  } as any,
  vite: {
    plugins: [
      // Polyfill de Buffer para o bundle do browser.
      //
      // O routeTree.gen.ts importa TODAS as rotas de API (incluindo /api/voice-buffer,
      // /api/baileys/*, etc.) que usam Buffer do Node.js. Sem polyfill, o browser
      // gera "ReferenceError: Buffer is not defined".
      //
      // Incluímos APENAS 'buffer' — NÃO 'process':
      //   - O npm 'buffer' é browser-safe e substitui Node.js Buffer corretamente.
      //   - O npm 'process' substituiria o process nativo do Node.js no bundle SSR,
      //     quebrando APIs como process.env e hrtime. Como externalizamos o Baileys,
      //     não há mais risco de process.hrtime no servidor.
      //
      // Não usamos 'apply' para restringir ao client porque o spread+apply
      // não é suportado corretamente pelo pipeline do @lovable.dev/vite-tanstack-config.
      // O polyfill de 'buffer' é seguro no bundle SSR pois o Node.js tem buffer nativo
      // e o pacote npm é compatível com a API Node.js Buffer.
      nodePolyfills({
        include: ["buffer"],
        globals: {
          Buffer: true,
        },
      }),
    ],
  },
});
