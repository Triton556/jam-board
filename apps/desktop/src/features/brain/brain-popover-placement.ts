import { type RefObject, useLayoutEffect } from "react";

/** Keep every dock popover within the viewport, including left-edge anchors. */
export function useBrainPopoverPlacement(
  node: RefObject<HTMLElement | null>,
  open = true,
) {
  useLayoutEffect(() => {
    const element = node.current;
    if (!open || !element) return;
    const place = () => {
      element.style.marginLeft = "0px";
      element.style.marginRight = "0px";
      element.style.marginTop = "0px";
      element.style.marginBottom = "0px";
      element.style.maxHeight = "";
      element.style.maxHeight = `${Math.min(Number.parseFloat(getComputedStyle(element).maxHeight) || window.innerHeight, window.innerHeight - 16)}px`;
      const bounds = element.getBoundingClientRect();
      const historyBounds = element
        .closest(".brain-history")
        ?.getBoundingClientRect();
      if (
        bounds.bottom >
        Math.min(
          window.innerHeight,
          historyBounds?.bottom ?? window.innerHeight,
        ) -
          8
      ) {
        element.style.top = "auto";
        element.style.bottom = "calc(100% + 4px)";
      }
      const placed = element.getBoundingClientRect();
      const shiftX = Math.max(
        8 - placed.left,
        Math.min(0, window.innerWidth - 8 - placed.right),
      );
      const shiftY = Math.max(
        8 - placed.top,
        Math.min(0, window.innerHeight - 8 - placed.bottom),
      );
      element.style.marginLeft = `${shiftX}px`;
      element.style.marginRight = `${-shiftX}px`;
      element.style.marginTop = `${shiftY}px`;
      element.style.marginBottom = `${-shiftY}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    const dock = element.closest(".brain-dock");
    const settled = (event: Event) => {
      if (event.target === dock) place();
    };
    dock?.addEventListener("animationend", settled);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      dock?.removeEventListener("animationend", settled);
    };
  }, [node, open]);
}
