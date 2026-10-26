import { beforeEach, expect, it, vi } from "vitest";

import { contentRoute, observeFirstPaint } from "../../public/startup-probe.js";

const invoke = vi.fn().mockResolvedValue(true);

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/board");
});

it("ignores loading and failed shells, accepts data-backed empty content", () => {
  document.body.innerHTML = '<div class="loading">Loading board</div>';
  expect(contentRoute()).toBeUndefined();
  document.body.innerHTML = '<div class="page-error">Failed</div>';
  expect(contentRoute()).toBeUndefined();
  document.body.innerHTML = '<div class="board-columns"></div>';
  expect(contentRoute()).toBe("/board");
  window.history.replaceState({}, "", "/plan");
  document.body.innerHTML = '<main class="plan-page"></main>';
  expect(contentRoute()).toBe("/plan");
  window.history.replaceState({}, "", "/welcome");
  document.body.innerHTML = '<main class="welcome"></main>';
  expect(contentRoute()).toBe("/welcome");
});

it("waits for visible committed content and two frames, sends only one receipt", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  invoke.mockResolvedValueOnce(false).mockResolvedValue(true);
  document.body.innerHTML = '<div class="board-columns"></div>';
  observeFirstPaint(invoke);
  await Promise.resolve();
  expect(invoke).not.toHaveBeenCalledWith(
    "startup_first_paint",
    expect.anything(),
  );
  await vi.advanceTimersByTimeAsync(16);
  await Promise.resolve();
  frames.shift()?.(16);
  expect(invoke).not.toHaveBeenCalledWith(
    "startup_first_paint",
    expect.anything(),
  );
  frames.shift()?.(32);
  await Promise.resolve();
  expect(invoke).toHaveBeenCalledWith("startup_first_paint", {
    route: "/board",
    paintEpochMs: expect.any(Number),
  });
  document.body.append(document.createElement("div"));
  await Promise.resolve();
  expect(
    invoke.mock.calls.filter(([command]) => command === "startup_first_paint"),
  ).toHaveLength(1);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
