import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/main.ts"),
      name: "ValemChat",
      fileName: "valem-chat",
      formats: ["iife"],
    },
    outDir: resolve(__dirname, "../public"),
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: "valem-chat.iife.js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return "valem-chat.css";
          return assetInfo.name || "asset";
        },
      },
    },
    minify: "esbuild",
    target: "es2020",
  },
});