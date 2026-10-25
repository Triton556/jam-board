import { useEffect, useRef } from "react";

/** Dismiss a non-modal surface and return focus without reopening on focus. */
export function useDismissible(open: boolean, onClose: () => void) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    let pointerOutside = false;
    const dismiss = () => {
      (trigger.current ?? root.current?.querySelector("button"))?.focus({
        preventScroll: true,
      });
      close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Tab") pointerOutside = false;
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) dismiss();
      pointerOutside = false;
    };
    const pointer = (event: PointerEvent) => {
      pointerOutside = !root.current?.contains(event.target as Node);
    };
    const focus = (event: FocusEvent) => {
      // Tab/programmatic focus may leave freely; an outside pointer click
      // returns focus in the click handler after its default focus change.
      if (!pointerOutside && !root.current?.contains(event.target as Node))
        close.current();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("focusin", focus);
    // Run before an outside action opens a new dialog and sets its own focus.
    document.addEventListener("click", outside, true);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("click", outside, true);
    };
  }, [open]);
  return { root, trigger };
}
