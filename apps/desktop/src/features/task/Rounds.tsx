import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Report, ReviewTask } from "../../bindings";
import { Markdown } from "../../components/Markdown";
import { Avatar, Button, Dialog, Stamp } from "../../components/ui";
import { api } from "../../lib/api";
import { invalidatePlanning } from "../../lib/planning-queries";
import { relativeTime } from "../../lib/time";
import { JamError, type Member, type TaskDetail } from "../../lib/types";
import { ReportEvidence } from "./ReportEvidence";
import { ReviewContext } from "./ReviewContext";
export function ReviewDialog({
  report,
  close,
  onReview,
  pending = false,
  error,
  context,
  changed = false,
  refreshing = false,
  refreshed = false,
  refresh,
}: {
  report: Report;
  pending?: boolean;
  error?: string;
  context?: TaskDetail;
  changed?: boolean;
  refreshing?: boolean;
  refreshed?: boolean;
  refresh?(): void;
  close(): void;
  onReview(input: Pick<ReviewTask, "commentsMd" | "failedTests">): void;
}) {
  const [comments, setComments] = useState(""),
    [failed, setFailed] = useState<string[]>([]);
  const capturedHeading = useRef<HTMLHeadingElement>(null);
  const commentsField = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: every explicitly reread snapshot needs focus, including a second reread while refreshed remains true.
  useEffect(() => {
    if (refreshed) capturedHeading.current?.focus();
  }, [refreshed, context?.reviewContextRevision, report.id]);
  const missingTests = failed.filter(
    (name) => !report.tests.some((test) => test.name === name),
  );
  return (
    <Dialog
      title="Request changes"
      className="review-decision-dialog"
      busy={pending}
      onClose={() => {
        if (!pending) close();
      }}
    >
      <p className="small">
        Reviewing {context?.key ?? "task"} · report round {report.round}
      </p>
      {changed && (
        <p role="alert" className="review-context-changed">
          Evidence changed. Your comments and test choices are kept. Read the
          latest evidence and reconcile them before sending.
        </p>
      )}
      {refresh && (changed || error) && (
        <Button disabled={pending || refreshing} onClick={refresh}>
          {refreshing ? "Reading latest…" : "Read latest evidence"}
        </Button>
      )}
      {refreshed && !changed && (
        <p role="status">
          Latest evidence loaded. Your draft is kept; check the criteria and
          test choices before submitting.
        </p>
      )}
      <div className="review-reading-navigation">
        <span className="small">
          Full report below · scroll this dialog to read the evidence.
        </span>
        <Button
          disabled={pending}
          onClick={() => commentsField.current?.focus()}
        >
          Go to comments
        </Button>
      </div>
      <div className="review-captured-report">
        <h3 ref={capturedHeading} tabIndex={-1}>
          Captured report
        </h3>
        <ReportEvidence report={report} expandFiles={refreshed} />
      </div>
      {context && <ReviewContext task={context} expanded={refreshed} />}
      <Button
        disabled={pending}
        onClick={() => capturedHeading.current?.focus()}
      >
        Back to captured report
      </Button>
      <label className="field">
        Comments
        <textarea
          ref={commentsField}
          aria-label="Review comments"
          disabled={pending}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          required
        />
      </label>
      <fieldset className="failed-tests" disabled={pending}>
        <legend>Failed tests from round {report.round}</legend>
        {report.tests.map((t) => (
          <label key={t.name}>
            <input
              type="checkbox"
              checked={failed.includes(t.name)}
              onChange={(e) =>
                setFailed(
                  e.target.checked
                    ? [...failed, t.name]
                    : failed.filter((n) => n !== t.name),
                )
              }
            />
            <span>
              <b>{t.name}</b> · {t.expected}{" "}
              <Stamp className={`test-${t.result.toLowerCase()}`}>
                {t.result}
              </Stamp>
            </span>
          </label>
        ))}
      </fieldset>
      {missingTests.length > 0 && (
        <fieldset className="failed-tests">
          <legend>Earlier test choices to reconcile</legend>
          <p className="small">
            These selected tests are not in this report. Keep their concern in
            your comments, then remove the obsolete selection.
          </p>
          {missingTests.map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                checked
                disabled={pending}
                onChange={() =>
                  setFailed(failed.filter((item) => item !== name))
                }
              />
              {name}
            </label>
          ))}
        </fieldset>
      )}
      <p className="small muted">
        The task returns to Ready for another round. New work still needs scope
        permission.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <Button disabled={pending} onClick={close}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={
            pending ||
            refreshing ||
            changed ||
            missingTests.length > 0 ||
            !comments.trim()
          }
          onClick={() =>
            onReview({ commentsMd: comments.trim(), failedTests: failed })
          }
        >
          {pending ? "Saving review…" : "Request changes"}
        </Button>
      </div>
    </Dialog>
  );
}
export function Rounds({
  task,
  members,
  hasUnsavedEdits = false,
}: {
  task: TaskDetail;
  members: Member[];
  hasUnsavedEdits?: boolean;
}) {
  const [request, setRequest] = useState(false);
  const [evidence, setEvidence] = useState(task);
  const [observedRevision, setObservedRevision] = useState(
    task.reviewContextRevision,
  );
  const [refreshed, setRefreshed] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (notice) heading.current?.focus();
  }, [notice]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus follows each explicit snapshot replacement, not only the first successful reread.
  useEffect(() => {
    if (refreshed && !request) heading.current?.focus();
  }, [refreshed, request, evidence.reviewContextRevision]);
  const client = useQueryClient();
  const changed =
    conflicted ||
    (task.reviewContextRevision !== observedRevision &&
      task.reviewContextRevision !== evidence.reviewContextRevision);
  const refresh = useMutation({
    mutationFn: async () => {
      const latestTask = await api.getTask(evidence.key);
      if (latestTask.id !== evidence.id || latestTask.jamId !== evidence.jamId)
        throw new Error(
          "The selected project or task changed. This review was not retargeted.",
        );
      if (request && latestTask.status !== "review")
        throw new Error(
          "This result is no longer awaiting review. Your comments are kept; close this dialog after saving any notes you need.",
        );
      return latestTask;
    },
    onSuccess: (latestTask) => {
      setObservedRevision(task.reviewContextRevision);
      setEvidence(latestTask);
      setRefreshed(true);
      setNotice("");
      setConflicted(false);
      review.reset();
      client.setQueryData(["task", latestTask.key], latestTask);
    },
  });
  const review = useMutation({
    mutationFn: (input: ReviewTask) => api.reviewTask(input),
    onSuccess: async (_review, input) => {
      setRequest(false);
      setRefreshed(false);
      setNotice(
        input.verdict === "accept"
          ? "Result accepted. The task moved to Done."
          : "Changes requested. The task returned to Ready for another round; new work still needs scope permission.",
      );
      invalidatePlanning(client);
      // Display our completed decision, but never silently authorize a successor report.
      try {
        const updated = await api.getTask(input.key);
        if (
          updated.id === evidence.id &&
          updated.jamId === evidence.jamId &&
          updated.status !== "review"
        ) {
          setEvidence(updated);
          setObservedRevision(task.reviewContextRevision);
        }
      } catch {
        /* The receipt is confirmed; a later explicit refresh can load its history. */
      }
    },
    onError: (error) => {
      if (
        error instanceof JamError &&
        ["conflict", "stale_claim", "wrong_status"].includes(error.code)
      )
        setConflicted(true);
      invalidatePlanning(client);
    },
  });
  const latest = evidence.reports.find(
    (r) => r.round === (evidence.reviewRound ?? 0),
  );
  const author = (id: string) => members.find((m) => m.id === id);
  const rounds = [
    ...new Set([
      ...evidence.reports.map((r) => r.round),
      ...evidence.reviews.map((r) => r.round),
    ]),
  ].sort((a, b) => b - a);
  const reviewActions = evidence.status === "review" && latest && (
    <div className="button-row">
      <Button
        variant="primary"
        disabled={
          review.isPending ||
          refresh.isPending ||
          changed ||
          hasUnsavedEdits ||
          !evidence.reviewContextRevision
        }
        onClick={() =>
          review.mutate({
            key: evidence.key,
            expectedReportId: latest.id,
            expectedReviewContextRevision: evidence.reviewContextRevision ?? "",
            verdict: "accept",
            commentsMd: "Accepted after checking the report and acceptance.",
            failedTests: [],
          })
        }
      >
        Accept result
      </Button>
      <Button
        disabled={
          review.isPending ||
          refresh.isPending ||
          changed ||
          hasUnsavedEdits ||
          !evidence.reviewContextRevision
        }
        onClick={() => {
          review.reset();
          setNotice("");
          refresh.reset();
          setRefreshed(false);
          setRequest(true);
        }}
      >
        Request changes…
      </Button>
    </div>
  );
  return (
    <section className="task-section rounds">
      <h2 ref={heading} tabIndex={-1}>
        Reports &amp; review
      </h2>
      {notice && (
        <p role="status" className="execution-feedback">
          {notice}
        </p>
      )}
      {hasUnsavedEdits && evidence.status === "review" && (
        <p className="small muted">
          Save or discard your task edits before reviewing. Review uses saved
          criteria, not unsaved changes.
        </p>
      )}
      {!request && (changed || review.error) && (
        <div className="review-context-changed">
          <p role="alert">
            The report or task/story/epic context changed, or this decision
            could not be saved. The displayed snapshot has not been replaced.
          </p>
          <Button
            disabled={refresh.isPending || review.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? "Reading latest…" : "Read latest evidence"}
          </Button>
        </div>
      )}
      {refresh.error && !request && <p role="alert">{refresh.error.message}</p>}
      {refreshed && evidence.status === "review" && !request && !changed && (
        <p role="status">
          Latest evidence loaded. Inspect this report and its captured criteria
          before accepting.
        </p>
      )}
      {!rounds.length && (
        <p className="muted">
          The worker's report and your review will appear here.
        </p>
      )}
      {rounds.map((round) => {
        const report = evidence.reports.find((r) => r.round === round),
          verdict = evidence.reviews.find((r) => r.round === round);
        return (
          <details className="round" key={round} open={round === rounds[0]}>
            <summary>
              Round {round}
              {round === rounds[0]
                ? changed
                  ? " · Previously read"
                  : " · Latest read"
                : " · Earlier evidence"}
            </summary>
            {report && (
              <section
                className="report-card"
                aria-label={
                  report.round ===
                  Math.max(...evidence.reports.map((item) => item.round))
                    ? "Latest report"
                    : `Report round ${round}`
                }
              >
                <div className="comment-author">
                  {author(report.authorId) && (
                    <Avatar member={author(report.authorId) as Member} />
                  )}
                  <b>{author(report.authorId)?.name ?? "Worker"}</b>
                  <time>{relativeTime(report.createdAt)}</time>
                </div>
                <ReportEvidence report={report} />
                {round === evidence.reviewRound && (
                  <ReviewContext task={evidence} expanded={refreshed} />
                )}
              </section>
            )}
            {verdict && (
              <section
                className={`review-card ${verdict.verdict}`}
                aria-label={
                  verdict.round ===
                  Math.max(...evidence.reviews.map((item) => item.round))
                    ? "Latest review"
                    : `Review round ${round}`
                }
              >
                <div className="comment-author">
                  {author(verdict.reviewerId) && (
                    <Avatar member={author(verdict.reviewerId) as Member} />
                  )}
                  <b>{author(verdict.reviewerId)?.name ?? "Reviewer"}</b>
                  <Stamp>
                    {verdict.verdict === "accept"
                      ? "Accepted"
                      : "Changes requested"}
                  </Stamp>
                </div>
                <Markdown>{verdict.commentsMd}</Markdown>
                {verdict.failedTests.length > 0 && (
                  <p>Failed tests: {verdict.failedTests.join(", ")}</p>
                )}
              </section>
            )}
            {round === evidence.reviewRound && reviewActions}
          </details>
        );
      })}
      {request && latest && (
        <ReviewDialog
          report={latest}
          context={evidence}
          changed={changed || !evidence.reviewContextRevision}
          refreshing={refresh.isPending}
          refreshed={refreshed}
          refresh={() => refresh.mutate()}
          pending={review.isPending}
          error={refresh.error?.message ?? review.error?.message}
          close={() => setRequest(false)}
          onReview={(input) =>
            review.mutate({
              key: evidence.key,
              expectedReportId: latest.id,
              expectedReviewContextRevision:
                evidence.reviewContextRevision ?? "",
              verdict: "changes_requested",
              ...input,
            })
          }
        />
      )}{" "}
      {review.error && !request && <p role="alert">{review.error.message}</p>}
    </section>
  );
}
