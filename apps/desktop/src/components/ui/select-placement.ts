type Rect = { left: number; right: number; top: number; bottom: number };

/** CSS-pixel geometry; keep the popup inside both viewport and scroll clips. */
export function selectPlacement(
  anchor: Rect,
  root: Rect,
  clip: Rect,
  height: number,
) {
  const gap = 4;
  const padding = 8;
  const leftEdge = clip.left + padding;
  const rightEdge = Math.max(leftEdge, clip.right - padding);
  const width = Math.max(
    1,
    Math.min(Math.max(anchor.right - anchor.left, 230), rightEdge - leftEdge),
  );
  const above = Math.max(0, anchor.top - clip.top - padding - gap);
  const below = Math.max(0, clip.bottom - padding - anchor.bottom - gap);
  const up = height > below && above > below;
  const maxHeight = Math.max(1, Math.min(300, up ? above : below));
  const shownHeight = Math.min(Math.max(1, height), maxHeight);
  return {
    side: up ? "above" : "below",
    left:
      Math.max(leftEdge, Math.min(anchor.left, rightEdge - width)) - root.left,
    top: (up ? anchor.top - gap - shownHeight : anchor.bottom + gap) - root.top,
    width,
    maxHeight,
  };
}

export function selectClip(element: HTMLElement): Rect {
  const viewport = window.visualViewport;
  const clip = {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth),
    bottom:
      (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
  };
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      clip.left = Math.max(clip.left, bounds.left);
      clip.right = Math.min(clip.right, bounds.right);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      clip.top = Math.max(clip.top, bounds.top);
      clip.bottom = Math.min(clip.bottom, bounds.bottom);
    }
  }
  return clip;
}
