import { beforeEach, expect, it, vi } from "vitest";
import { markBaseline, readBaseline } from "./read-state";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("NT01 read positions survive reconstruction, isolate project/member and never move backward", () => {
  expect(readBaseline("a", "human")).toBeNull();
  expect(markBaseline("a", "human", 50)).toBe(true);
  markBaseline("a", "human", 20);
  expect(readBaseline("a", "human")).toBe(50);
  expect(readBaseline("b", "human")).toBeNull();
  expect(readBaseline("a", "other")).toBeNull();
  expect(localStorage.getItem("jam.notification-read.v1")).toBe(
    '[{"project":"a","member":"human","seq":50}]',
  );
});
it("NT01 bounds metadata and handles malformed or unavailable storage", () => {
  localStorage.setItem("jam.notification-read.v1", "broken");
  expect(readBaseline("a", "h")).toBeNull();
  for (let i = 0; i < 101; i++) markBaseline(String(i), "h", i);
  expect(readBaseline("0", "h")).toBeNull();
  expect(markBaseline("a", "h", NaN)).toBe(false);
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(markBaseline("a", "h", 3)).toBe(false);
});
