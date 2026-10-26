import { beforeEach, expect, it } from "vitest";
import { mockApi } from "../../lib/mock-bridge";

beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
});
it("RC02 busy-board mock fixture is exact and repeatable without duplicate assets", async () => {
  await mockApi.seedBusyBoard();
  const first = await mockApi.referenceCanvas();
  expect([first.items.length, first.frames.length, first.edges.length]).toEqual(
    [500, 50, 200],
  );
  expect(first.items.some((i) => i.verdict === "keep")).toBe(true);
  expect(first.items.some((i) => i.verdict === "reject")).toBe(true);
  const assets = (await mockApi.listAssets()).length;
  await mockApi.seedBusyBoard();
  expect((await mockApi.listAssets()).length).toBe(assets);
  expect(await mockApi.canvasViewport()).toBe('{"x":80,"y":90,"zoom":1}');
});
