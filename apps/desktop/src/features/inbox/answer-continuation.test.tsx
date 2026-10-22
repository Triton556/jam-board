import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import {
  AnswerContinuation,
  answerContinuationPrompt,
} from "./AnswerContinuation";
import { QuestionList } from "./InboxPage";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
beforeEach(async () => {
  vi.restoreAllMocks();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
});
async function question() {
  return mockApi.askUser({
    scope: { type: "task", id: "JB-7" },
    title: "Choose path",
    bodyMd: "Private body must not be copied",
    options: [{ label: "Keep original", description: "Keep" }],
    recommendedIndex: 0,
    allowFreeText: true,
    roundLabel: null,
  });
}
async function view(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["app"], await mockApi.appState());
  const rendered = render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
  return { client, ...rendered };
}
async function answered() {
  const q = await question();
  return mockApi.answerQuestion({
    id: q.id,
    answerIndex: 0,
    answerText: "Private original answer",
  });
}
it("IDs-only continuation preserves authority and is bounded in size", async () => {
  const q = await answered();
  const prompt = answerContinuationPrompt(q);
  for (const id of [q.id, q.jamId, q.scopeId, q.epicId ?? ""])
    expect(prompt).toContain(id);
  expect(prompt).toContain("Verify the current appointed epic brain");
  expect(prompt).toContain("not Start approval");
  expect(prompt).toContain("previously requested phase");
  expect(prompt).toContain("original human notes or latest human request");
  expect(prompt).toContain(
    "if unclear, ask rather than translating or guessing",
  );
  expect(prompt).not.toContain(q.answerText ?? "Private original answer");
  expect(prompt).not.toContain(q.bodyMd);
  expect(prompt.split(/\s+/).length).toBeLessThan(180);
});
it("persisted Answered card offers copy-only prompt without a save receipt", async () => {
  const q = await answered();
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, "writeText");
  await view(<QuestionList status="answered" />);
  const card = await screen.findByRole("article", {
    name: `Question: ${q.title}`,
  });
  await user.click(
    within(card).getByRole("button", { name: "Continue in brain chat" }),
  );
  const before = mockApi.calls.length;
  await user.click(
    within(card).getByRole("button", { name: "Copy continuation prompt" }),
  );
  expect(write).toHaveBeenCalledWith(answerContinuationPrompt(q));
  expect(mockApi.calls.slice(before)).toEqual([]);
  expect(within(card).getByRole("status")).toHaveTextContent(
    "Nothing was sent",
  );
  expect(
    within(card).getByText(/finished chat is not automatically awakened/),
  ).toBeVisible();
});
it.each(["open", "withdrawn"])(
  "%s question has no saved-answer prompt",
  async (status) => {
    const q = await question();
    await view(<AnswerContinuation question={{ ...q, status }} />);
    expect(
      screen.queryByRole("button", { name: "Continue in brain chat" }),
    ).toBeNull();
  },
);
it("failed answer retains input without saved receipt or continuation", async () => {
  await question();
  const user = userEvent.setup();
  await view(<QuestionList />);
  const card = within(
    await screen.findByRole("article", { name: "Question: Choose path" }),
  );
  await user.type(card.getByRole("textbox"), "Keep this draft");
  mockApi.failNext("answer_question");
  await user.click(card.getByRole("button", { name: "Answer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Simulated failure",
  );
  expect(card.getByRole("textbox")).toHaveValue("Keep this draft");
  expect(screen.queryByText(/Answer saved/)).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Continue in brain chat" }),
  ).toBeNull();
});
it("pending answer waits for confirmation; late project ABA suppresses receipt", async () => {
  await question();
  const user = userEvent.setup();
  const { client } = await view(<QuestionList />);
  const original = mockApi.answerQuestion.bind(mockApi);
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  vi.spyOn(mockApi, "answerQuestion").mockImplementation(async (input) => {
    await gate;
    return original(input);
  });
  const card = within(
    await screen.findByRole("article", { name: "Question: Choose path" }),
  );
  await user.type(card.getByRole("textbox"), "Saved after gate");
  await user.click(card.getByRole("button", { name: "Answer" }));
  expect(screen.queryByText(/Answer saved/)).toBeNull();
  const app = await mockApi.appState();
  act(() => {
    client.setQueryData(["app"], { ...app, jam: { ...app.jam, id: "other" } });
    client.setQueryData(["app"], app);
  });
  await act(async () => release());
  await waitFor(() =>
    expect(
      screen.queryByRole("article", { name: "Question: Choose path" }),
    ).toBeNull(),
  );
  expect(screen.queryByText(/Answer saved/)).toBeNull();
});
it("copy failure preserves text and pending copy is singleflight", async () => {
  const q = await answered();
  const user = userEvent.setup();
  const write = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockRejectedValue(new Error("Denied"));
  await view(<AnswerContinuation question={q} />);
  await user.click(
    screen.getByRole("button", { name: "Continue in brain chat" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Copy continuation prompt" }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("Select and copy");
  expect(screen.getByRole("textbox")).toHaveValue(answerContinuationPrompt(q));
  let finish!: () => void;
  write.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  await user.dblClick(
    screen.getByRole("button", { name: "Copy continuation prompt" }),
  );
  expect(write).toHaveBeenCalledTimes(2);
  await act(async () => finish());
});
it("project ABA invalidates pending copy feedback and closes old preview", async () => {
  const q = await answered();
  const user = userEvent.setup();
  let finish!: () => void;
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  const { client } = await view(<AnswerContinuation question={q} />);
  await user.click(
    screen.getByRole("button", { name: "Continue in brain chat" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Copy continuation prompt" }),
  );
  const app = await mockApi.appState();
  act(() => {
    client.setQueryData(["app"], { ...app, jam: { ...app.jam, id: "other" } });
    client.setQueryData(["app"], app);
  });
  await act(async () => finish());
  expect(screen.queryByRole("textbox")).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Continue in brain chat" }),
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("textbox")).toHaveValue(answerContinuationPrompt(q));
});

it("confirmed answer gives a continuation receipt without authorizing or sending anything", async () => {
  const q = await question();
  const user = userEvent.setup();
  await view(<QuestionList />);
  const card = within(
    await screen.findByRole("article", { name: `Question: ${q.title}` }),
  );
  await user.type(card.getByRole("textbox"), "Keep this exact answer");
  await user.click(card.getByRole("button", { name: "Answer" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("article", { name: `Question: ${q.title}` }),
    ).toBeNull(),
  );
  expect(screen.getByRole("status")).toHaveTextContent("Answer saved");
  await user.click(
    screen.getByRole("button", { name: "Continue in brain chat" }),
  );
  expect(
    screen.getByRole("textbox", { name: "Continuation prompt" }),
  ).toHaveValue(answerContinuationPrompt(q));
  expect(
    mockApi.calls.filter((call) =>
      /execution|claim_task|set_brain|become_brain/.test(call.command),
    ),
  ).toEqual([]);
});

it("a foreign-project question never offers a continuation control", async () => {
  const q = await answered();
  await view(
    <AnswerContinuation question={{ ...q, jamId: "foreign-project" }} />,
  );
  expect(screen.queryByRole("button")).toBeNull();
});

it("unmount during copy cannot announce into a replacement card", async () => {
  const q = await answered();
  const user = userEvent.setup();
  let finish!: () => void;
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  const first = await view(<AnswerContinuation question={q} />);
  await user.click(
    screen.getByRole("button", { name: "Continue in brain chat" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Copy continuation prompt" }),
  );
  first.unmount();
  await view(<AnswerContinuation question={q} />);
  await user.click(
    screen.getByRole("button", { name: "Continue in brain chat" }),
  );
  await act(async () => finish());
  expect(screen.queryByRole("status")).toBeNull();
});
