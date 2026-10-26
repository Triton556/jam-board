import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RefItem } from "../../bindings";
import { decodedImageThumbnail, type Thumbnail } from "./image-resolution";
import { AudioMedia, ImageMedia, VideoMedia } from "./Media";
import { CanvasContext, type CanvasRuntime } from "./runtime";

let zoom = 0.75;
vi.mock("@xyflow/react", () => ({
  useStore: (select: (s: { transform: number[] }) => unknown) =>
    select({ transform: [0, 0, zoom] }),
}));
vi.mock("./image-resolution", async (actual) => ({
  ...(await actual<object>()),
  decodedImageThumbnail: vi.fn(),
}));
const lightbox = vi.fn();
const runtime = { lightbox } as unknown as CanvasRuntime;
const thumbnail: Thumbnail = {
  src: "data:thumb",
  width: 512,
  height: 256,
  originalWidth: 2048,
  originalHeight: 1024,
};
let resize: ResizeObserverCallback;
const disconnect = vi.fn();
function view(url = "original") {
  return (
    <CanvasContext.Provider value={runtime}>
      <ImageMedia url={url} title="Reference" />
    </CanvasContext.Provider>
  );
}
function measure(width = 600, height = 400) {
  act(() =>
    resize(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      {} as ResizeObserver,
    ),
  );
}
beforeEach(() => {
  zoom = 0.75;
  lightbox.mockClear();
  disconnect.mockClear();
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 1,
  });
  vi.mocked(decodedImageThumbnail).mockReset().mockResolvedValue(thumbnail);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: ResizeObserverCallback) {
        resize = cb;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("VS03 media source and lifetime (DOM, not native clarity)", () => {
  it.each([1, 2])(
    "uses the original at zoom 1/2/4 on DPR %s and restores thumbnails when zoomed out",
    async (dpr) => {
      Object.defineProperty(window, "devicePixelRatio", { value: dpr });
      const { rerender } = render(view("full-resolution-media"));
      await act(async () => {});
      measure();
      for (const value of [1, 2, 4]) {
        zoom = value;
        rerender(view("full-resolution-media"));
        expect(screen.getByRole("img")).toHaveAttribute(
          "src",
          "full-resolution-media",
        );
      }
      zoom = 0.2;
      rerender(view("full-resolution-media"));
      expect(screen.getByRole("img")).toHaveAttribute("src", "data:thumb");
    },
  );
  it("audio and video previews allow body dragging and keep only player controls non-draggable", async () => {
    const item = {
      id: "audio",
      kind: "asset",
      title: "Audio",
      metadata: JSON.stringify({ peaks: [0.5], duration: 1 }),
    } as RefItem;
    const view = render(
      <CanvasContext.Provider value={runtime}>
        <AudioMedia url="data:audio/wav;base64," item={item} />
        <VideoMedia url="data:video/webm;base64," title="Clip" />
      </CanvasContext.Provider>,
    );
    expect(view.container.querySelector(".reference-audio")).not.toHaveClass(
      "nodrag",
    );
    expect(screen.getByRole("button", { name: "Play audio" })).toHaveClass(
      "nodrag",
    );
    expect(screen.getByRole("slider", { name: "Audio position" })).toHaveClass(
      "nodrag",
    );
    const video = view.container.querySelector("video");
    expect(video).not.toHaveClass("nodrag");
    expect(video).not.toHaveAttribute("controls");
    if (!video) throw Error("Missing video");
    fireEvent.doubleClick(video);
    expect(lightbox).toHaveBeenCalledWith(
      "data:video/webm;base64,",
      "Clip",
      "video",
    );
    await act(async () => {});
  });
  it("never has undefined src while pending; selects by measured size, zoom and changing DPR", async () => {
    const { rerender } = render(view());
    expect(screen.getByRole("img")).toHaveAttribute("src", "original");
    await act(async () => {});
    measure();
    expect(screen.getByRole("img")).toHaveAttribute("src", "data:thumb");
    zoom = 1;
    rerender(view());
    expect(screen.getByRole("img")).toHaveAttribute("src", "original");
    measure(400, 400);
    expect(screen.getByRole("img")).toHaveAttribute("src", "data:thumb");
    Object.defineProperty(window, "devicePixelRatio", { value: 2 });
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("img")).toHaveAttribute("src", "original");
    const body = screen.getByRole("button", { name: "Open Reference" });
    expect(body).not.toHaveClass("nodrag");
    fireEvent.click(body);
    expect(lightbox).not.toHaveBeenCalled();
    fireEvent.doubleClick(body);
    expect(lightbox).toHaveBeenCalledWith("original", "Reference");
    lightbox.mockClear();
    body.focus();
    expect(body).toHaveFocus();
    for (const key of ["Enter", " "]) {
      fireEvent.keyDown(body, { key });
      expect(lightbox).toHaveBeenLastCalledWith("original", "Reference");
    }
    expect(lightbox).toHaveBeenCalledTimes(2);
  });
  it("thumbnail error falls back once; original failure is explicit and retry reloads original", async () => {
    render(view());
    await act(async () => {});
    measure();
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("img")).toHaveAttribute("src", "original");
    measure(200, 200);
    expect(screen.getByRole("img")).toHaveAttribute("src", "original");
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("status")).toHaveTextContent("Image unavailable");
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry image" }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "original");
    fireEvent.load(screen.getByRole("img"));
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("generation rejection keeps original and does not label all images pixel art", async () => {
    vi.mocked(decodedImageThumbnail).mockRejectedValue(Error("decode"));
    render(view());
    await act(async () => {});
    measure();
    const image = screen.getByRole("img");
    expect(image).toHaveAttribute("src", "original");
    Object.defineProperties(image, {
      naturalWidth: { value: 2000, configurable: true },
      naturalHeight: { value: 1000, configurable: true },
    });
    fireEvent.load(image);
    expect(image).toHaveStyle({ imageRendering: "auto" });
    Object.defineProperties(image, {
      naturalWidth: { value: 64 },
      naturalHeight: { value: 64 },
    });
    fireEvent.load(image);
    expect(image).toHaveStyle({ imageRendering: "pixelated" });
  });
  it("does not show a decoded old thumbnail even for the first render of a new URL", async () => {
    const { rerender } = render(view("A"));
    await act(async () => {});
    measure();
    expect(screen.getByRole("img")).toHaveAttribute("src", "data:thumb");
    vi.mocked(decodedImageThumbnail).mockImplementationOnce(
      () => new Promise(() => {}),
    );
    rerender(view("B"));
    expect(screen.getByRole("img")).toHaveAttribute("src", "B");
    expect(screen.getByRole("img")).toHaveStyle({ imageRendering: "auto" });
  });
  it("URL A→B→A ignores stale completions; unmount disconnects observer", async () => {
    let resolveA!: (value: Thumbnail) => void;
    vi.mocked(decodedImageThumbnail)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => new Promise(() => {}));
    const { rerender, unmount } = render(view("A"));
    measure();
    rerender(view("B"));
    expect(screen.getByRole("img")).toHaveAttribute("src", "B");
    rerender(view("A"));
    measure();
    await act(async () => resolveA(thumbnail));
    expect(screen.getByRole("img")).toHaveAttribute("src", "A");
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(3);
  });
});
it("audio controls expose exactly one shared tooltip on keyboard focus", async () => {
  const item = {
    id: "audio-tooltip",
    kind: "asset",
    title: "Audio",
    metadata: JSON.stringify({ peaks: [0.5], duration: 2 }),
  } as RefItem;
  render(
    <CanvasContext.Provider value={runtime}>
      <AudioMedia url="data:audio/wav;base64," item={item} />
    </CanvasContext.Provider>,
  );
  const play = screen.getByRole("button", { name: "Play audio" });
  expect(play).not.toHaveAttribute("title");
  act(() => play.focus());
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Play audio");
  expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  act(() => screen.getByRole("slider", { name: "Audio position" }).focus());
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Audio position",
  );
  expect(screen.getAllByRole("tooltip")).toHaveLength(1);
});
