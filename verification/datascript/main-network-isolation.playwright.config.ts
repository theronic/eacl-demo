import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const externalUrl = process.env.EACL_MAIN_URL?.trim();
const localUrl = "http://127.0.0.1:4175/";
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  testDir: ".",
  testMatch: "main-network-isolation.spec.ts",
  timeout: 30_000,
  workers: 1,
  reporter: "line",
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  webServer: externalUrl ? undefined : {
    command: `${JSON.stringify(process.execPath)} scripts/serve-static-site.mjs 4175`,
    cwd: repositoryRoot,
    url: localUrl,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
