let raster: Promise<void> | undefined;
export function preparePaperGrain() {
  raster ??= new Promise<void>((resolve) => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>';
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      document.documentElement.style.setProperty(
        "--grain",
        `url(${canvas.toDataURL("image/png")})`,
      );
      resolve();
    };
    image.onerror = () => resolve();
    image.src = `data:image/svg+xml,${encodeURIComponent(source)}`;
  });
  return raster;
}
