import { useSyncExternalStore } from "react";

const relative = new Intl.RelativeTimeFormat("en", {
  style: "short",
  numeric: "auto",
});
const exact = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});
const listeners = new Set<() => void>();
let now = Date.now();
let interval: ReturnType<typeof setInterval> | undefined;
let cache = new Map<string, { label: string; exact: string }>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!interval) {
    now = Date.now();
    cache = new Map();
    interval = setInterval(() => {
      now = Date.now();
      cache.clear();
      for (const notify of listeners) notify();
    }, 30000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(interval);
      interval = undefined;
    }
  };
}
export function useTableClock() {
  return useSyncExternalStore(subscribe, () => now);
}
export function tableTime(iso: string, tick: number) {
  const key = `${tick}:${iso}`;
  let text = cache.get(key);
  if (!text) {
    const seconds = Math.max(0, Math.floor((tick - Date.parse(iso)) / 1000));
    const unit = seconds >= 86400 ? "day" : seconds >= 3600 ? "hour" : "minute";
    const divisor = unit === "day" ? 86400 : unit === "hour" ? 3600 : 60;
    text = {
      label:
        seconds < 60
          ? "just now"
          : relative.format(-Math.floor(seconds / divisor), unit),
      exact: exact.format(new Date(iso)),
    };
    if (cache.size > 10000) cache.clear();
    cache.set(key, text);
  }
  return text;
}
