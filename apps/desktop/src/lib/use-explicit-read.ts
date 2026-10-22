import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { AppState } from "./types";

type Outcome = { isError: boolean; error: Error | null };
type Context = { scope: string; project: string | undefined };
type Receipt = {
  context: Context;
  phase: "pending" | "checked" | "error";
  checkedAt?: number;
};

/** Local user-request receipt, never a background-poll or persisted event. */
export function useExplicitRead(scope: string) {
  const client = useQueryClient();
  const project = () => client.getQueryData<AppState>(["app"])?.jam?.id;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const context = useRef<Context>({ scope, project: project() });
  const live = useRef(true);
  const lock = useRef<Context | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const sync = () => {
    const id = project();
    if (
      context.current.scope !== currentScope.current ||
      context.current.project !== id
    ) {
      context.current = { scope: currentScope.current, project: id };
      lock.current = null;
    }
    return context.current;
  };
  sync();
  useEffect(() => {
    live.current = true;
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== "app") return;
      const id = client.getQueryData<AppState>(["app"])?.jam?.id;
      if (context.current.project !== id) {
        context.current = { scope: currentScope.current, project: id };
        lock.current = null;
        setReceipt(null);
      }
    });
    return () => {
      live.current = false;
      context.current = { ...context.current };
      lock.current = null;
      unsubscribe();
    };
  }, [client]);
  const run = async (read: () => Promise<Outcome>) => {
    const captured = sync();
    if (!live.current || lock.current === captured) return;
    lock.current = captured;
    setReceipt({ context: captured, phase: "pending" });
    const valid = () => live.current && sync() === captured;
    try {
      // TanStack refetch normally RESOLVES with an error result; fulfillment
      // alone is not evidence that a read succeeded.
      const result = await read();
      if (valid())
        setReceipt({
          context: captured,
          phase: result.isError ? "error" : "checked",
          checkedAt: result.isError ? undefined : Date.now(),
        });
    } catch {
      if (valid()) setReceipt({ context: captured, phase: "error" });
    } finally {
      if (lock.current === captured) lock.current = null;
    }
  };
  const phase = receipt?.context === context.current ? receipt.phase : null;
  return {
    run,
    phase,
    checkedAt: phase === "checked" ? receipt?.checkedAt : undefined,
    pending: phase === "pending",
  };
}
