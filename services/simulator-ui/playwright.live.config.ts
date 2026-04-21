import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://simulator_ui";

export default defineConfig({
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  testDir: "./playwright",
  testMatch: ["**/live.spec.ts"],
  timeout: 90000,
  use: {
    baseURL,
  },
  workers: 1,
});
