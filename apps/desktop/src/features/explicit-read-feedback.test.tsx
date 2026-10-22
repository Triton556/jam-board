import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppState, Question } from "../bindings";
import { ReadReceipt } from "../components/ui/ReadReceipt";
import { api } from "../lib/api";
import { mockApi } from "../lib/mock-bridge";
import { useExplicitRead } from "../lib/use-explicit-read";
import { QuestionList } from "./inbox/InboxPage";
import { Journal } from "./plan/Journal";
import { TaskTable } from "./table/TaskTable";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => "/inbox",
  useBlocker: () => ({}),
}));
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.setLatency(0);
});
afterEach(() => vi.restoreAllMocks());
async function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  const wrap = (child: React.ReactNode) => (
    <QueryClientProvider client={client}>{child}</QueryClientProvider>
  );
  return { ...render(wrap(node)), client, wrap };
}
it.each(["questions", "journal"] as const)(
  "AS02 explicit %s read singleflight and unchanged success, no focus move",
  async (kind) => {
    const read = vi.spyOn(
      api,
      kind === "questions" ? "listQuestions" : "listChangesSince",
    );
    read.mockResolvedValue([] as never);
    const { client } = await mount(
      kind === "questions" ? <QuestionList /> : <Journal openTask={() => {}} />,
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const button = screen.getByRole("button", { name: "Refresh" });
    const d = deferred<never[]>();
    read.mockImplementation(() => d.promise as never);
    read.mockClear();
    const u = userEvent.setup();
    await u.dblClick(button);
    expect(read).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(`Checking ${kind}`);
    await act(async () => d.resolve([]));
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByRole("status")).toHaveTextContent(`Checked ${kind}.`);
    expect(button).toHaveFocus();
  },
);
it("AS02 I01 cached error and manual recovery preserve answer subtree, typing and focus", async () => {
  const { client } = await mount(<QuestionList />);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const questions = client.getQueryData<Question[]>(["questions"]);
  const input = screen.getAllByRole("textbox", {
    name: "Or answer in your own words",
  })[0];
  if (!input) throw new Error("Missing answer input");
  await userEvent.setup().type(input, "Fictional retained answer");
  vi.spyOn(api, "listQuestions").mockRejectedValueOnce(
    new Error("Fictional read failure"),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["questions"] });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Showing the last loaded questions",
  );
  expect(input).toBeInTheDocument();
  expect(input).toHaveFocus();
  expect(input).toHaveValue("Fictional retained answer");
  expect(client.getQueryData(["questions"])).toEqual(questions);
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(input).toHaveValue("Fictional retained answer");
  expect(screen.getByRole("status")).toHaveTextContent("Checked questions.");
});
it("AS02 I01 fulfilled refetch error is failure, never Checked; retry remains safe", async () => {
  vi.spyOn(api, "listQuestions").mockResolvedValue([]);
  await mount(<QuestionList />);
  const button = await screen.findByRole("button", { name: "Refresh" });
  vi.mocked(api.listQuestions).mockRejectedValueOnce(
    new Error("Fictional failure"),
  );
  await userEvent.setup().click(button);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Could not check questions",
    ),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("last loaded");
  expect(button).toBeEnabled();
  expect(screen.queryByText("Checked questions.")).toBeNull();
});
it("AS02 I01 initial error is distinct from empty; retry checks without a write", async () => {
  vi.spyOn(api, "listQuestions").mockRejectedValueOnce(
    new Error("First read failed"),
  );
  const { client } = await mount(<QuestionList />);
  await screen.findByRole("alert");
  expect(screen.queryByText("No questions right now")).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.getByRole("status")).toHaveTextContent("Checked questions.");
});
it("AS02 T01 cached task rows remain visible after failure and read-only retry", async () => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(623);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  const { client } = await mount(
    <TaskTable search={{}} change={() => {}} open={() => {}} />,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const data = client.getQueriesData<{ tasks: { title: string }[] }>({
    queryKey: ["tableTasks"],
  })[0]?.[1];
  const title = data?.tasks[0]?.title;
  if (!title) throw new Error("Missing fixture task");
  expect(screen.getByText(title)).toBeInTheDocument();
  vi.spyOn(api, "listTasks").mockRejectedValueOnce(
    new Error("Fictional failure"),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["tableTasks"] });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "last loaded task list",
  );
  expect(screen.getByText(title)).toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Retry task list" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByText(title)).toBeInTheDocument();
  expect(screen.getByText(/Checked task list\./)).toBeInTheDocument();
});
function Probe({
  scope,
  read,
}: {
  scope: string;
  read: () => Promise<{ isError: boolean; error: Error | null }>;
}) {
  const state = useExplicitRead(scope);
  return (
    <>
      <button type="button" onClick={() => void state.run(read)}>
        Check
      </button>
      <ReadReceipt
        checkedAt={state.checkedAt}
        phase={state.phase}
        resource="fixture"
      />
    </>
  );
}
it.each(["scope", "project"] as const)(
  "AS03 explicit receipt fences %s ABA and lets new intent finish",
  async (kind) => {
    const old = deferred<{ isError: boolean; error: Error | null }>();
    const newer = deferred<{ isError: boolean; error: Error | null }>();
    const read = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(newer.promise);
    const { client, rerender, wrap } = await mount(
      <Probe scope="a" read={read} />,
    );
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Check" }));
    if (kind === "scope") {
      rerender(wrap(<Probe scope="b" read={read} />));
      rerender(wrap(<Probe scope="a" read={read} />));
    } else {
      const app = client.getQueryData<AppState>(["app"]);
      if (!app?.jam) throw new Error("Missing fixture project");
      act(() => {
        client.setQueryData(["app"], {
          ...app,
          jam: { ...app.jam, id: "other" },
        });
        client.setQueryData(["app"], app);
      });
    }
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await u.click(screen.getByRole("button", { name: "Check" }));
    await act(async () => old.resolve({ isError: false, error: null }));
    expect(screen.getByRole("status")).toHaveTextContent("Checking fixture");
    await act(async () => newer.resolve({ isError: false, error: null }));
    expect(screen.getByRole("status")).toHaveTextContent("Checked fixture.");
  },
);
it("AS03 unmounted receipt cannot announce into remounted surface", async () => {
  const d = deferred<{ isError: boolean; error: Error | null }>();
  const { rerender, wrap } = await mount(
    <Probe scope="a" read={() => d.promise} />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Check" }));
  rerender(wrap(<span>Closed</span>));
  rerender(wrap(<Probe scope="a" read={() => d.promise} />));
  await act(async () => d.resolve({ isError: false, error: null }));
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
});
