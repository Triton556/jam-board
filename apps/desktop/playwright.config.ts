import { defineConfig } from "@playwright/test";

const port = Number(process.env.JAM_BOARD_TEST_PORT ?? 1420);
export default defineConfig({
  outputDir: "../../.dev-data/playwright",
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1360, height: 860 },
    browserName: "chromium",
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "functional", testIgnore: ["**/perf/**", "**/perf-canvas/**"] },
    {
      name: "perf",
      testMatch: "**/perf/*.spec.ts",
      use: { baseURL: "http://127.0.0.1:1422", trace: "off" },
    },
    {
      name: "perf-canvas",
      testMatch: "**/perf-canvas/*.spec.ts",
      use: { baseURL: "http://127.0.0.1:1422", trace: "off" },
    },
  ],
  webServer: [
    {
      command: `npm run dev -- --port ${port}`,
      env: { VITE_MOCK_BRIDGE: "1" },
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: false,
    },
    {
      command:
        "npm run build -- --outDir ../../.dev-data/perf-dist && npx vite preview --outDir ../../.dev-data/perf-dist --host 127.0.0.1 --port 1422 --strictPort",
      env: { VITE_MOCK_BRIDGE: "1" },
      url: "http://127.0.0.1:1422",
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
  reporter: "list",
});
