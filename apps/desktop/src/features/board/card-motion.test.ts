import { expect, it } from "vitest";
import { cardMotion } from "./card-motion";

it("only the actual drag overlay lifts; ordinary and reported-working cards stay still", () => {
  expect(cardMotion(false, false, false)).toMatchObject({
    initial: false,
    animate: { y: 0, scale: 1, rotate: 0 },
  });
  expect(cardMotion(false, true, false)).toMatchObject({
    layout: false,
    initial: false,
    animate: { y: -2, scale: 1.015, rotate: -0.65 },
  });
});
it("a confirmed created card has a small settle, not an activity loop", () => {
  expect(cardMotion(false, false, true)).toMatchObject({
    initial: { y: -6, scale: 0.98 },
    animate: { y: 0, scale: 1 },
    transition: { duration: 0.18, ease: [0.2, 0, 0, 1] },
  });
  expect(cardMotion(false, true, true).initial).toBe(false);
});
it("pickup and layout feedback follow the document motion tokens", () => {
  const root = document.documentElement;
  root.style.setProperty("--motion-base", "240ms");
  root.style.setProperty("--ease-out", "cubic-bezier(0.3, 0, 0.1, 1)");
  try {
    expect(cardMotion(false, true, false).transition).toEqual({
      duration: 0.24,
      ease: [0.3, 0, 0.1, 1],
    });
  } finally {
    root.style.removeProperty("--motion-base");
    root.style.removeProperty("--ease-out");
  }
});
it.each([false, true])(
  "reduced motion removes pickup and create transforms and layout animation (overlay=%s)",
  (overlay) => {
    expect(cardMotion(true, overlay, true)).toEqual({
      layout: false,
      initial: false,
      animate: { y: 0, scale: 1, rotate: 0 },
      transition: { duration: 0 },
    });
  },
);
