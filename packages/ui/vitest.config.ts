import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  plugins: [solid({ ssr: true })],
  test: { environment: "node", include: ["packages/ui/*.test.tsx"] }
});
