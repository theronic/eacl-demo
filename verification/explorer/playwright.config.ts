import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";

const externalBaseUrl = process.env.EACL_QUALIFICATION_BASE_URL?.trim();
const expectedStagedOrigin = process.env.EACL_EXPECTED_STAGED_ORIGIN?.trim();
const localBaseUrl = "http://127.0.0.1:4173";
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const nodeBinary = JSON.stringify(process.execPath);

if (externalBaseUrl) {
  if (!expectedStagedOrigin) throw new Error("EACL_EXPECTED_STAGED_ORIGIN is required for staged browser qualification");
  const actual = new URL(externalBaseUrl);
  const expected = new URL(expectedStagedOrigin);
  if (actual.origin !== expected.origin || actual.pathname !== "/" || actual.search || actual.hash || expected.protocol !== "https:" || expected.pathname !== "/" || expected.search || expected.hash || expected.username || expected.password || expected.port) throw new Error("browser qualification URL does not match the trusted staged CloudFront origin");
}

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [["list"], ["html", { outputFolder: "artifacts/playwright/explorer-report", open: "never" }]],
  use: {
    baseURL: externalBaseUrl || localBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: externalBaseUrl ? undefined : {
    command: `${nodeBinary} scripts/serve-static-site.mjs 4173`,
    cwd: repositoryRoot,
    url: localBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "desktop-webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 15"] } }
  ]
});
