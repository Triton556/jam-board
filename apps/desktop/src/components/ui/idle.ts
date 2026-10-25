/** Keep endpoint DOM removal out of the animation's final frame. */
export function scheduleIdle(callback: () => void) {
  if (
    typeof window.requestIdleCallback === "function" &&
    typeof window.cancelIdleCallback === "function"
  ) {
    const cancel = window.cancelIdleCallback.bind(window);
    const id = window.requestIdleCallback(callback, { timeout: 1000 });
    return () => cancel(id);
  }
  const id = window.setTimeout(callback, 50);
  return () => window.clearTimeout(id);
}
