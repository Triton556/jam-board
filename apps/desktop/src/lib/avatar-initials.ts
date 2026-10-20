import type { MemberRef } from "../bindings";

type Identity = Pick<MemberRef, "id" | "name" | "handle">;
export function avatarInitials(
  member: Identity,
  allMembers: readonly Identity[],
): string {
  const letters = [...member.name.trim()];
  const first = letters[0]?.toLocaleUpperCase() ?? "?";
  const peers = allMembers.filter(
    (other) =>
      other.id !== member.id &&
      [...other.name.trim()][0]?.toLocaleUpperCase() === first,
  );
  if (!peers.length) return first;
  const pair = (name: string) => {
    const chars = [...name.trim()];
    const consonant = chars
      .slice(1)
      .find((char) => /\p{L}/u.test(char) && !/[aeiouаеёиоуыэюя]/iu.test(char));
    return `${chars[0]?.toLocaleUpperCase() ?? "?"}${(consonant ?? chars[1] ?? "").toLocaleLowerCase()}`;
  };
  const candidate = pair(member.name);
  return peers.some((other) => pair(other.name) === candidate)
    ? [...member.handle].slice(0, 2).join("")
    : candidate;
}
