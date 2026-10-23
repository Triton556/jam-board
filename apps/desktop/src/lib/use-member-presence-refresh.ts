import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./api";
import type { AppState } from "./types";

export const MEMBER_PRESENCE_INTERVAL = 30000;

/** One application-level reader. Heartbeats are not domain activity events.
 * Direct reads publish only after selection/lifetime checks; a queryFn guard
 * alone would not fence the global members cache against late ABA replies.
 */
export function startMemberPresenceRefresh(client: QueryClient) {
  const selection = () => {
    const app = client.getQueryData<AppState>(["app"]);
    return app?.hasJam ? app.jam?.id : undefined;
  };
  let project = selection();
  let epoch = 0;
  let memberLifecycle = 0;
  let mounted = true;
  let pending = false;
  let retryCurrent = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const visible = () => document.visibilityState !== "hidden";

  const refresh = async () => {
    if (!mounted || !project || !visible()) return;
    if (pending) {
      retryCurrent = true;
      return;
    }
    if (client.isFetching({ queryKey: ["members"] })) return;
    const capturedProject = project;
    const capturedEpoch = epoch;
    const beforeQuery = client
      .getQueryCache()
      .find({ queryKey: ["members"], exact: true });
    const before = beforeQuery?.state;
    const beforeCount = before?.dataUpdateCount;
    const beforeLifecycle = memberLifecycle;
    pending = true;
    try {
      const members = await api.listMembers();
      const currentQuery = client
        .getQueryCache()
        .find({ queryKey: ["members"], exact: true });
      const current = currentQuery?.state;
      if (
        mounted &&
        visible() &&
        epoch === capturedEpoch &&
        project === capturedProject &&
        selection() === capturedProject &&
        !client.isFetching({ queryKey: ["members"] }) &&
        memberLifecycle === beforeLifecycle &&
        currentQuery === beforeQuery &&
        current === before &&
        current?.dataUpdateCount === beforeCount
      )
        client.setQueryData(["members"], members);
    } catch {
      // Preserve last known data. The shared clock expires activity honestly;
      // a failed presence read is not evidence that an actor went offline.
    } finally {
      pending = false;
      const again = retryCurrent;
      retryCurrent = false;
      if (again && mounted && epoch !== capturedEpoch) void refresh();
    }
  };
  const reschedule = () => {
    clearInterval(timer);
    timer = undefined;
    if (mounted && project && visible()) {
      timer = setInterval(() => void refresh(), MEMBER_PRESENCE_INTERVAL);
      void refresh();
    }
  };
  const stopCache = client.getQueryCache().subscribe((event) => {
    // Object identity catches replacement; this generation also catches an
    // absent→created→removed cache lifecycle while a read is pending.
    if (
      (event.type === "added" || event.type === "removed") &&
      event.query.queryKey.length === 1 &&
      event.query.queryKey[0] === "members"
    ) {
      memberLifecycle++;
    }
    const next = selection();
    if (next === project) return;
    project = next;
    epoch++;
    reschedule();
  });
  const visibilityChanged = () => {
    epoch++;
    reschedule();
  };
  document.addEventListener("visibilitychange", visibilityChanged);
  reschedule();
  return () => {
    mounted = false;
    epoch++;
    clearInterval(timer);
    stopCache();
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
}

/** Mount once in Root, not once per member-query observer/card. */
export function useMemberPresenceRefresh() {
  const client = useQueryClient();
  useEffect(() => startMemberPresenceRefresh(client), [client]);
}
