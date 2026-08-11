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
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro: {
    // Externalizar socket.io e groq-sdk do bundle do servidor
    // Eles usam APIs Node.js nativas e não podem ser bundlados
    externals: {
      external: ["socket.io", "groq-sdk"],
    },
    // Incluir explicitamente os plugins do servidor (ex: WebSocket handler)
    plugins: ["server/plugins/websocket.ts"],
  } as any,
  vite: {
    plugins: [
      // Polyfill de Buffer/process APENAS no bundle do client.
      // O TanStack Start inclui rotas de API no grafo do client (via routeTree.gen.ts),
      // e algumas usam Buffer do Node.js. O apply garante que o plugin NÃO seja aplicado
      // no bundle SSR do servidor, onde o Node.js nativo já fornece Buffer/process reais.
      {
        ...nodePolyfills({
          include: ["buffer", "process"],
          globals: {
            Buffer: true,
            process: true,
          },
        }),
        // config.build?.ssr é `true` somente no bundle do servidor SSR.
        // É a forma mais confiável de distinguir client vs SSR no Vite,
        // independente do pipeline de build (@lovable.dev/vite-tanstack-config, nitro, etc.)
        apply: (config) => !config.build?.ssr,
      },
    ],
  },
});
