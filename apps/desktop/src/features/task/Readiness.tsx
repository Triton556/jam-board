import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, Minus } from "lucide-react";
import { useState } from "react";
import type { Readiness } from "../../bindings";
import { Button, Dialog } from "../../components/ui";
import { api } from "../../lib/api";
import { invalidatePlanning } from "../../lib/planning-queries";
import { useUiStore } from "../../lib/ui-store";
export const readyLabels = {
  goal: "Goal",
  where: "Where",
  change: "Change",
  test: "Test",
  result: "Result",
  story_active: "Story active",
};
export function ReadinessStrip({
  readiness,
  status,
  onMark,
}: {
  readiness: Readiness;
  status: string;
  onMark(): void;
}) {
  return (
    <section className="readiness-strip" aria-label="Brief readiness">
      <div>
        {Object.entries(readyLabels).map(([code, label]) => {
          const missing = readiness.missing.some((i) => i.code === code);
          return (
            <span
              key={code}
              data-readiness={code}
              data-missing={missing}
              title={
                readiness.missing.find((i) => i.code === code)?.message ??
                "Complete"
              }
              className={missing ? "muted" : "ok"}
            >
              {missing ? <Minus size={12} /> : <Check size={12} />} {label}
            </span>
          );
        })}
      </div>
      {status === "backlog" && <Button onClick={onMark}>Mark ready</Button>}
    </section>
  );
}
export function validOverride(reason: string) {
  return reason.trim().length >= 10;
}
export function ReadinessDialog() {
  const request = useUiStore((s) => s.readyRequest);
  return request ? <ReadyDialog key={request.key} /> : null;
}
function ReadyDialog() {
  const request = useUiStore((s) => s.readyRequest);
  const key = request?.key ?? "";
  const readiness = useQuery({
    queryKey: ["readiness", key],
    queryFn: () => api.checkReady(key),
  });
  const task = useQuery({
    queryKey: ["task", key],
    queryFn: () => api.getTask(key),
  });
  const [override, setOverride] = useState(false),
    [reason, setReason] = useState("");
  const client = useQueryClient(),
    navigate = useNavigate();
  const close = () => useUiStore.setState({ readyRequest: null });
  const save = useMutation({
    mutationFn: () =>
      api.moveTask({
        ...request,
        key,
        status: "ready",
        overrideReason: reason.trim(),
      }),
    onSuccess: () => {
      close();
      invalidatePlanning(client);
    },
    onError: (e) => useUiStore.getState().error(e.message),
  });
  const fix = (code: string) => {
    close();
    if (code === "story_active" && task.data) {
      void navigate({
        to: "/plan/$epicKey",
        params: { epicKey: task.data.epic.key },
        search: { story: task.data.story.key },
      });
      return;
    }
    void navigate({ to: "/board", search: { task: key } });
    setTimeout(
      () =>
        document.querySelector(`[data-brief-field="${code}"]`)?.scrollIntoView({
          block: "center",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        }),
      200,
    );
  };
  return (
    <Dialog title={`Not ready · ${key}`} onClose={close}>
      <p>Complete the brief so a worker knows what success looks like.</p>
      <ul className="readiness-issues">
        {readiness.data?.missing.map((issue) => (
          <li key={issue.code}>
            <span>{issue.message}</span>
            <Button onClick={() => fix(issue.code)}>Fix</Button>
          </li>
        ))}
      </ul>
      {readiness.error && <p role="alert">{readiness.error.message}</p>}
      {override && (
        <label className="field">
          Reason
          <textarea
            aria-label="Override reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this brief ready despite the missing details?"
          />
          <small>
            Use at least 10 characters. This reason stays in the journal.
          </small>
        </label>
      )}
      <div className="dialog-actions">
        <Button onClick={close}>Keep in Backlog</Button>
        {override ? (
          <Button
            variant="primary"
            disabled={!validOverride(reason) || save.isPending}
            onClick={() => save.mutate()}
          >
            Move anyway
          </Button>
        ) : (
          <Button onClick={() => setOverride(true)}>Move anyway…</Button>
        )}
      </div>
    </Dialog>
  );
}
