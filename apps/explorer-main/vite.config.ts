import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  plugins: [solid()],
  build: {
    outDir: fileURLToPath(new URL("../../dist/explorer-main/static", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    manifest: true
  }
});
