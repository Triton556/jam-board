const padding = 16;

/** Places the clicked world-space paper at readable size without creating data.
 * Only the camera shifts to keep the actual 240×180 paper below controls. */
export function placedNoteLayout(
  world: { x: number; y: number },
  click: { x: number; y: number },
  canvas: { width: number; height: number; toolsBottom: number },
) {
  const width = 240,
    height = 180;
  const x = world.x - width / 2,
    y = world.y - height / 2;
  const left = Math.max(
    padding,
    Math.min(click.x - width / 2, canvas.width - width - padding),
  );
  const top = Math.max(
    canvas.toolsBottom + padding,
    Math.min(click.y - height / 2, canvas.height - height - padding),
  );
  return {
    x,
    y,
    maxHeight: Math.max(1, canvas.height - top - padding),
    viewport: { x: left - x, y: top - y, zoom: 1 },
  };
}
