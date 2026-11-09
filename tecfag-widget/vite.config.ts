import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { copyFileSync, existsSync } from "fs";

const bundle = (process.env.WIDGET_BUNDLE || "site-chat").replace(/[^a-z0-9-]/gi, "");
const outDir = resolve(__dirname, "../public");

export default defineConfig({
  root: resolve(__dirname),
  publicDir: false,
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
