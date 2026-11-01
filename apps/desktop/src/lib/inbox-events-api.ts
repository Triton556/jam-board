import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { InboxEventFilter, InboxEventsPage } from "../bindings";
import { api } from "./api";

export type {
  InboxEvent,
  InboxEventFilter,
  InboxEventGroup,
  InboxEventsPage,
} from "../bindings";

export type InboxEventsQuery = Partial<import("../bindings").InboxEventsQuery>;
export async function listInboxEvents(
  query: InboxEventsQuery,
): Promise<InboxEventsPage> {
  return api.listInboxEvents(query);
}
export async function markInboxEventsSeen(seq: number): Promise<number> {
  return api.markInboxEventsSeen(seq);
}
export const inboxEventsQuery = (filter: InboxEventFilter) =>
  infiniteQueryOptions({
    queryKey: ["activity", "inbox-events", filter],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      listInboxEvents({ filter, beforeSeq: pageParam }),
    getNextPageParam: (page) => page.nextBeforeSeq ?? undefined,
  });
export const inboxSummaryQuery = queryOptions({
  queryKey: ["activity", "inbox-events", "summary"],
  queryFn: () => listInboxEvents({ limit: 1 }),
});
