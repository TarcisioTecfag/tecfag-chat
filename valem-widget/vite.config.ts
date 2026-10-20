import { defineConfig } from "vite";
import { resolve } from "path";

// WIDGET_BUNDLE permite gerar o bundle de outro tenant (ex.: "site-chat") sem sobrescrever
// o "valem-chat" que está publicado no site da Valem.
const bundle = (process.env.WIDGET_BUNDLE || "valem-chat").replace(/[^a-z0-9-]/gi, "");

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/main.ts"),
      name: "ValemChat",
      fileName: bundle,
      formats: ["iife"],
    },
    outDir: resolve(__dirname, "../public"),
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: `${bundle}.iife.js`,
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return `${bundle}.css`;
          return assetInfo.name || "asset";
        },
      },
    },
    minify: "esbuild",
    target: "es2020",
  },
});