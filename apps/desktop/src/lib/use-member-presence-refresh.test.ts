import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import type { AppState } from "./types";
import {
  MEMBER_PRESENCE_INTERVAL,
  startMemberPresenceRefresh,
} from "./use-member-presence-refresh";

type Members = Awaited<ReturnType<typeof api.listMembers>>;
const data = (name: string) =>
  [{ id: name, name, lastSeenAt: name }] as Members;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
let client: QueryClient;
let stop: (() => void) | undefined;
let visible: boolean;
const select = (id: string) =>
  client.setQueryData(["app"], { hasJam: true, jam: { id } } as AppState);
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const visibility = (value: boolean) => {
  visible = value;
  document.dispatchEvent(new Event("visibilitychange"));
};
beforeEach(() => {
  vi.useFakeTimers();
  visible = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    visible ? "visible" : "hidden",
  );
  client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  select("A");
  client.setQueryData(["members"], data("cached"));
});
afterEach(() => {
  stop?.();
  stop = undefined;
  client.clear();
  vi.restoreAllMocks();
});

describe("H-B01 / AG10: bounded heartbeat cache renewal", () => {
  it("refreshes heartbeat-only data every 30s without an activity event", async () => {
    const read = vi
      .spyOn(api, "listMembers")
      .mockResolvedValue(data("heartbeat1"));
    stop = startMemberPresenceRefresh(client);
    await flush();
    expect(client.getQueryData(["members"])).toEqual(data("heartbeat1"));
    read.mockResolvedValue(data("heartbeat2"));
    await vi.advanceTimersByTimeAsync(MEMBER_PRESENCE_INTERVAL);
    expect(read).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(["members"])).toEqual(data("heartbeat2"));
  });
  it("pauses hidden and immediately reads on visible return", async () => {
    const read = vi.spyOn(api, "listMembers").mockResolvedValue(data("fresh"));
    stop = startMemberPresenceRefresh(client);
    await flush();
    visibility(false);
    await vi.advanceTimersByTimeAsync(90000);
    expect(read).toHaveBeenCalledTimes(1);
    visibility(true);
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    stop();
    stop = undefined;
    await vi.advanceTimersByTimeAsync(90000);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it.each(["ABA", "unmount", "hidden"])(
    "discards an in-flight response after %s",
    async (change) => {
      const pending = deferred<Members>();
      const read = vi
        .spyOn(api, "listMembers")
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue(data("current"));
      stop = startMemberPresenceRefresh(client);
      if (change === "ABA") {
        select("B");
        select("A");
      }
      if (change === "unmount") {
        stop();
        stop = undefined;
      }
      if (change === "hidden") visibility(false);
      pending.resolve(data("old"));
      await flush();
      await flush();
      expect(client.getQueryData(["members"])).not.toEqual(data("old"));
      if (change === "ABA") {
        expect(read).toHaveBeenCalledTimes(2);
        expect(client.getQueryData(["members"])).toEqual(data("current"));
      } else expect(read).toHaveBeenCalledTimes(1);
    },
  );
  it("does not invalidate a same-project app refresh", async () => {
    const pending = deferred<Members>();
    const read = vi.spyOn(api, "listMembers").mockReturnValue(pending.promise);
    stop = startMemberPresenceRefresh(client);
    select("A");
    pending.resolve(data("accepted"));
    await flush();
    expect(client.getQueryData(["members"])).toEqual(data("accepted"));
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("does not overwrite a newer domain-event member response", async () => {
    const pending = deferred<Members>();
    vi.spyOn(api, "listMembers").mockReturnValue(pending.promise);
    stop = startMemberPresenceRefresh(client);
    client.setQueryData(["members"], data("newer"));
    pending.resolve(data("old"));
    await flush();
    expect(client.getQueryData(["members"])).toEqual(data("newer"));
  });
  it("coalesces periodic reads and preserves data after errors before recovery", async () => {
    const pending = deferred<Members>();
    const read = vi
      .spyOn(api, "listMembers")
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(data("recovered"));
    stop = startMemberPresenceRefresh(client);
    await vi.advanceTimersByTimeAsync(90000);
    expect(read).toHaveBeenCalledTimes(1);
    pending.resolve(data("first"));
    await flush();
    await vi.advanceTimersByTimeAsync(MEMBER_PRESENCE_INTERVAL);
    expect(client.getQueryData(["members"])).toEqual(data("first"));
    await vi.advanceTimersByTimeAsync(MEMBER_PRESENCE_INTERVAL);
    expect(client.getQueryData(["members"])).toEqual(data("recovered"));
  });
  it("does not compete with an already pending member query", async () => {
    const pending = deferred<Members>();
    const query = client.fetchQuery({
      queryKey: ["members"],
      staleTime: 0,
      queryFn: () => pending.promise,
    });
    const read = vi.spyOn(api, "listMembers").mockResolvedValue(data("poll"));
    stop = startMemberPresenceRefresh(client);
    expect(read).not.toHaveBeenCalled();
    pending.resolve(data("domain"));
    await query;
    expect(client.getQueryData(["members"])).toEqual(data("domain"));
  });
  it("does not publish while a newer member query is pending", async () => {
    const poll = deferred<Members>(),
      domain = deferred<Members>();
    vi.spyOn(api, "listMembers").mockReturnValue(poll.promise);
    stop = startMemberPresenceRefresh(client);
    const query = client.fetchQuery({
      queryKey: ["members"],
      staleTime: 0,
      queryFn: () => domain.promise,
    });
    poll.resolve(data("old"));
    await flush();
    expect(client.getQueryData(["members"])).toEqual(data("cached"));
    domain.resolve(data("domain"));
    await query;
    expect(client.getQueryData(["members"])).toEqual(data("domain"));
  });
});
