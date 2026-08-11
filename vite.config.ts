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
    server: { entry: "server" },
  },
  nitro: {
    // Externalizar dependências com código nativo do Node.js que não podem ser bundladas.
    // @whiskeysockets/baileys usa process.hrtime.bigint() que quebra se bundlado pelo Nitro.
    externals: {
      external: ["socket.io", "groq-sdk", "@whiskeysockets/baileys"],
    },
    plugins: ["server/plugins/websocket.ts"],
  } as any,
  vite: {
    // O routeTree.gen.ts importa TODAS as rotas de API (inclusive /api/voice-buffer,
    // /api/baileys/*, etc.) que usam Buffer do Node.js. Isso faz o bundle do browser
    // tentar usar Buffer sem polyfill.
    //
    // Estratégia: redirecionar importações de 'buffer' para o pacote npm 'buffer'
    // (browser-compatible). O `define` mapeia `global` → `globalThis` para que o
    // pacote npm funcione no browser. O plugin injeta Buffer como global antes de
    // qualquer outro módulo para que chamadas diretas a `Buffer.from(...)` funcionem.
    resolve: {
      alias: {
        buffer: "buffer",
      },
    },
    optimizeDeps: {
      // Pré-bundlar o pacote 'buffer' para que o Vite o trate como ESM
      include: ["buffer"],
    },
    define: {
      // O pacote npm 'buffer' usa `global` internamente; mapear para globalThis
      global: "globalThis",
    },
    plugins: [
      {
        name: "inject-buffer-global",
        // Apenas no build de produção — em dev o Vite serve módulos individualmente
        apply: "build" as const,
        transformIndexHtml: {
          order: "pre" as const,
          handler() {
            return [
              {
                tag: "script",
                attrs: { type: "module" },
                // Injeta Buffer como global ANTES do bundle principal carregar
                children: `import { Buffer } from 'buffer'; if (typeof globalThis.Buffer === 'undefined') { globalThis.Buffer = Buffer; }`,
                injectTo: "head-prepend" as const,
              },
            ];
          },
        },
      },
    ],
  },
});
