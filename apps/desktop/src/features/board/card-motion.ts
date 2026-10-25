/** Visual feedback for a real pointer pickup or a confirmed create event only. */
function cardTiming() {
  const style = getComputedStyle(document.documentElement);
  const duration = style.getPropertyValue("--motion-base").trim() || "180ms";
  const curve = style
    .getPropertyValue("--ease-out")
    .match(/[\d.]+/g)
    ?.map(Number);
  return {
    duration:
      Number.parseFloat(duration) / (duration.endsWith("ms") ? 1000 : 1),
    ease: (curve?.length === 4 ? curve : [0.2, 0, 0, 1]) as [
      number,
      number,
      number,
      number,
    ],
  };
}

export function cardMotion(
  reduced: boolean,
  overlay: boolean,
  created: boolean,
) {
  return {
    layout: !reduced && !overlay,
    initial:
      created && !reduced && !overlay
        ? { y: -6, scale: 0.98, rotate: 0 }
        : (false as const),
    animate:
      reduced || !overlay
        ? { y: 0, scale: 1, rotate: 0 }
        : { y: -2, scale: 1.015, rotate: -0.65 },
    transition: reduced ? { duration: 0 } : cardTiming(),
  };
}
