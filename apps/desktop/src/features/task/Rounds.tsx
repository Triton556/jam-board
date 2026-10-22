import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Report, ReviewTask } from "../../bindings";
import { Markdown } from "../../components/Markdown";
import { Avatar, Button, Dialog, Stamp } from "../../components/ui";
import { api } from "../../lib/api";
import { invalidatePlanning } from "../../lib/planning-queries";
import { relativeTime } from "../../lib/time";
import type { Member, TaskDetail } from "../../lib/types";
export function ReviewDialog({
  report,
  close,
  onReview,
  pending = false,
  error,
}: {
  report: Report;
  pending?: boolean;
  error?: string;
  close(): void;
  onReview(input: Pick<ReviewTask, "commentsMd" | "failedTests">): void;
}) {
  const [comments, setComments] = useState(""),
    [failed, setFailed] = useState<string[]>([]);
  return (
    <Dialog
      title="Request changes"
      onClose={() => {
        if (!pending) close();
      }}
    >
      <label className="field">
        Comments
        <textarea
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
          disabled={pending || !comments.trim()}
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
}: {
  task: TaskDetail;
  members: Member[];
}) {
  const [request, setRequest] = useState(false);
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (notice) heading.current?.focus();
  }, [notice]);
  const client = useQueryClient();
  const review = useMutation({
    mutationFn: (input: ReviewTask) => api.reviewTask(input),
    onSuccess: (_task, input) => {
      setRequest(false);
      setNotice(
        input.verdict === "accept"
          ? "Result accepted. The task is Done."
          : "Changes requested. The task is Ready for another round; new work still needs scope permission.",
      );
      invalidatePlanning(client);
    },
  });
  const latest = task.reports.find((r) => r.round === (task.reviewRound ?? 0));
  const author = (id: string) => members.find((m) => m.id === id);
  const rounds = [
    ...new Set([
      ...task.reports.map((r) => r.round),
      ...task.reviews.map((r) => r.round),
    ]),
  ].sort((a, b) => b - a);
  const reviewActions = task.status === "review" && latest && (
    <div className="button-row">
      <Button
        variant="primary"
        disabled={review.isPending}
        onClick={() =>
          review.mutate({
            key: task.key,
            verdict: "accept",
            commentsMd: "Accepted after checking the report and acceptance.",
            failedTests: [],
          })
        }
      >
        Accept result
      </Button>
      <Button
        disabled={review.isPending}
        onClick={() => {
          review.reset();
          setNotice("");
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
      {!rounds.length && (
        <p className="muted">
          The worker's report and your review will appear here.
        </p>
      )}
      {rounds.map((round) => {
        const report = task.reports.find((r) => r.round === round),
          verdict = task.reviews.find((r) => r.round === round);
        return (
          <details className="round" key={round} open={round === rounds[0]}>
            <summary>
              Round {round}
              {round === rounds[0] ? " · Latest" : " · Earlier evidence"}
            </summary>
            {report && (
              <section
                className="report-card"
                aria-label={
                  report.round ===
                  Math.max(...task.reports.map((item) => item.round))
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
                <Markdown>{report.summaryMd}</Markdown>
                <details>
                  <summary>
                    Changed files · {report.changedFiles.length}
                  </summary>
                  <ul>
                    {report.changedFiles.map((f) => (
                      <li key={f}>
                        <code>{f}</code>
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="report-tests">
                  <table>
                    <thead>
                      <tr>
                        <th>Test</th>
                        <th>Expected</th>
                        <th>Actual</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.tests.map((t) => (
                        <tr key={t.name}>
                          <td title={t.command}>{t.name}</td>
                          <td>{t.expected}</td>
                          <td>{t.actual}</td>
                          <td>
                            <Stamp className={`test-${t.result.toLowerCase()}`}>
                              {t.result}
                            </Stamp>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {report.deviationsMd && (
                  <>
                    <h4>Deviations</h4>
                    <Markdown>{report.deviationsMd}</Markdown>
                  </>
                )}
                {report.notVerifiedMd && (
                  <>
                    <h4>Not verified</h4>
                    <Markdown>{report.notVerifiedMd}</Markdown>
                  </>
                )}
              </section>
            )}
            {verdict && (
              <section
                className={`review-card ${verdict.verdict}`}
                aria-label={
                  verdict.round ===
                  Math.max(...task.reviews.map((item) => item.round))
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
            {round === task.reviewRound && reviewActions}
          </details>
        );
      })}
      {request && latest && (
        <ReviewDialog
          report={latest}
          pending={review.isPending}
          error={review.error?.message}
          close={() => setRequest(false)}
          onReview={(input) =>
            review.mutate({
              key: task.key,
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
