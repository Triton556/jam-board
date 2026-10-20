import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog, Kbd } from "../../components/ui";
import { api } from "../../lib/api";
import { tasksQuery } from "../../lib/queries";
import { useUiStore } from "../../lib/ui-store";

const destinations = [
  "Board",
  "Table",
  "Assets",
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
  const runtime = useQuery({
    queryKey: ["runtime"],
    queryFn: () => api.runtimeInfo(),
  });
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
    ...[
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
        label: "Copy MCP config (Codex)",
        run: () => {
          if (!runtime.data) return;
          const path = runtime.data.sidecarPath.replace(/'/g, "''");
          const dataDir = runtime.data.dataDir.replace(/'/g, "''");
          void navigator.clipboard
            .writeText(
              `[mcp_servers.jam-board]\ncommand = '${path}'\nenv = { JAM_AGENT_NAME = "Codex", JAM_BOARD_DATA_DIR = '${dataDir}' }\n`,
            )
            .catch((e) => useUiStore.getState().error(String(e)));
        },
      },
    ]
      .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
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
