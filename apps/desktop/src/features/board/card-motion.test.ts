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
    transition: { stiffness: 460, damping: 34 },
  });
  expect(cardMotion(false, true, true).initial).toBe(false);
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
