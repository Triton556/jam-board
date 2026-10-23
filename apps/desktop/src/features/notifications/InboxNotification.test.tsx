// NT01 exact-question Inbox landing. DOM/mock evidence only.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Question } from "../../bindings";
import { mockApi } from "../../lib/mock-bridge";
import { InboxPage } from "../inbox/InboxPage";

const route = vi.hoisted(() => ({
  search: {} as { question?: string; status?: string },
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
  useRouterState: () => route.search,
}));
let questions: Question[];
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.setLatency(0);
  route.search = {};
  questions = [];
  vi.spyOn(mockApi, "listQuestions").mockImplementation(async () => questions);
  vi.spyOn(mockApi, "listExecutionRequests").mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());
function question(id: string, status: string): Question {
  return {
    id,
    jamId: "project",
    epicId: null,
    scopeType: "project",
    scopeId: "project",
    askedBy: "agent",
    roundLabel: null,
    title: `Exact question ${id}`,
    bodyMd: "Question context",
    options: [],
    recommendedIndex: null,
    allowFreeText: true,
    status,
    answerIndex: null,
    answerText: status === "answered" ? "Saved human answer" : null,
    answeredBy: null,
    answeredAt: null,
    createdAt: "2026-10-22T08:00:00Z",
  };
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <InboxPage />
      </QueryClientProvider>,
    ),
  };
}
for (const status of ["answered", "withdrawn"]) {
  it(`NT01 View lands on exact ${status} question and refetch does not steal focus`, async () => {
    questions = [
      question("other", status),
      question("wanted", status),
      question("open", "open"),
    ];
    // The latest record is authoritative even if the URL's status has gone stale.
    route.search = { question: "wanted", status: "open" };
    const { client } = mount();
    const card = await screen.findByRole("article", {
      name: "Question: Exact question wanted",
    });
    await waitFor(() => expect(card).toHaveFocus());
    expect(card).toHaveAttribute("data-question-id", "wanted");
    expect(
      screen.getByRole("radio", {
        name: status === "answered" ? "Answered" : "Withdrawn",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.queryByRole("article", { name: "Question: Exact question open" }),
    ).toBeNull();
    const other = screen.getByRole("article", {
      name: "Question: Exact question other",
    });
    other.focus();
    questions = questions.map((q) => ({
      ...q,
      bodyMd: `${q.bodyMd} refreshed`,
    }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["questions"] });
    });
    expect(other).toHaveFocus();
    expect(card).not.toHaveFocus();
  });
}
it("NT01 a later distinct deep link focuses its exact question, not the first card", async () => {
  questions = [question("first", "answered"), question("second", "withdrawn")];
  route.search = { question: "first", status: "answered" };
  const { client, rerender } = mount();
  await waitFor(() =>
    expect(
      screen.getByRole("article", { name: "Question: Exact question first" }),
    ).toHaveFocus(),
  );
  route.search = { question: "second", status: "withdrawn" };
  rerender(
    <QueryClientProvider client={client}>
      <InboxPage />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("article", { name: "Question: Exact question second" }),
    ).toHaveFocus(),
  );
  expect(
    screen.queryByRole("article", { name: "Question: Exact question first" }),
  ).toBeNull();
});

it("NT01 missing deep link explains unavailability and refresh preserves manual filter choice", async () => {
  route.search = { question: "missing", status: "answered" };
  questions = [question("other", "open")];
  const { client } = mount();
  await screen.findByText(/This question is no longer available/);
  fireEvent.click(screen.getByRole("radio", { name: "Open" }));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["questions"] });
  });
  expect(screen.getByRole("radio", { name: "Open" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
it("NT01 successful deep link does not reset a later human filter on query refresh", async () => {
  route.search = { question: "wanted", status: "answered" };
  questions = [question("wanted", "answered"), question("other", "open")];
  const { client } = mount();
  await screen.findByRole("article", {
    name: "Question: Exact question wanted",
  });
  fireEvent.click(screen.getByRole("radio", { name: "Open" }));
  questions = questions.map((q) => ({ ...q, bodyMd: "refreshed" }));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["questions"] });
  });
  expect(screen.getByRole("radio", { name: "Open" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
