import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  attachmentLimit,
  attachmentRefusal,
  quotedPaths,
  useDockFileDrop,
} from "./BrainAttachments";

const native = vi.hoisted(() => ({
  callback: (_: {
    payload: {
      type: string;
      position?: { x: number; y: number };
      paths?: string[];
    };
  }) => {},
  off: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (callback: typeof native.callback) => {
      native.callback = callback;
      return native.off;
    },
  }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("BC14 file and message limits accept their exact boundaries and refuse the next byte or file", () => {
  const MB = 1024 * 1024;
  expect(attachmentLimit(20 * MB, [])).toBe("");
  expect(attachmentLimit(20 * MB + 1, [])).toBe("File is larger than 20 MB");
  expect(
    attachmentLimit(
      1,
      Array.from({ length: 10 }, () => ({ size: 1, status: "ready" })),
    ),
  ).toBe("Up to 10 files per message");
  expect(
    attachmentLimit(10 * MB, [
      { size: 20 * MB, status: "ready" },
      { size: 20 * MB, status: "copying" },
    ]),
  ).toBe("");
  expect(
    attachmentLimit(10 * MB + 1, [
      { size: 20 * MB, status: "ready" },
      { size: 20 * MB, status: "copying" },
    ]),
  ).toBe("Up to 50 MB per message");
  expect(attachmentLimit(1, [{ size: 80 * MB, status: "refused" }])).toBe("");
});
it("BC14 API accepts small text, refuses oversized context and non-vision images; ACP keeps resource links", () => {
  const view = {
    id: "a",
    name: "brief.txt",
    mimeType: "text/plain",
    size: 256 * 1024,
    path: "C:/brief.txt",
    isImage: false,
    thumbnail: null,
    previewUrl: null,
  };
  expect(attachmentRefusal(view, "api", false)).toBe("");
  expect(
    attachmentRefusal({ ...view, size: view.size + 1 }, "api", false),
  ).toBe("Not supported in API chat — use an agent connection");
  expect(attachmentRefusal({ ...view, isImage: true }, "api", false)).toBe(
    "This model can't see images — pick a vision model",
  );
  expect(attachmentRefusal({ ...view, isImage: true }, "api", true)).toBe("");
  expect(
    attachmentRefusal(
      { ...view, mimeType: "application/zip", name: "brief.zip", size: 400000 },
      "acp",
      false,
    ),
  ).toBe("");
});
it("BC14 terminal quotes absolute paths with spaces", () => {
  expect(
    quotedPaths(["C:\\my files\\brief.txt", "/tmp/second image.png"]),
  ).toBe('"C:\\my files\\brief.txt" "/tmp/second image.png"');
});

function DropHarness({
  files,
  paths,
}: {
  files(files: File[]): void;
  paths(paths: string[]): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useDockFileDrop(host, files, paths);
  return (
    <aside className="brain-dock">
      <div ref={host}>Drop fixture</div>
      {overlay}
    </aside>
  );
}
it("BC14 native drop paths use dock bounds and physical-to-CSS coordinates, then clean up the listener", async () => {
  vi.stubEnv("VITE_MOCK_BRIDGE", "0");
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 2,
  });
  const paths = vi.fn();
  const files = vi.fn();
  const view = render(<DropHarness files={files} paths={paths} />);
  const dock = document.querySelector(".brain-dock");
  if (!dock) throw Error("No dock fixture");
  vi.spyOn(dock, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    right: 400,
    bottom: 700,
  } as DOMRect);
  await act(async () => {
    await import("@tauri-apps/api/webview");
  });
  await waitFor(() => expect(native.callback.name).not.toBe("callback"));
  act(() =>
    native.callback({
      payload: { type: "over", position: { x: 300, y: 300 } },
    }),
  );
  expect(screen.getByText("Drop to attach")).toBeVisible();
  act(() =>
    native.callback({
      payload: {
        type: "drop",
        position: { x: 300, y: 300 },
        paths: ["C:/brief.txt"],
      },
    }),
  );
  expect(paths).toHaveBeenCalledWith(["C:/brief.txt"]);
  expect(files).not.toHaveBeenCalled();
  act(() =>
    native.callback({
      payload: {
        type: "drop",
        position: { x: 20, y: 20 },
        paths: ["C:/outside.txt"],
      },
    }),
  );
  expect(paths).toHaveBeenCalledOnce();
  view.unmount();
  expect(native.off).toHaveBeenCalled();
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 1,
  });
});
it("BC14 mock HTML drop exposes and clears the overlay and forwards Files", () => {
  vi.stubEnv("VITE_MOCK_BRIDGE", "1");
  const files = vi.fn();
  const paths = vi.fn();
  render(<DropHarness files={files} paths={paths} />);
  const file = new File(["x"], "brief.txt");
  const dock = screen.getByText("Drop fixture");
  const dataTransfer = { types: ["Files"], files: [file] };
  fireEvent.dragOver(dock, { dataTransfer });
  expect(screen.getByText("Drop to attach")).toBeVisible();
  fireEvent.drop(dock, { dataTransfer });
  expect(screen.queryByText("Drop to attach")).toBeNull();
  expect(files).toHaveBeenCalledWith([file]);
  expect(paths).not.toHaveBeenCalled();
});
