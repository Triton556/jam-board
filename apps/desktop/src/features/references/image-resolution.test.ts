import { describe, expect, it, vi } from "vitest";
import {
  decodedImageThumbnail,
  type Thumbnail,
  thumbnailFits,
} from "./image-resolution";

const thumb: Thumbnail = {
  src: "thumb",
  width: 512,
  height: 256,
  originalWidth: 2048,
  originalHeight: 1024,
};
describe("VS03 image resolution invariant", () => {
  it.each([0.39, 0.4, 0.75, 0.99, 1, 1.25, 2, 4])(
    "selects by painted pixels at zoom %s and each DPR",
    (zoom) => {
      for (const dpr of [1, 1.25, 1.5, 2]) {
        expect(thumbnailFits(thumb, 600, 400, zoom, dpr)).toBe(
          512 >= Math.ceil(600 * zoom * dpr) &&
            256 >= Math.ceil(300 * zoom * dpr),
        );
      }
    },
  );
  it("accounts for contain letterboxing, both dimensions and fractional ceiling", () => {
    expect(thumbnailFits(thumb, 1000, 100, 1, 2)).toBe(true);
    expect(thumbnailFits({ ...thumb, height: 255 }, 512, 256, 1, 1)).toBe(
      false,
    );
    expect(thumbnailFits(thumb, 512.01, 300, 1, 1)).toBe(false);
    expect(thumbnailFits(thumb, 0, 300, 1, 1)).toBe(false);
    expect(thumbnailFits(thumb, 300, 300, Number.NaN, 1)).toBe(false);
  });
  it("decodes original, records actual rounded dimensions, shares pending and evicts failure", async () => {
    const decode = vi
      .fn()
      .mockRejectedValueOnce(Error("decode"))
      .mockResolvedValue(undefined);
    const ImageMock = class {
      naturalWidth = 2048;
      naturalHeight = 1001;
      src = "";
      crossOrigin = "";
      decode = decode;
    };
    vi.stubGlobal("Image", ImageMock);
    const draw = vi.fn();
    const context = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
        drawImage: draw,
      } as unknown as CanvasRenderingContext2D);
    const data = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:thumb");
    try {
      const first = decodedImageThumbnail("generation-test");
      expect(decodedImageThumbnail("generation-test")).toBe(first);
      await expect(first).rejects.toThrow("decode");
      const result = await decodedImageThumbnail("generation-test");
      expect(result).toEqual({
        src: "data:thumb",
        width: 512,
        height: 250,
        originalWidth: 2048,
        originalHeight: 1001,
      });
      expect(draw).toHaveBeenCalledWith(
        expect.objectContaining({ src: "generation-test" }),
        0,
        0,
        512,
        250,
      );
      expect(decode).toHaveBeenCalledTimes(2);
    } finally {
      context.mockRestore();
      data.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
