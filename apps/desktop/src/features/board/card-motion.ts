/** Visual feedback for a real pointer pickup or a confirmed create event only. */
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
    transition: reduced
      ? { duration: 0 }
      : { type: "spring" as const, stiffness: 460, damping: 34 },
  };
}
