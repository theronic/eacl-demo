import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  plugins: [solid()],
  server: {
    host: "127.0.0.1",
    port: 5176,
    proxy: { "/api/local": "http://127.0.0.1:8788" }
  },
  build: {
    outDir: fileURLToPath(new URL("../../dist/explorer-main/static", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    manifest: true
  }
});
