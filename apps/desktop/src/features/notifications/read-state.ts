// Only read-position metadata is retained; never notification text or payloads.
const key = "jam.notification-read.v1";
type Baseline = { project: string; member: string; seq: number };
function read(): Baseline[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (v): v is Baseline =>
              typeof v?.project === "string" &&
              typeof v?.member === "string" &&
              Number.isSafeInteger(v?.seq) &&
              v.seq >= 0,
          )
          .slice(-100)
      : [];
  } catch {
    return [];
  }
}
export function readBaseline(project: string, member: string): number | null {
  return (
    read().find((v) => v.project === project && v.member === member)?.seq ??
    null
  );
}
export function markBaseline(
  project: string,
  member: string,
  seq: number,
): boolean {
  if (!Number.isSafeInteger(seq) || seq < 0) return false;
  const rows = read();
  const old = rows.find((v) => v.project === project && v.member === member);
  const next = [
    ...rows.filter((v) => v !== old),
    { project, member, seq: Math.max(seq, old?.seq ?? 0) },
  ].slice(-100);
  try {
    localStorage.setItem(key, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
