import { expect, it } from "vitest";
import { avatarInitials } from "./avatar-initials";

const members = [
  { id: "1", name: "Codex", handle: "codex" },
  { id: "2", name: "Claude", handle: "claude" },
  { id: "3", name: "Danil", handle: "danil" },
] as const;
it("uses one letter unless another jam member shares it", () => {
  expect(avatarInitials(members[0], members)).toBe("Cd");
  expect(avatarInitials(members[1], members)).toBe("Cl");
  expect(avatarInitials(members[2], members)).toBe("D");
});
it("uses handle letters when consonant initials collide, ignoring name case", () => {
  const a = { id: "a", name: "Alice", handle: "alice" };
  const b = { id: "b", name: "alina", handle: "teammate" };
  expect(avatarInitials(a, [a, b])).toBe("al");
  expect(avatarInitials(b, [a, b])).toBe("te");
});
it("handles empty names and Cyrillic names", () => {
  expect(avatarInitials({ id: "x", name: "", handle: "x" }, [])).toBe("?");
  const a = { id: "a", name: "Мира", handle: "mira" };
  const b = { id: "b", name: "Мария", handle: "maria" };
  expect(avatarInitials(a, [a, b])).toBe("mi");
});
