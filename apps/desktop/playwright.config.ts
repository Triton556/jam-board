import { defineConfig } from "@playwright/test";

const port = Number(process.env.JAM_BOARD_TEST_PORT ?? 1420);
const perfPort = Number(process.env.JAM_BOARD_PERF_PORT ?? 1422);
export default defineConfig({
  outputDir: "../../.dev-data/playwright",
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1360, height: 860 },
    browserName: "chromium",
    channel:
      process.env.JAM_BROWSER_PATH || process.env.CI ? undefined : "chrome",
    launchOptions: process.env.JAM_BROWSER_PATH
      ? { executablePath: process.env.JAM_BROWSER_PATH }
      : undefined,
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "functional", testIgnore: ["**/perf/**", "**/perf-canvas/**"] },
    {
      name: "perf",
      testMatch: "**/perf/*.spec.ts",
      use: { baseURL: `http://127.0.0.1:${perfPort}`, trace: "off" },
    },
    {
      name: "perf-canvas",
      testMatch: "**/perf-canvas/*.spec.ts",
      use: { baseURL: `http://127.0.0.1:${perfPort}`, trace: "off" },
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
      command: `npm run build -- --outDir ../../.dev-data/perf-dist && npx vite preview --outDir ../../.dev-data/perf-dist --host 127.0.0.1 --port ${perfPort} --strictPort`,
      env: { VITE_MOCK_BRIDGE: "1" },
      url: `http://127.0.0.1:${perfPort}`,
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
  reporter: "list",
});
