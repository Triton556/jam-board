import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog, Kbd } from "../../components/ui";
import { api } from "../../lib/api";
import { epicsQuery } from "../../lib/planning-queries";
import { tasksQuery } from "../../lib/queries";
import { useUiStore } from "../../lib/ui-store";

const destinations = [
  "Plan",
  "Inbox",
  "Board",
  "Table",
  "Assets",
  "References",
  "Team",
  "Activity",
  "Settings",
] as const;

import { rankTasks } from "./rank";

export { rankTasks } from "./rank";
export function CommandPalette({
  close,
  newTask,
  toggleTheme,
}: {
  close(): void;
  newTask(): void;
  toggleTheme(): void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const tasks = useQuery(tasksQuery);
  const epics = useQuery(epicsQuery);
  const navigate = useNavigate();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const items: {
    id: string;
    group: string;
    label: string;
    hint?: string;
    run(): void;
  }[] = [
    ...rankTasks(Object.values(tasks.data ?? {}).flat(), query).map((task) => ({
      id: task.key,
      group: "Tasks",
      label: task.title,
      hint: task.key,
      run: () => {
        void navigate({ to: "/board", search: { task: task.key } });
      },
    })),
    ...(epics.data ?? [])
      .filter((e) =>
        `${e.key} ${e.title}`.toLowerCase().includes(query.toLowerCase()),
      )
      .slice(0, 8)
      .map((e) => ({
        id: e.key,
        group: "Epics",
        label: `Go to epic ${e.key} · ${e.title}`,
        run: () => {
          void navigate({ to: "/plan/$epicKey", params: { epicKey: e.key } });
        },
      })),
    ...[
      {
        id: "new-epic",
        label: "New epic",
        run: () => {
          void navigate({ to: "/plan", search: { create: "epic" } });
        },
      },
      {
        id: "new-story",
        label: "New story in…",
        run: () => {
          const e = epics.data?.find((e) => e.status !== "archived");
          if (e)
            void navigate({
              to: "/plan/$epicKey",
              params: { epicKey: e.key },
              search: { create: "story", tab: "Stories" },
            });
        },
      },
      {
        id: "inbox",
        label: "Open inbox",
        hint: "G I",
        run: () => {
          void navigate({ to: "/inbox" });
        },
      },
      { id: "new", label: "New task", hint: "N", run: newTask },
      ...(tasks.data && Object.values(tasks.data).every((t) => !t.length)
        ? [
            {
              id: "demo",
              label: "Load demo jam",
              run: () => {
                void api
                  .loadDemoJam()
                  .then(() => client.invalidateQueries())
                  .catch((e) => useUiStore.getState().error(String(e)));
              },
            },
          ]
        : []),
      { id: "theme", label: "Toggle theme", run: toggleTheme },
      {
        id: "config",
        label: "Set up agent connection (MCP)…",
        run: () => {
          void navigate({ to: "/settings", search: { section: "Agents" } });
        },
      },
    ]
      .filter((item) =>
        `${item.label}${item.id === "config" ? " config codex claude" : ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .map((item) => ({ ...item, group: "Actions" })),
    ...destinations
      .filter((name) => name.toLowerCase().includes(query.toLowerCase()))
      .map((name) => ({
        id: name,
        group: "Navigate",
        label: name,
        run: () => {
          void navigate({ to: `/${name.toLowerCase()}` as "/board" });
        },
      })),
  ];
  const run = (index: number) => {
    items[index]?.run();
    close();
  };
  return (
    <Dialog
      title="Search & commands"
      onClose={close}
      className="command-dialog"
    >
      <input
        ref={input}
        className="command-search"
        aria-label="Search commands"
        placeholder="Find a task, action, or place…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        role="combobox"
        aria-expanded="true"
        aria-controls="command-results"
        aria-activedescendant={
          items[active] ? `command-${items[active]?.id}` : undefined
        }
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive(
              (i) =>
                (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                Math.max(1, items.length),
            );
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(active);
          }
        }}
      />
      <div
        className="command-results"
        id="command-results"
        role="listbox"
        aria-label="Commands"
      >
        {items.map((item, index) => (
          <div key={item.id}>
            {items[index - 1]?.group !== item.group && (
              <div className="command-group eyebrow">{item.group}</div>
            )}
            <button
              type="button"
              role="option"
              aria-selected={active === index}
              id={`command-${item.id}`}
              onMouseMove={() => setActive(index)}
              onClick={() => run(index)}
              className={active === index ? "active" : ""}
            >
              {item.group === "Tasks" ? (
                <FileText size={17} />
              ) : (
                <ArrowUpRight size={17} />
              )}
              <span>{item.label}</span>
              {item.hint && <Kbd>{item.hint}</Kbd>}
            </button>
          </div>
        ))}
        {!items.length && (
          <p className="muted">No matches. Try a task key or a few letters.</p>
        )}
      </div>
      <div className="palette-footer">
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> to explore
        </span>
        <span>
          <Kbd>↵</Kbd> to open
        </span>
        <span>
          <Kbd>Esc</Kbd> to close
        </span>
      </div>
    </Dialog>
  );
}
