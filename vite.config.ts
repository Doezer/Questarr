import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf-8")
) as { version: string };

const configuredBase = process.env.QUESTARR_BASE_PATH;
const base =
  configuredBase && configuredBase.length > 0
    ? configuredBase.endsWith("/")
      ? configuredBase
      : `${configuredBase}/`
    : "./";

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  define: {
    "globalThis.__APP_VERSION__": JSON.stringify(version),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          const p = id.replaceAll("\\", "/");
          if (!p.includes("/node_modules/")) return;
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(p)) return "react";
          if (p.includes("/node_modules/@tanstack/")) return "react-query";
          if (p.includes("/node_modules/wouter/")) return "router";
          if (p.includes("/node_modules/@radix-ui/")) return "radix";
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
