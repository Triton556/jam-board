/** The same live flow bounds protect explicit Fit and initial inline-note placement. */
export function referenceControlsBottom(container: HTMLElement | null): number {
  const stack = container?.querySelector<HTMLElement>(
    ".reference-control-stack",
  );
  if (!container || !stack) return 0;
  return Math.max(
    0,
    stack.getBoundingClientRect().bottom -
      container.getBoundingClientRect().top,
  );
}
