export function isEditing(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    !!target.closest('input,textarea,select,[contenteditable="true"]')
  );
}
export function shortcutAction(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "target"
  >,
  previousG: number,
  now: number,
) {
  if (isEditing(event.target) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "k") return "palette";
  if (event.ctrlKey || event.metaKey) return null;
  if (previousG > 0 && now - previousG < 800 && ["b", "t", "a"].includes(key))
    return key === "b" ? "/board" : key === "t" ? "/table" : "/activity";
  return key === "g"
    ? "prefix"
    : key === "n"
      ? "new"
      : key === "?"
        ? "help"
        : null;
}
