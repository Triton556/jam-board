import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [react()],
  test: {
    // Four DOM workers reproduced lazy-import/readiness timeouts on Windows
    // (locally and on CI); the same affected suites passed with two workers.
    // Retain file isolation and the existing assertion/test deadlines.
    maxWorkers: 2,
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
