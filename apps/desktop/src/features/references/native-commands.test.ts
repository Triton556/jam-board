import { afterEach, expect, it, vi } from "vitest";
import { commands } from "../../bindings";
import {
  linkRefFrame,
  setReferenceVerdict,
  unlinkReference,
  unlinkRefFrame,
} from "./native-commands";

vi.mock("../../bindings", () => ({
  commands: {
    setReferenceVerdict: vi.fn(),
    linkRefFrame: vi.fn(),
    unlinkRefFrame: vi.fn(),
    unlinkReference: vi.fn(),
  },
}));
afterEach(() => vi.resetAllMocks());
it("uses generated bindings and exact camelCase input shapes for verdicts, frame links and item unlink", async () => {
  vi.mocked(commands.setReferenceVerdict).mockResolvedValue({
    status: "ok",
    data: { id: "item" },
  } as Awaited<ReturnType<typeof commands.setReferenceVerdict>>);
  vi.mocked(commands.linkRefFrame).mockResolvedValue({
    status: "ok",
    data: { id: "frame" },
  } as Awaited<ReturnType<typeof commands.linkRefFrame>>);
  vi.mocked(commands.unlinkRefFrame).mockResolvedValue({
    status: "ok",
    data: { id: "frame" },
  } as Awaited<ReturnType<typeof commands.unlinkRefFrame>>);
  vi.mocked(commands.unlinkReference).mockResolvedValue({
    status: "ok",
    data: null,
  });
  await setReferenceVerdict("item", "keep");
  await linkRefFrame("frame", "JB-S1");
  await unlinkRefFrame("frame", "JB-S1");
  await unlinkReference("item", "JB-1");
  expect(commands.setReferenceVerdict).toHaveBeenCalledExactlyOnceWith({
    itemId: "item",
    verdict: "keep",
  });
  expect(commands.linkRefFrame).toHaveBeenCalledExactlyOnceWith({
    frameId: "frame",
    targetKey: "JB-S1",
  });
  expect(commands.unlinkRefFrame).toHaveBeenCalledExactlyOnceWith({
    frameId: "frame",
    targetKey: "JB-S1",
  });
  expect(commands.unlinkReference).toHaveBeenCalledExactlyOnceWith({
    itemId: "item",
    targetKey: "JB-1",
  });
});
it("rejects generated error results with their message and code", async () => {
  vi.mocked(commands.linkRefFrame).mockResolvedValue({
    status: "error",
    error: { code: "not_found", message: "Frame not found", field: null },
  });
  await expect(linkRefFrame("missing", "JB-1")).rejects.toMatchObject({
    code: "not_found",
    message: "Frame not found",
  });
});
