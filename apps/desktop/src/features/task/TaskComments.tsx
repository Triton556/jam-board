import { useRef, useState } from "react";
import { Markdown } from "../../components/Markdown";
import { Avatar, Button, Kbd, Stamp } from "../../components/ui";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/time";
import type { Member, TaskDetail } from "../../lib/types";
import { useProjectWrite } from "../../lib/use-project-write";
import { usePlanningDraft } from "../plan/planning-draft";

export function TaskComments({
  task,
  members,
  changed,
}: {
  task: TaskDetail;
  members: Member[];
  changed(): void;
}) {
  const draft = usePlanningDraft("", `${task.id}:comment`);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const write = useProjectWrite(`comment:${task.id}`, task.jamId);
  const [notice, setNotice] = useState("");
  const post = () => {
    if (!draft.value.trim() || task.archivedAt) return;
    const bodyMd = draft.value;
    setNotice("");
    write.run(
      () => api.addComment({ key: task.key, bodyMd }),
      () => {
        if (latestDraft.current.value === bodyMd) latestDraft.current.reset();
        changed();
        setNotice("Comment added.");
      },
    );
  };
  return (
    <section className="task-section task-comments" aria-label="Task comments">
      <h2>
        Comments <span className="muted">{task.comments.length}</span>
      </h2>
      <p className="field-hint">
        Add a wish, correction or question for the next refinement. Posting a
        comment does not start an agent.
      </p>
      {!task.comments.length && <p className="muted">No comments yet.</p>}
      {task.comments.map((item) => {
        const author = members.find((m) => m.id === item.authorId);
        return (
          <article className="comment" key={item.id}>
            <div className="comment-author">
              {author && <Avatar member={author} />}
              <strong>{author?.name ?? "Teammate"}</strong>
              {author?.kind === "agent" && <Stamp>agent</Stamp>}
              <time dateTime={item.createdAt}>
                {relativeTime(item.createdAt)}
              </time>
            </div>
            <Markdown>{item.bodyMd}</Markdown>
          </article>
        );
      })}
      {!task.archivedAt && (
        <div className="comment-compose">
          <textarea
            aria-label="Write a comment"
            placeholder="What would you like to add or change?"
            maxLength={4000}
            value={draft.value}
            disabled={!write.ready}
            onChange={(e) => draft.change(e.target.value, write.pending)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                post();
              }
            }}
          />
          <Button disabled={!draft.value.trim() || !write.ready} onClick={post}>
            {write.pending ? "Posting comment…" : "Add comment"}{" "}
            <Kbd>Ctrl ↵</Kbd>
          </Button>
          {write.pending && <p role="status">Posting your comment…</p>}
          {notice && <p role="status">{notice}</p>}
          {write.error && (
            <p role="alert">
              The comment could not be confirmed: {write.error.message}. Your
              draft is kept. Read the latest task before posting again; an error
              does not prove that nothing was added.
            </p>
          )}
          {write.changed && (
            <p role="status">
              This project or task changed. Reopen its comments before posting.
            </p>
          )}
          {write.contextError && (
            <p role="alert">
              The project could not be checked.{" "}
              <Button onClick={write.retryContext}>Check project</Button>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
