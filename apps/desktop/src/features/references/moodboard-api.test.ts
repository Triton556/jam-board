import { invoke } from "@tauri-apps/api/core";
import { expect, it, vi } from "vitest";
import { nativeMoodboardApi } from "../../lib/moodboard-api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({})) }));
it("native moodboard commands send exact input envelopes without actor or permission flags", async () => {
  await nativeMoodboardApi.feedback({ itemId: "item", verdictNote: "Reason" });
  expect(invoke).toHaveBeenLastCalledWith("set_reference_verdict", {
    input: { itemId: "item", verdictNote: "Reason" },
  });
  await nativeMoodboardApi.update("item", { derivedFrom: null });
  expect(invoke).toHaveBeenLastCalledWith("update_reference", {
    input: { itemId: "item", derivedFrom: null },
  });
  await nativeMoodboardApi.send("frame");
  expect(invoke).toHaveBeenLastCalledWith("send_reference_review", {
    input: { frameId: "frame" },
  });
  const input = {
    requestId: "collect",
    sourceFrameIds: ["frame"],
    title: null,
    linkTo: null,
  };
  await nativeMoodboardApi.collect(input);
  expect(invoke).toHaveBeenLastCalledWith("collect_kept_references", { input });
});
