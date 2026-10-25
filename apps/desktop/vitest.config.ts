import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [react()],
  test: {
    // The 12-thread QA host otherwise starts 11 DOM workers at once. Its full
    // gate exhausted lazy-import/readiness budgets; bound CPU/memory contention
    // while retaining file isolation and the normal 5 s test deadline.
    maxWorkers: 4,
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
