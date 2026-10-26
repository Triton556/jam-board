export function contentRoute(): string | undefined;
export function observeFirstPaint(
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
): void;
