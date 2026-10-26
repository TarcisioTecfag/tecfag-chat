import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

const bundle = (process.env.WIDGET_BUNDLE || "site-chat").replace(/[^a-z0-9-]/gi, "");

export default defineConfig({
  root: resolve(__dirname),
  publicDir: false,
  plugins: [react(), tailwindcss()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: resolve(__dirname, "../public"),
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
