import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { FileDropSessionProvider } from "../../lib/file-drop-batch";
import { MockBridge } from "../../lib/mock-bridge";
import { useUiStore } from "../../lib/ui-store";
import { useClipboardImagePaste } from "./clipboard-paste";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const bytes = new Uint8Array([137, 80, 78, 71]);
const file = new File([bytes], "synthetic.png", { type: "image/png" });
const item: Awaited<ReturnType<typeof api.clipboardReference>> = {
  position: 1,
  id: "synthetic-clip",
  jamId: "captured",
  kind: "asset",
  assetId: "synthetic-asset",
  url: null,
  title: "Clipboard image",
  captionMd: "",
  tags: [],
  x: 4,
  y: 8,
  w: 1,
  h: 1,
  z: 0,
  frameId: null,
  linkPreview: null,
  metadata: null,
  createdBy: "human",
  updatedBy: "human",
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
  archivedAt: null,
};
beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ toasts: [] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setup() {
  const bridge = new MockBridge();
  await bridge.createJam({
    name: "Captured project",
    yourName: "Human",
    theme: null,
    startsAt: "",
    endsAt: "",
    timezone: "UTC",
    template: "custom",
    milestoneAt: null,
  });
  const state = await bridge.appState();
  if (!state.jam) throw Error("Missing fixture project");
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(["app"], state);
  let run!: ReturnType<typeof useClipboardImagePaste>;
  function Page() {
    run = useClipboardImagePaste();
    return null;
  }
  function Shell({ show = true }: { show?: boolean }) {
    return (
      <QueryClientProvider client={client}>
        <FileDropSessionProvider>
          <input aria-label="Unrelated draft" defaultValue="Keep this draft" />
          {show && <Page />}
        </FileDropSessionProvider>
      </QueryClientProvider>
    );
  }
  const view = render(<Shell />);
  const write = vi.spyOn(api, "clipboardReference").mockResolvedValue(item);
  const selected = vi.fn(),
    refresh = vi.fn().mockResolvedValue(undefined);
  return {
    client,
    state,
    view,
    write,
    selected,
    refresh,
    get run() {
      return run;
    },
    hide() {
      view.rerender(<Shell show={false} />);
    },
    show() {
      view.rerender(<Shell />);
    },
    switchProject(aba = false) {
      client.setQueryData(["app"], {
        ...state,
        jam: { ...state.jam, id: "other-project" },
      });
      if (aba) client.setQueryData(["app"], state);
    },
  };
}
function imagePipeline(phase?: "decode" | "encode" | "buffer") {
  const decoded = deferred<ImageBitmap>(),
    encoded = deferred<Blob>(),
    buffered = deferred<ArrayBuffer>();
  const close = vi.fn(),
    bitmap = { width: 1, height: 1, close } as ImageBitmap;
  const blob = new Blob([bytes], { type: "image/png" });
  const decode = vi.fn(() =>
    phase === "decode" ? decoded.promise : Promise.resolve(bitmap),
  );
  vi.stubGlobal("createImageBitmap", decode);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D,
  );
  const encode = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation((callback) => {
      if (phase === "encode") void encoded.promise.then(callback);
      else callback(blob);
    });
  const buffer = vi
    .spyOn(blob, "arrayBuffer")
    .mockImplementation(() =>
      phase === "buffer"
        ? buffered.promise
        : Promise.resolve(bytes.buffer.slice(0)),
    );
  return {
    close,
    decode,
    encode,
    buffer,
    release() {
      decoded.resolve(bitmap);
      encoded.resolve(blob);
      buffered.resolve(bytes.buffer.slice(0));
    },
  };
}
const receipt = () => {
  const value = useUiStore.getState().toasts.at(-1);
  if (!value) throw Error("Missing receipt");
  return value;
};
it.each(["decode", "encode", "buffer"] as const)(
  "fences %s preparation across project ABA and closes the bitmap without dispatch",
  async (phase) => {
    const s = await setup(),
      pipeline = imagePipeline(phase);
    let pending!: Promise<void>;
    await act(async () => {
      pending = s.run(file, { x: 4, y: 8 }, s.selected, s.refresh);
    });
    await waitFor(() => expect(pipeline[phase]).toHaveBeenCalledTimes(1));
    if (phase !== "decode") expect(pipeline.close).toHaveBeenCalledTimes(1);
    act(() => s.switchProject(true));
    await act(async () => {
      pipeline.release();
      await pending;
    });
    expect(s.write).not.toHaveBeenCalled();
    expect(s.selected).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();
    expect(pipeline.close).toHaveBeenCalledTimes(1);
    expect(receipt().text).toContain(
      "Captured project [JB] · clipboard image: not attempted",
    );
    expect(receipt().persistent).toBe(true);
    expect(
      screen.getByRole("textbox", { name: "Unrelated draft" }),
    ).toHaveValue("Keep this draft");
  },
);
it("does not revive an old prepared image after leaving and returning to the same page", async () => {
  const s = await setup(),
    pipeline = imagePipeline("buffer");
  let pending!: Promise<void>;
  await act(async () => {
    pending = s.run(file, { x: 4, y: 8 }, s.selected, s.refresh);
  });
  await waitFor(() => expect(pipeline.buffer).toHaveBeenCalledOnce());
  await act(async () => s.hide());
  await act(async () => s.show());
  await act(async () => {
    pipeline.release();
    await pending;
  });
  expect(s.write).not.toHaveBeenCalled();
  expect(s.selected).not.toHaveBeenCalled();
  expect(s.refresh).not.toHaveBeenCalled();
  expect(receipt().text).toContain("not attempted");
});
it("confirms current-context paste once using captured coordinates and project label", async () => {
  const s = await setup(),
    pipeline = imagePipeline("decode");
  let pending!: Promise<void>;
  await act(async () => {
    pending = s.run(file, { x: 4, y: 8 }, s.selected, s.refresh);
  });
  act(() =>
    s.client.setQueryData(["app"], {
      ...s.state,
      jam: { ...s.state.jam, name: "Renamed after gesture" },
    }),
  );
  await act(async () => {
    pipeline.release();
    await pending;
  });
  expect(s.write).toHaveBeenCalledExactlyOnceWith(Array.from(bytes), 4, 8);
  expect(s.selected).toHaveBeenCalledExactlyOnceWith(item);
  expect(s.refresh).toHaveBeenCalledOnce();
  expect(pipeline.close).toHaveBeenCalledOnce();
  expect(receipt().text).toContain(
    "Captured project [JB] · clipboard image: confirmed",
  );
  expect(receipt().persistent).toBe(false);
});
it.each(["success", "rejection"] as const)(
  "reports postdispatch %s in the captured project without selecting or refreshing a new page",
  async (outcome) => {
    const s = await setup();
    imagePipeline();
    const gate = deferred<typeof item>();
    s.write.mockReturnValueOnce(gate.promise);
    let pending!: Promise<void>;
    await act(async () => {
      pending = s.run(file, { x: 4, y: 8 }, s.selected, s.refresh);
    });
    await waitFor(() => expect(s.write).toHaveBeenCalledOnce());
    act(() => s.switchProject());
    await act(async () => s.hide());
    await act(async () => {
      if (outcome === "success") gate.resolve(item);
      else gate.reject(Error("Response lost after possible persistence"));
      await pending;
    });
    expect(s.write).toHaveBeenCalledOnce();
    expect(s.selected).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();
    expect(receipt().text).toContain(
      `Captured project [JB] · clipboard image: ${outcome === "success" ? "confirmed" : "unconfirmed request"}`,
    );
    expect(receipt().hint).toContain("Refresh references");
    expect(receipt().hint).toContain(s.state.jam?.id);
    expect(receipt().persistent).toBe(true);
    if (outcome === "rejection")
      expect(receipt().hint).toContain("may already have saved");
  },
);
it("suppresses a late receipt and callbacks after the whole app session exits", async () => {
  const s = await setup(),
    pipeline = imagePipeline("decode");
  let pending!: Promise<void>;
  await act(async () => {
    pending = s.run(file, { x: 4, y: 8 }, s.selected, s.refresh);
  });
  s.view.unmount();
  await act(async () => {
    pipeline.release();
    await pending;
  });
  expect(pipeline.close).toHaveBeenCalledOnce();
  expect(s.write).not.toHaveBeenCalled();
  expect(s.selected).not.toHaveBeenCalled();
  expect(s.refresh).not.toHaveBeenCalled();
  expect(useUiStore.getState().toasts).toHaveLength(0);
});
it("distinguishes known preparation failure from an unconfirmed dispatched request", async () => {
  const s = await setup();
  imagePipeline();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockRejectedValue(Error("Invalid synthetic image")),
  );
  await act(async () => {
    await s.run(file, { x: 4, y: 8 }, s.selected, s.refresh);
  });
  expect(s.write).not.toHaveBeenCalled();
  expect(s.refresh).not.toHaveBeenCalled();
  expect(receipt().text).toContain("not attempted");
  imagePipeline();
  s.write.mockRejectedValueOnce(Error("Synthetic native response error"));
  await act(async () => {
    await s.run(file, { x: 4, y: 8 }, s.selected, s.refresh);
  });
  expect(s.write).toHaveBeenCalledOnce();
  expect(s.selected).not.toHaveBeenCalled();
  expect(s.refresh).toHaveBeenCalledOnce();
  expect(receipt().text).toContain("unconfirmed request");
  expect(receipt().hint).toContain("may already have saved");
});
it("does not turn a confirmed write into an uncertain write when the following read fails", async () => {
  const s = await setup();
  imagePipeline();
  s.refresh.mockRejectedValueOnce(Error("Synthetic read failure"));
  await act(async () => {
    await s.run(file, { x: 4, y: 8 }, s.selected, s.refresh);
  });
  expect(s.write).toHaveBeenCalledOnce();
  expect(s.selected).toHaveBeenCalledOnce();
  expect(s.refresh).toHaveBeenCalledOnce();
  expect(receipt().text).toContain("clipboard image: confirmed");
  expect(receipt().details?.[0]?.note).toContain("view refresh not confirmed");
  expect(receipt().persistent).toBe(true);
});

it.each(["draw", "encode", "buffer"] as const)(
  "closes decoded pixels on a known %s preparation failure without a write or read replay",
  async (phase) => {
    const s = await setup(),
      pipeline = imagePipeline();
    if (phase === "draw")
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValueOnce(
        null,
      );
    if (phase === "encode")
      pipeline.encode.mockImplementationOnce((callback) => callback(null));
    if (phase === "buffer")
      pipeline.buffer.mockRejectedValueOnce(Error("Synthetic buffer failure"));
    await act(async () => {
      await s.run(file, { x: 4, y: 8 }, s.selected, s.refresh);
    });
    expect(pipeline.close).toHaveBeenCalledOnce();
    expect(s.write).not.toHaveBeenCalled();
    expect(s.selected).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();
    expect(receipt().text).toContain("not attempted");
    expect(receipt().persistent).toBe(true);
  },
);
