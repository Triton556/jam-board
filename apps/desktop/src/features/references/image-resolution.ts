export type Thumbnail = {
  src: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
};
const thumbnails = new Map<string, Promise<Thumbnail>>();
/** Generation still decodes the original; this is not an initial-decode saving. */
export function decodedImageThumbnail(url: string): Promise<Thumbnail> {
  const cached = thumbnails.get(url);
  if (cached) return cached;
  const pending = (async () => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw Error("Empty image");
    const scale = Math.min(
      1,
      512 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("Image preview unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
      src: canvas.toDataURL("image/webp", 0.82),
      width: canvas.width,
      height: canvas.height,
      originalWidth: image.naturalWidth,
      originalHeight: image.naturalHeight,
    };
  })();
  thumbnails.set(url, pending);
  void pending.catch(() => {
    if (thumbnails.get(url) === pending) thumbnails.delete(url);
  });
  return pending;
}
/** Content-box sizes are untransformed CSS px: apply canvas zoom exactly once. */
export function thumbnailFits(
  thumb: Thumbnail,
  width: number,
  height: number,
  zoom: number,
  dpr: number,
) {
  if (
    ![
      width,
      height,
      zoom,
      dpr,
      thumb.originalWidth,
      thumb.originalHeight,
      thumb.width,
      thumb.height,
    ].every((n) => Number.isFinite(n) && n > 0)
  )
    return false;
  const contain = Math.min(
    width / thumb.originalWidth,
    height / thumb.originalHeight,
  );
  // Integer thumbnail rounding can slightly change aspect ratio. Check its own
  // painted box as well, so even a one-pixel short axis is never enlarged.
  const thumbnailContain = Math.min(width / thumb.width, height / thumb.height);
  return (
    thumb.width >= Math.ceil(thumb.width * thumbnailContain * zoom * dpr) &&
    thumb.height >= Math.ceil(thumb.height * thumbnailContain * zoom * dpr) &&
    thumb.width >= Math.ceil(thumb.originalWidth * contain * zoom * dpr) &&
    thumb.height >= Math.ceil(thumb.originalHeight * contain * zoom * dpr)
  );
}
