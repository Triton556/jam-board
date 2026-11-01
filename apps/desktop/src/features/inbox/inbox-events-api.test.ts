import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  inboxEventsQuery,
  inboxSummaryQuery,
  listInboxEvents,
  markInboxEventsSeen,
} from "../../lib/inbox-events-api";

import { mockApi } from "../../lib/mock-bridge";
import { tauriApi } from "../../lib/tauri-bridge";

beforeEach(() => {
  vi.spyOn(mockApi, "listInboxEvents").mockImplementation(
    tauriApi.listInboxEvents,
  );
  vi.spyOn(mockApi, "markInboxEventsSeen").mockImplementation(
    tauriApi.markInboxEventsSeen,
  );
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(invoke).mockReset();
});
it("uses the exact desktop command names and camelCase arguments", async () => {
  vi.stubEnv("VITE_MOCK_BRIDGE", "0");
  const page = {
    events: [],
    unread: 2,
    openActions: 1,
    seenSeq: 0,
    nextBeforeSeq: null,
  };
  vi.mocked(invoke).mockResolvedValueOnce(page).mockResolvedValueOnce(42);
  expect(
    await listInboxEvents({ filter: "needs_action", beforeSeq: 42, limit: 5 }),
  ).toEqual(page);
  expect(invoke).toHaveBeenNthCalledWith(1, "list_inbox_events", {
    input: { filter: "needs_action", beforeSeq: 42, limit: 5 },
  });
  expect(await markInboxEventsSeen(42)).toBe(42);
  expect(invoke).toHaveBeenNthCalledWith(2, "mark_inbox_events_seen", {
    seq: 42,
  });
});
it("keys event pages and summary under activity for the existing live invalidation", () => {
  expect(inboxEventsQuery("updates").queryKey).toEqual([
    "activity",
    "inbox-events",
    "updates",
  ]);
  expect(inboxSummaryQuery.queryKey).toEqual([
    "activity",
    "inbox-events",
    "summary",
  ]);
});
