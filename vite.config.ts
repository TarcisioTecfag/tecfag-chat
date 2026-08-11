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
    // Externalizar socket.io e groq-sdk do bundle do servidor
    // Eles usam APIs Node.js nativas e não podem ser bundlados
    externals: {
      external: ["socket.io", "groq-sdk"],
    },
    // Incluir explicitamente os plugins do servidor (ex: WebSocket handler)
    plugins: ["server/plugins/websocket.ts"],
  } as any,
  vite: {
    // Polyfill de Buffer para o bundle do client.
    // O TanStack Start inclui rotas de API no grafo de módulos do client (via routeTree.gen.ts),
    // e algumas dessas rotas usam Buffer.from() do Node. O browser não tem Buffer nativo,
    // então usamos o pacote `buffer` (polyfill oficial) e o injetamos globalmente.
    resolve: {
      alias: {
        buffer: "buffer",
      },
    },
    define: {
      // Garante que qualquer referência a Buffer no bundle do client use o polyfill
      "global.Buffer": "globalThis.Buffer",
    },
    optimizeDeps: {
      include: ["buffer"],
    },
    plugins: [
      {
        // Plugin inline que injeta o polyfill de Buffer no entry point do client
        name: "buffer-polyfill",
        transformIndexHtml() {
          return [
            {
              tag: "script",
              attrs: { type: "module" },
              children: `import { Buffer } from 'buffer'; if (typeof globalThis.Buffer === 'undefined') { globalThis.Buffer = Buffer; }`,
              injectTo: "head-prepend",
            },
          ];
        },
      },
    ],
  },
});

