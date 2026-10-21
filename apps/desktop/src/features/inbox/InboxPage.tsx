import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import type { Question } from "../../bindings";
import { Markdown } from "../../components/Markdown";
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  SegmentedControl,
  Stamp,
} from "../../components/ui";
import { PaperSkeleton, QueryError } from "../../components/ui/AsyncState";
import { PageHeading } from "../../components/ui/m5";
import { api } from "../../lib/api";
import {
  epicsQuery,
  invalidatePlanning,
  questionsQuery,
  storiesQuery,
} from "../../lib/planning-queries";
import { membersQuery, tasksQuery } from "../../lib/queries";
export function QuestionCard({ question: q }: { question: Question }) {
  const members = useQuery(membersQuery),
    epics = useQuery(epicsQuery),
    stories = useQuery(storiesQuery),
    tasks = useQuery(tasksQuery);
  const navigate = useNavigate();
  const [selected, setSelected] = useState<number | null>(null),
    [text, setText] = useState(""),
    [menu, setMenu] = useState(false);
  const client = useQueryClient();
  const actor = members.data?.find((m) => m.id === q.askedBy);
  const answer = useMutation({
    mutationFn: () =>
      api.answerQuestion({
        id: q.id,
        answerIndex: selected,
        answerText: text.trim() || null,
      }),
    onSuccess: () => invalidatePlanning(client),
  });
  const withdraw = useMutation({
    mutationFn: () => api.withdrawQuestion(q.id),
    onSuccess: () => invalidatePlanning(client),
  });
  const epic = epics.data?.find((e) => e.id === q.epicId),
    task = Object.values(tasks.data ?? {})
      .flat()
      .find((t) => t.id === q.scopeId);
  const story = stories.data?.find((s) => s.id === q.scopeId);
  const scopeLabel =
    q.scopeType === "project"
      ? "Project"
      : q.scopeType === "epic"
        ? epic?.key
        : q.scopeType === "task"
          ? task?.key
          : story?.key;
  const gotoScope = () => {
    if (task) void navigate({ to: "/board", search: { task: task.key } });
    else if (epic)
      void navigate({
        to: "/plan/$epicKey",
        params: { epicKey: epic.key },
        search: {
          story: q.scopeType === "story" ? story?.key : undefined,
        },
      });
  };
  const pending = q.status === "open";
  return (
    <article
      className={`question-card ${pending ? "" : "answered"}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: A focuses the recommended answer on this explicitly focusable card.
      tabIndex={0}
      aria-label={`Question: ${q.title}`}
      data-question-id={q.id}
      onKeyDown={(e) => {
        if (
          e.key.toLowerCase() === "a" &&
          e.target === e.currentTarget &&
          pending &&
          q.recommendedIndex !== null
        ) {
          e.preventDefault();
          setSelected(q.recommendedIndex);
        }
      }}
    >
      <div className="question-heading">
        {actor && <Avatar member={actor} size={32} />}
        <b>{actor?.name ?? "Teammate"}</b>
        <Button variant="ghost" onClick={gotoScope}>
          {epic?.key && q.scopeType !== "epic" ? `${epic.key} / ` : ""}
          {scopeLabel ?? q.scopeType}
        </Button>
        <div className="grow" />
        <IconButton
          label={`Question menu: ${q.title}`}
          onClick={() => setMenu(!menu)}
        >
          <MoreHorizontal size={18} />
        </IconButton>
        {menu && pending && (
          <Button onClick={() => withdraw.mutate()}>Withdraw</Button>
        )}
      </div>
      <h3>{q.title}</h3>
      <Markdown>{q.bodyMd}</Markdown>
      {pending ? (
        <>
          <div className="question-options">
            {q.options.map((option, index) => (
              <button
                type="button"
                key={option.label}
                aria-pressed={selected === index}
                className={`question-option ${q.recommendedIndex === index ? "recommended" : ""}`}
                onClick={() => setSelected(index)}
              >
                <span>
                  <b>{option.label}</b>
                  {q.recommendedIndex === index && (
                    <Stamp className="recommendation">Recommended</Stamp>
                  )}
                </span>
                <small>{option.description}</small>
              </button>
            ))}
          </div>
          {q.allowFreeText && (
            <label className="field">
              Or answer in your own words
              <textarea
                aria-label="Or answer in your own words"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
          )}
          <Button
            variant="primary"
            disabled={(selected === null && !text.trim()) || answer.isPending}
            onClick={() => answer.mutate()}
          >
            Answer
          </Button>
        </>
      ) : (
        <div className="question-answer">
          <Stamp>{q.status}</Stamp>
          {q.answerIndex !== null && (
            <strong>{q.options[q.answerIndex]?.label}</strong>
          )}
          {q.answerText && <Markdown>{q.answerText}</Markdown>}
        </div>
      )}
      {(answer.error || withdraw.error) && (
        <p role="alert">{(answer.error ?? withdraw.error)?.message}</p>
      )}
    </article>
  );
}
export function QuestionList({
  epicId,
  status = "open",
}: {
  epicId?: string;
  status?: string;
}) {
  const questions = useQuery(questionsQuery),
    epics = useQuery(epicsQuery);
  const filtered =
    questions.data?.filter(
      (q) => q.status === status && (!epicId || q.epicId === epicId),
    ) ?? [];
  if (questions.isPending) return <PaperSkeleton label="Loading questions" />;
  if (questions.error)
    return (
      <QueryError
        error={questions.error}
        retry={() => void questions.refetch()}
      />
    );
  if (!filtered.length)
    return (
      <EmptyState text="No questions right now">
        <Button onClick={() => void questions.refetch()}>Refresh</Button>
      </EmptyState>
    );
  const groups = [...new Set(filtered.map((q) => q.epicId ?? "project"))];
  return (
    <div className="question-groups">
      {groups.map((id) => {
        const epic = epics.data?.find((e) => e.id === id);
        const rows = filtered.filter((q) => (q.epicId ?? "project") === id);
        return (
          <section key={id}>
            <h2
              className="question-group-title"
              style={{
                borderColor: epic ? `var(--${epic.color})` : "var(--line-soft)",
              }}
            >
              {epic ? `${epic.key} · ${epic.title}` : "Project questions"}
            </h2>
            {[...new Set(rows.map((q) => q.roundLabel ?? "Questions"))].map(
              (round) => (
                <section key={round}>
                  <h3 className="muted small">{round}</h3>
                  {rows
                    .filter((q) => (q.roundLabel ?? "Questions") === round)
                    .map((q) => (
                      <QuestionCard key={q.id} question={q} />
                    ))}
                </section>
              ),
            )}
          </section>
        );
      })}
    </div>
  );
}
export function InboxPage() {
  const [status, setStatus] = useState("open");
  return (
    <main className="feature-page inbox-page">
      <PageHeading title="Inbox" note="a good question is a useful next step">
        <SegmentedControl
          label="Inbox status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "open", label: "Open" },
            { value: "answered", label: "Answered" },
            { value: "withdrawn", label: "Withdrawn" },
          ]}
        />
      </PageHeading>
      <div className="inbox-scroll">
        <QuestionList status={status} />
      </div>
    </main>
  );
}
