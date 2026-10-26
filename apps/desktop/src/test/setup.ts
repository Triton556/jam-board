import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Cold module transforms and query-backed drawers can exceed the library's 1 s
// default under Windows CI contention. Keep this below the 5 s test deadline.
configure({ asyncUtilTimeout: 3000 });

vi.mock("../lib/api", async () => ({
  api: (await import("../lib/mock-bridge")).mockApi,
}));
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }),
});
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
HTMLElement.prototype.scrollIntoView = () => {};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
