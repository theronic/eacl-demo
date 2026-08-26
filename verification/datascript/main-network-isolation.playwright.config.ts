import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "main-network-isolation.spec.ts",
  timeout: 30_000,
  workers: 1,
  reporter: "line",
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" }
});
