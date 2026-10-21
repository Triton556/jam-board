import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { ActivityEvent } from "../lib/types";
import { Journal } from "./plan/Journal";

const service = vi.hoisted(() => ({
  epicJournal: vi.fn(),
  listChangesSince: vi.fn(),
  listMembers: vi.fn(),
  listEpics: vi.fn(),
}));
vi.mock("../lib/api", () => ({ api: service }));
const event = (
  seq: number,
  action: string,
  epicId: string | null,
  sentence: string,
): ActivityEvent => ({
  seq,
  action,
  epicId,
  sentence,
  actor: {
    id: action === "question.answered" ? "human" : "brain",
    name: action === "question.answered" ? "Operator" : "Brain",
    kind: action === "question.answered" ? "human" : "agent",
    handle: "brain",
    color: "#5B8DEF",
  },
  payload:
    action === "question.asked"
      ? { title: sentence.replace(/^Brain asked /, "") }
      : {},
  createdAt: new Date(1760000000000 + seq * 1000).toISOString(),
});
const prelude = [
  event(2, "member.joined", null, "Brain joined"),
  event(3, "agent.status", null, "Brain: interviewing: round 1"),
  event(4, "question.asked", null, "Brain asked the first interview question"),
  event(7, "question.answered", null, "The human answered the interview"),
];
const epic = [
  event(10, "epic.created", "epic-1", "Brain created JB-E1"),
  event(30, "epic.status", "epic-1", "Brain completed JB-E1"),
];
beforeEach(() => {
  service.epicJournal.mockResolvedValue(epic);
  service.listChangesSince.mockResolvedValue([...prelude, ...epic]);
  service.listMembers.mockResolvedValue([]);
  service.listEpics.mockResolvedValue([{ id: "epic-1", key: "JB-E1" }]);
});
function show(key = "JB-E1") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Journal epicKey={key} openTask={vi.fn()} />
    </QueryClientProvider>,
  );
}
it("shows the original interview beside its epic without rewriting project scope", async () => {
  const { container } = show();
  await screen.findByText("Brain completed JB-E1");
  const summary = container
    .querySelector('[data-seq="4"]')
    ?.closest("details")
    ?.querySelector("summary");
  if (!summary) throw new Error("Missing interview session");
  await userEvent.setup().click(summary);
  expect(
    await screen.findByRole("button", {
      name: /Project prelude.*first interview question/,
    }),
  ).toBeVisible();
  expect(container.querySelector('[data-seq="3"]')).toHaveTextContent(
    "Project prelude",
  );
  expect(container.querySelector('[data-seq="10"]')).not.toHaveTextContent(
    "Project prelude",
  );
  expect(container.querySelector('[data-seq="2"]')).toBeNull();
  expect(prelude.every((e) => e.epicId === null)).toBe(true);
});
it("does not repeat an earlier epic's interview as a later epic's prelude", async () => {
  service.epicJournal.mockResolvedValue([
    event(50, "epic.created", "epic-2", "Brain created JB-E2"),
  ]);
  service.listChangesSince.mockResolvedValue([
    ...prelude,
    ...epic,
    event(41, "question.asked", null, "Brain asked the next planning question"),
  ]);
  const { container } = show("JB-E2");
  await screen.findByText("Brain created JB-E2");
  expect(
    await screen.findByRole("button", {
      name: /Project prelude.*next planning question/,
    }),
  ).toBeVisible();
  expect(container.querySelector('[data-seq="4"]')).toBeNull();
});
