/** Text is sufficient feedback with reduced motion; no focus or toast side effect. */
export function ReadReceipt({
  phase,
  resource,
  checkedAt,
}: {
  phase: "pending" | "checked" | "error" | null;
  resource: string;
  checkedAt?: number;
}) {
  return (
    <p
      role="status"
      className="read-receipt small muted"
      aria-atomic="true"
      style={phase ? undefined : { margin: 0 }}
    >
      {phase === "pending"
        ? `Checking ${resource}…`
        : phase === "checked"
          ? `Checked ${resource}.`
          : phase === "error"
            ? `Could not check ${resource}. Try again when ready.`
            : ""}
      {phase === "checked" && checkedAt !== undefined && (
        <>
          {" "}
          Last checked:{" "}
          <time dateTime={new Date(checkedAt).toISOString()}>
            {new Date(checkedAt).toLocaleString()}
          </time>
          .
        </>
      )}
    </p>
  );
}
