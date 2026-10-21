import type { TaskSummary } from "../../lib/types";
export function rankTasks(tasks: TaskSummary[], query: string) {
  const q = query.trim().toLowerCase();
  const score = (task: TaskSummary) => {
    const key = task.key.toLowerCase(),
      title = task.title.toLowerCase();
    if (q && (q === key || q === key.split("-").at(-1))) return 10000;
    if (!q) return 1;
    if (key.includes(q)) return 1000;
    if (title.includes(q)) return 500;
    let index = 0;
    for (const c of `${key} ${title}`) if (c === q[index]) index++;
    return index === q.length ? 100 - q.length : 0;
  };
  return tasks
    .map((task) => ({ task, score: score(task) }))
    .filter((t) => t.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.task.key.localeCompare(b.task.key, undefined, { numeric: true }),
    )
    .slice(0, 8)
    .map((t) => t.task);
}
