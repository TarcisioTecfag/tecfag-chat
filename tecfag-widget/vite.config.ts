import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { copyFileSync, existsSync } from "fs";

const bundle = (process.env.WIDGET_BUNDLE || "site-chat").replace(/[^a-z0-9-]/gi, "");
const outDir = resolve(__dirname, "../public");

/**
 * Escopa todas as regras CSS geradas (Tailwind v4 + utilities) dentro de `#tecfag-chat-root`
 * (equivalente ao `important: "#tecfag-chat-root"` do Tailwind v3 no widget legado).
 * Evita que `.flex`, `.container`, `.hidden`, `.border` vazem para o VTEX IO e garante
 * especificidade superior [1,1,0] contra os resets globais da loja.
 */
function scopeCssToWidgetRoot() {
  return {
    postcssPlugin: "scope-tecfag-widget-css",
    Once(root: any) {
      root.walkRules((rule: any) => {
        if (!rule.selector) return;
        const parentName = rule.parent?.type === "atrule" ? rule.parent.name : "";
        if (parentName === "keyframes" || parentName === "-webkit-keyframes") return;

        rule.selectors = rule.selectors.map((sel: string) => {
          const trimmed = sel.trim();
          if (!trimmed) return trimmed;
          if (trimmed.includes("#tecfag-chat-root")) return trimmed;
          if (trimmed === ":root" || trimmed === ":host" || trimmed === ":root,:host" || trimmed === "html" || trimmed === "body") {
            return "#tecfag-chat-root";
          }
          if (trimmed.startsWith(":root") || trimmed.startsWith(":host")) {
            return trimmed.replace(/^:(?:root|host)/, "#tecfag-chat-root");
          }
          if (trimmed === "*" || trimmed === ":before" || trimmed === "::before" || trimmed === ":after" || trimmed === "::after" || trimmed === "::backdrop") {
            return `#tecfag-chat-root ${trimmed}`;
          }
          return `#tecfag-chat-root ${trimmed}`;
        });
      });
    },
  };
}

export default defineConfig({
  root: resolve(__dirname),
  publicDir: false,
  css: {
    postcss: {
      plugins: [scopeCssToWidgetRoot()],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "sync-widget-bundles",
      closeBundle() {
        const alternate = bundle === "tecfag-chat" ? "site-chat" : "tecfag-chat";
        for (const ext of ["iife.js", "css"]) {
          const src = resolve(outDir, `${bundle}.${ext}`);
          const dest = resolve(outDir, `${alternate}.${ext}`);
          if (existsSync(src)) {
            copyFileSync(src, dest);
          }
        }
      },
    },
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir,
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/widget-entry.tsx"),
      name: "TecfagChatWidget",
      fileName: () => `${bundle}.iife.js`,
      formats: ["iife"],
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return `${bundle}.css`;
          }
          return assetInfo.name || "assets/[name]-[hash][extname]";
        },
      },
    },
    cssCodeSplit: false,
    minify: "esbuild",
    target: "es2020",
  },
});
