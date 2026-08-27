import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const externalUrl = process.env.EACL_DATASCRIPT_URL?.trim();
const localUrl = "http://127.0.0.1:4174/datascript/";
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  testDir: ".",
  testMatch: "browser-local.spec.ts",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { trace: "retain-on-failure" },
  webServer: externalUrl ? undefined : {
    command: `${JSON.stringify(process.execPath)} scripts/serve-static-site.mjs 4174`,
    cwd: repositoryRoot,
    url: localUrl,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { viewport: { width: 390, height: 844 } } },
  ],
});
