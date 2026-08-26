import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "browser-local.spec.ts",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" }
});
