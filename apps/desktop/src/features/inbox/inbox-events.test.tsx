import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as eventsApi from "../../lib/inbox-events-api";
import { mockApi } from "../../lib/mock-bridge";
import * as mockEvents from "../../lib/mock-inbox-events";
import { InboxBadge } from "../team/AgentStatus";
import { InboxEvents, inboxDay } from "./InboxEvents";
import { InboxPage } from "./InboxPage";

const route = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => route.navigate,
  useRouterState: () => route.search,
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  vi.stubEnv("VITE_MOCK_BRIDGE", "1");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  mockEvents.resetMockInboxEvents();
  route.search = {};
  route.navigate.mockReset();
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  mockEvents.resetMockInboxEvents();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function mount(
  ui = <InboxEvents />,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}
it("defaults unknown tabs to Questions and writes Events with replace preserving search", async () => {
  route.search = { tab: "unknown", status: "answered" };
  mount(<InboxPage />);
  expect(
    await screen.findByRole("radiogroup", { name: "Inbox tabs" }),
  ).toBeVisible();
  expect(screen.getByRole("radio", { name: /^Questions/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const tab = await screen.findByRole("radio", { name: /^Events \d/ });
  fireEvent.click(tab);
  const navigation = route.navigate.mock.calls[0]?.[0];
  expect(navigation.replace).toBe(true);
  expect(navigation.search({ status: "answered", question: "q" })).toEqual({
    status: "answered",
    question: "q",
    tab: "events",
  });
});
it("reads Events from URL and shows Questions and unread counts", async () => {
  route.search = { tab: "events" };
  const questions = await mockApi.listQuestions();
  const page = await mockEvents.listMockInboxEvents();
  mount(<InboxPage />);
  expect(await screen.findByText("Claude added 40 references")).toBeVisible();
  expect(
    screen.getByRole("radio", { name: `Events ${page.unread}` }),
  ).toHaveAttribute("aria-checked", "true");
  const count = questions.filter((q) => q.status === "open").length;
  expect(
    screen.getByRole("radio", { name: `Questions${count ? ` ${count}` : ""}` }),
  ).toBeVisible();
  expect(screen.queryByRole("radiogroup", { name: "Inbox status" })).toBeNull();
});
it("keeps a human answer draft mounted across tab switches", async () => {
  const view = mount(<InboxPage />);
  const input = (
    await screen.findAllByRole("textbox", {
      name: "Or answer in your own words",
    })
  )[0];
  if (!input) throw new Error("Missing seeded question input");
  fireEvent.change(input, {
    target: { value: "Keep this unsent human answer" },
  });
  route.search = { tab: "events" };
  view.rerender(
    <QueryClientProvider client={view.client}>
      <InboxPage />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Claude added 40 references")).toBeVisible();
  expect(input).not.toBeVisible();
  route.search = { tab: "questions" };
  view.rerender(
    <QueryClientProvider client={view.client}>
      <InboxPage />
    </QueryClientProvider>,
  );
  expect(input).toBeVisible();
  expect(input).toHaveValue("Keep this unsent human answer");
});
it("hides zero tab counts and caps the Events label at 99+", async () => {
  vi.spyOn(mockApi, "listQuestions").mockResolvedValue([]);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(eventsApi.inboxSummaryQuery.queryKey, {
    events: [],
    unread: 99,
    openActions: 0,
    seenSeq: 0,
    nextBeforeSeq: null,
  });
  mount(<InboxPage />, client);
  expect(await screen.findByRole("radio", { name: "Questions" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "Events 99+" })).toBeVisible();
});
it("renders grouped rows, action buttons and Done; navigates tasks, requests and frames", async () => {
  mount();
  const burst = await screen.findByRole("button", {
    name: "Claude added 40 references",
  });
  expect(screen.getAllByText("Claude added 40 references")).toHaveLength(1);
  fireEvent.click(burst);
  expect(route.navigate.mock.lastCall?.[0].to).toBe("/references");
  expect(route.navigate.mock.lastCall?.[0].search({})).toEqual({
    frame: "inbox-sky",
  });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(route.navigate).toHaveBeenLastCalledWith({
    to: "/board",
    search: { task: "JB-1", taskSection: "review" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open request" }));
  expect(route.navigate).toHaveBeenLastCalledWith({
    to: "/plan/$epicKey",
    params: { epicKey: "JB-E1" },
    search: { story: "JB-S1" },
  });
  const done = screen.getByText("Done").closest("article") as HTMLElement;
  expect(within(done).queryByRole("button", { name: "Review" })).toBeNull();
  expect(
    screen.getByRole("article", { name: /Claude added 40 references, unread/ }),
  ).toBeVisible();
});
it("filters Needs action and Updates, keeping counts and project grouping", async () => {
  mount();
  await screen.findByText("Claude added 40 references");
  fireEvent.click(screen.getByRole("radio", { name: "Needs action 2" }));
  await waitFor(() =>
    expect(screen.queryByText("Claude added 40 references")).toBeNull(),
  );
  expect(await screen.findByRole("button", { name: "Review" })).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "Updates" }));
  expect(await screen.findByText("Claude added 40 references")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
});
it("loads older source events and keeps existing rows", async () => {
  mount();
  await screen.findByText("Claude added 40 references");
  fireEvent.click(screen.getByRole("button", { name: "Load older" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Load older" })).toBeNull(),
  );
  expect(screen.getByText("Claude added 40 references")).toBeVisible();
  expect(screen.getAllByText("Codex commented on JB-2").length).toBeGreaterThan(
    1,
  );
});
for (const [filter, text] of [
  ["All", "No events yet"],
  ["Needs action 0", "Nothing needs you right now"],
  ["Updates", "No updates yet"],
] as const) {
  it(`shows ${filter} empty state`, async () => {
    mockEvents.resetMockInboxEvents([]);
    mount();
    await screen.findByText("No events yet");
    fireEvent.click(screen.getByRole("radio", { name: filter }));
    expect(await screen.findByText(text)).toBeVisible();
  });
}
async function timedMount() {
  const page = await mockEvents.listMockInboxEvents();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(eventsApi.inboxEventsQuery("all").queryKey, {
    pages: [page],
    pageParams: [undefined],
  });
  client.setQueryData(eventsApi.inboxSummaryQuery.queryKey, page);
  vi.useFakeTimers();
  const mark = vi
    .spyOn(eventsApi, "markInboxEventsSeen")
    .mockResolvedValue(page.events[0]?.seq ?? 0);
  return { ...mount(<InboxEvents />, client), mark, page };
}
it("marks newest loaded seq only after one visible second and invalidates counts", async () => {
  const { mark, page, client } = await timedMount();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await act(() => vi.advanceTimersByTimeAsync(999));
  expect(mark).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(mark).toHaveBeenCalledWith(page.events[0]?.seq, expect.anything());
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["activity", "inbox-events"],
  });
});
it("unmount before one second marks nothing", async () => {
  const { mark, unmount } = await timedMount();
  await act(() => vi.advanceTimersByTimeAsync(999));
  unmount();
  await act(() => vi.advanceTimersByTimeAsync(1001));
  expect(mark).not.toHaveBeenCalled();
});
it("new event data restarts the visibility interval", async () => {
  const { mark, client, page } = await timedMount();
  await act(() => vi.advanceTimersByTimeAsync(700));
  act(() =>
    client.setQueryData(eventsApi.inboxEventsQuery("all").queryKey, {
      pages: [
        {
          ...page,
          events: page.events.map((event, index) =>
            index === 0 ? { ...event, seq: 200 } : event,
          ),
        },
      ],
      pageParams: [undefined],
    }),
  );
  await act(() => vi.advanceTimersByTimeAsync(700));
  expect(mark).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(mark).toHaveBeenCalledWith(200, expect.anything());
});
it("hidden documents mark nothing and becoming visible starts a fresh second", async () => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  const { mark } = await timedMount();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(mark).not.toHaveBeenCalled();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  fireEvent(document, new Event("visibilitychange"));
  await act(() => vi.advanceTimersByTimeAsync(999));
  expect(mark).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(mark).toHaveBeenCalledTimes(1);
});
it("clears unread dots and summary counts after actual mark-seen", async () => {
  const { client } = mount();
  await screen.findByRole("article", {
    name: /Claude added 40 references, unread/,
  });
  await act(async () => {
    await eventsApi.markInboxEventsSeen(1000);
    await client.invalidateQueries({ queryKey: ["activity", "inbox-events"] });
  });
  expect(
    await screen.findByRole("article", { name: "Claude added 40 references" }),
  ).toBeVisible();
  expect(
    client.getQueryData<eventsApi.InboxEventsPage>(
      eventsApi.inboxSummaryQuery.queryKey,
    )?.unread,
  ).toBe(0);
});
it("adds open actions to badge count and retains 9+", async () => {
  mount(<InboxBadge count={9} />);
  expect(
    await screen.findByRole("img", { name: "11 open inbox items" }),
  ).toHaveTextContent("9+");
});
it("shows dot only for unread with zero actions and zero questions", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  });
  client.setQueryData(eventsApi.inboxSummaryQuery.queryKey, {
    events: [],
    seenSeq: 0,
    nextBeforeSeq: null,
    unread: 3,
    openActions: 0,
  });
  mount(<InboxBadge count={0} />, client);
  expect(
    screen.getByRole("img", { name: "New inbox events" }),
  ).toHaveTextContent("");
});
it("falls back to questions when summary fails and hides a zero badge", async () => {
  vi.spyOn(mockEvents, "listMockInboxEvents").mockRejectedValue(
    new Error("Offline"),
  );
  const { client, unmount } = mount(<InboxBadge count={2} />);
  await waitFor(() =>
    expect(
      client.getQueryState(eventsApi.inboxSummaryQuery.queryKey)?.status,
    ).toBe("error"),
  );
  expect(
    screen.getByRole("img", { name: "2 open inbox items" }),
  ).toHaveTextContent("2");
  unmount();
  mount(<InboxBadge count={0} />, client);
  expect(screen.queryByRole("img")).toBeNull();
});
it("renders loading and error with retry", async () => {
  const list = vi
    .spyOn(mockEvents, "listMockInboxEvents")
    .mockRejectedValue(new Error("Offline events"));
  mount();
  expect(screen.getByRole("status", { name: "Loading events" })).toBeVisible();
  expect(await screen.findByText(/Offline events/)).toBeVisible();
  list.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
  expect(await screen.findByText("Claude added 40 references")).toBeVisible();
});
it("formats local calendar day labels including previous years", () => {
  const now = new Date(2026, 10, 1, 12);
  expect(inboxDay(new Date(2026, 10, 1).toISOString(), now)).toBe("Today");
  expect(inboxDay(new Date(2026, 9, 31).toISOString(), now)).toBe("Yesterday");
  expect(inboxDay(new Date(2026, 9, 30).toISOString(), now)).toBe("30 Oct");
  expect(inboxDay(new Date(2025, 9, 31).toISOString(), now)).toBe(
    "31 Oct 2025",
  );
});
