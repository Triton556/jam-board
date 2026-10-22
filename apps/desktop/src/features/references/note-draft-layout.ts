export const noteDraftWidth = 340;
const padding = 16;

/** Initial placement only: entering edit deliberately uses readable, at-most-100% zoom. */
export function noteDraftLayout(
  center: { x: number; y: number },
  canvas: { width: number; height: number; toolsBottom: number },
) {
  const zoom = Math.min(
    1,
    Math.max(0.1, (canvas.width - padding * 2) / noteDraftWidth),
  );
  const top = Math.max(padding, canvas.toolsBottom + padding);
  const maxHeight = Math.max(
    1,
    Math.min(480, (canvas.height - top - padding) / zoom),
  );
  return {
    zoom,
    x: center.x - noteDraftWidth / 2,
    y: center.y + (top - canvas.height / 2) / zoom,
    maxHeight,
  };
}
