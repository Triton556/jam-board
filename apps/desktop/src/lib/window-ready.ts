/** Hidden webviews may suspend animation frames. Never require a paint before show. */
async function waitForFonts(fonts: Promise<unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      fonts.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function visiblePaint(timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    let frame = 0;
    const finish = (paintObserved: boolean) => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      resolve(paintObserved);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => finish(true));
    });
  });
}
/** Theme/data are already committed. Fonts/paint improve appearance, not liveness. */
export async function showReadyWindow(input: {
  fontsReady: Promise<unknown>;
  show(): Promise<void>;
  ready(): Promise<void>;
}) {
  await waitForFonts(input.fontsReady, 250);
  await input.show();
  // The native receipt is a first-frame measurement. Do not fabricate it when
  // the compositor is suspended or the window is immediately minimized.
  if (await visiblePaint(250)) await input.ready();
}
