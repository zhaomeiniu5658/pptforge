import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("codemirror") || id.includes("@lezer"))
            return "code-editor";
          if (
            id.includes("parse5") ||
            id.includes("postcss") ||
            id.includes("entities")
          )
            return "html-engine";
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: process.env.API_PROXY || "http://127.0.0.1:8011" },
    },
  },
});
