import { Markdown } from "../../components/Markdown";
import type { TaskDetail } from "../../lib/types";

/** The context attached to the visible report, not live values behind a decision. */
export function ReviewContext({
  task,
  expanded = false,
}: {
  task: TaskDetail;
  expanded?: boolean;
}) {
  const text = (label: string, value?: string | null) =>
    value?.trim() ? (
      <div key={label}>
        <h4>{label}</h4>
        <Markdown>{value}</Markdown>
      </div>
    ) : null;
  return (
    <details className="review-context" open={expanded}>
      <summary>Task, story and epic criteria · captured snapshot</summary>
      <p className="small muted">
        Review uses this saved context. Background edits cannot silently change
        which report or criteria you accept.
      </p>
      <details>
        <summary>
          {task.key} · {task.title}
        </summary>
        {text("Task notes", task.descriptionMd)}
        {text("Goal", task.brief.goalMd)}
        {text("Context", task.brief.contextMd)}
        {text("Where", task.brief.whereMd)}
        {task.brief.changes?.map((change, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: immutable captured brief entries have no IDs; content is included in the key.
          <div key={`${index}:${JSON.stringify(change)}`}>
            <h4>{change.title}</h4>
            {text("Required", change.required)}
            {text("Current behavior", change.now)}
            {text("Cause", change.cause)}
            {text("Location", change.where)}
            {text("Follow", change.follow)}
            {text("Keep", change.keep)}
          </div>
        ))}
        {!!task.brief.tests?.length && (
          <>
            <h4>Task acceptance tests</h4>
            <ul>
              {task.brief.tests.map((test, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: immutable captured tests have no IDs; content is included in the key.
                <li key={`${index}:${JSON.stringify(test)}`}>
                  <strong>{test.setup}</strong>
                  <p>{test.expected}</p>
                </li>
              ))}
            </ul>
          </>
        )}
        {text("Boundaries", task.brief.boundariesMd)}
        {text("Expected result", task.brief.resultMd)}
        {text("Original notes", task.brief.userQuotesMd)}
      </details>
      <details>
        <summary>
          {task.story.key} · {task.story.title}
        </summary>
        {text("Outcome", task.story.outcomeMd)}
        {text("Basis", task.story.basisMd)}
        {text("Preserve", task.story.preserveMd)}
        {text("Scale", task.story.scaleMd)}
        {text("Rejection risks", task.story.rejectionRisksMd)}
        {text("Open decisions", task.story.openDecisionsMd)}
        <h4>Story acceptance</h4>
        {task.story.acceptance.length ? (
          <ul>
            {task.story.acceptance.map((item) => (
              <li key={item.id}>
                <strong>{item.criterion}</strong>
                {item.mandatory ? " · Required" : " · Optional"}
                <p>{item.check}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No story acceptance criteria recorded.</p>
        )}
      </details>
      <details>
        <summary>
          {task.epic.key} · {task.epic.title}
        </summary>
        {text("Goal and audience", task.epic.goalMd)}
        {text("Done when", task.epic.doneWhenMd)}
        {text("Not included", task.epic.notIncludedMd)}
        {text("Decided", task.epic.decidedMd)}
        {text("Open questions", task.epic.openQuestionsMd)}
      </details>
    </details>
  );
}
