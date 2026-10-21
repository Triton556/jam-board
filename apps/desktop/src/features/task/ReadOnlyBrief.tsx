import { Markdown } from "../../components/Markdown";
import type { Member, TaskDetail } from "../../lib/types";

function keyed<T>(rows: T[]) {
  const counts = new Map<string, number>();
  return rows.map((value) => {
    const text = JSON.stringify(value);
    const n = counts.get(text) ?? 0;
    counts.set(text, n + 1);
    return { value, key: `${text}:${n}` };
  });
}

export function ReadOnlyBrief({
  task,
  members,
}: {
  task: TaskDetail;
  members: Member[];
}) {
  const b = task.brief;
  const report = task.reports.at(-1),
    review = task.reviews.at(-1);
  const author = (id: string) =>
    members.find((m) => m.id === id)?.name ?? "Team member";
  return (
    <>
      <section
        className="task-section readonly-brief"
        aria-label="Read-only task brief"
        data-testid="task-brief"
      >
        <h2>Task brief</h2>
        <p className="muted">
          {task.epic.key} · {task.epic.title} / {task.story.key} ·{" "}
          {task.story.title}
        </p>
        {(
          [
            ["Goal", b.goalMd],
            ["Context", b.contextMd],
            ["Where", b.whereMd],
          ] as const
        ).map(([name, text]) => (
          <div key={name}>
            <h3>{name}</h3>
            {text ? (
              <Markdown>{text}</Markdown>
            ) : (
              <p className="muted">Not defined yet</p>
            )}
          </div>
        ))}
        <h3>Changes</h3>
        {(b.changes ?? []).length ? (
          keyed(b.changes ?? []).map(({ value: change, key }, index) => (
            <div className="brief-change" key={key}>
              <h4>
                {index + 1}. {change.title}
              </h4>
              {(
                [
                  ["Now", change.now],
                  ["Cause", change.cause],
                  ["Required", change.required],
                  ["Where", change.where],
                  ["Follow", change.follow],
                  ["Keep", change.keep],
                ] as const
              )
                .filter(([, text]) => text)
                .map(([name, text]) => (
                  <div key={name}>
                    <strong>{name}</strong>
                    <Markdown>{text ?? ""}</Markdown>
                  </div>
                ))}
            </div>
          ))
        ) : (
          <p className="muted">No changes defined</p>
        )}
        <h3>Tests</h3>
        {(b.tests ?? []).length ? (
          keyed(b.tests ?? []).map(({ value: test, key }, index) => (
            <div className="brief-test" key={key}>
              <strong>{index + 1}. Setup</strong>
              <Markdown>{test.setup}</Markdown>
              <strong>Expected</strong>
              <Markdown>{test.expected}</Markdown>
            </div>
          ))
        ) : (
          <p className="muted">No tests defined</p>
        )}
        {(
          [
            ["Boundaries", b.boundariesMd],
            ["Result", b.resultMd],
            ["User quotes", b.userQuotesMd],
          ] as const
        ).map(([name, text]) => (
          <div key={name}>
            <h3>{name}</h3>
            {text ? (
              <Markdown>{text}</Markdown>
            ) : (
              <p className="muted">Not defined yet</p>
            )}
          </div>
        ))}
        <details>
          <summary>Story acceptance and epic scope</summary>
          <h3>Outcome</h3>
          <Markdown>{task.story.outcomeMd}</Markdown>
          <h3>Acceptance</h3>
          {task.story.acceptance.map((a) => (
            <p key={a.id}>
              <strong>
                {a.id} · {a.mandatory ? "Required" : "Optional"}
              </strong>{" "}
              — {a.criterion}
              <br />
              {a.check}
            </p>
          ))}
          <h3>Epic goal</h3>
          <Markdown>{task.epic.goalMd}</Markdown>
          <h3>Done when</h3>
          <Markdown>{task.epic.doneWhenMd}</Markdown>
          <h3>Not included</h3>
          <Markdown>{task.epic.notIncludedMd}</Markdown>
          <p className="muted">
            Worker model: {task.epic.workerModel ?? "Not chosen"}
          </p>
        </details>
      </section>
      {report && (
        <section
          className="task-section readonly-report"
          aria-label="Latest report"
        >
          <h2>Latest report · round {report.round}</h2>
          <p className="muted">{author(report.authorId)}</p>
          <Markdown>{report.summaryMd}</Markdown>
          <h3>Changed files</h3>
          <ul>
            {report.changedFiles.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
          <h3>Tests</h3>
          {report.tests.map((test) => (
            <div className="brief-test" key={test.name}>
              <strong>
                {test.name} · {test.result}
              </strong>
              <code>{test.command}</code>
              <p>Expected: {test.expected}</p>
              <p>Actual: {test.actual}</p>
            </div>
          ))}
          <h3>Deviations</h3>
          <Markdown>{report.deviationsMd || "None reported"}</Markdown>
          <h3>Not verified</h3>
          <Markdown>{report.notVerifiedMd || "None reported"}</Markdown>
        </section>
      )}
      {review && (
        <section
          className="task-section readonly-review"
          aria-label="Latest review"
        >
          <h2>Latest review · round {review.round}</h2>
          <p>
            <strong>
              {review.verdict === "accept" ? "Accepted" : "Changes requested"}
            </strong>{" "}
            · {author(review.reviewerId)}
          </p>
          <Markdown>{review.commentsMd}</Markdown>
          {review.failedTests.length > 0 && (
            <p>Failed tests: {review.failedTests.join(", ")}</p>
          )}
        </section>
      )}
    </>
  );
}
