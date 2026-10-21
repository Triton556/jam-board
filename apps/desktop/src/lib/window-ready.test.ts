import { afterEach, expect, it, vi } from "vitest";
import { showReadyWindow } from "./window-ready";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("shows a hidden window even if fonts and animation frames never resolve", async () => {
  vi.useFakeTimers();
  const order: string[] = [];
  const raf = vi.fn(() => 1),
    cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  const work = showReadyWindow({
    fontsReady: new Promise(() => {}),
    show: async () => {
      order.push("show");
    },
    ready: async () => {
      order.push("ready");
    },
  });
  expect(raf).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(250);
  expect(order).toEqual(["show"]);
  await vi.advanceTimersByTimeAsync(250);
  await work;
  expect(order).toEqual(["show"]);
  expect(vi.getTimerCount()).toBe(0);
});
it("shows before requesting paint and reports readiness after visible frames", async () => {
  vi.useFakeTimers();
  const frames: FrameRequestCallback[] = [],
    order: string[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    order.push("frame");
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const work = showReadyWindow({
    fontsReady: Promise.resolve(),
    show: async () => {
      order.push("show");
    },
    ready: async () => {
      order.push("ready");
    },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(order).toEqual(["show", "frame"]);
  frames[0]?.(0);
  frames[1]?.(16);
  await work;
  expect(order).toEqual(["show", "frame", "frame", "ready"]);
  expect(vi.getTimerCount()).toBe(0);
});
it("font failure cannot leave the application hidden", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const show = vi.fn(async () => {}),
    ready = vi.fn(async () => {});
  const work = showReadyWindow({
    fontsReady: Promise.reject(new Error("font load")),
    show,
    ready,
  });
  await vi.advanceTimersByTimeAsync(250);
  await work;
  expect(show).toHaveBeenCalledOnce();
  expect(ready).not.toHaveBeenCalled();
});
