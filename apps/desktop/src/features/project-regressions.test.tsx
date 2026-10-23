import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";
import { invalidatePlanning } from "../lib/planning-queries";
import { ProjectsPage } from "./projects/ProjectsPage";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  await mockApi.resetDemo();
});
it("reviewer project picker updates task counts after task creation", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const view = () => (
    <QueryClientProvider client={client}>
      <ProjectsPage />
    </QueryClientProvider>
  );
  const first = render(view());
  await screen.findByRole("button", { name: /Open project Cozy Jam/ });
  const before = (await mockApi.listProjects(true))[0];
  if (!before) throw new Error("Missing original project");
  expect(
    screen.getByText(new RegExp(`${before.taskCount} tasks`)),
  ).toBeVisible();
  first.unmount();
  await mockApi.createTask({
    title: "Added after visiting projects",
    status: "backlog",
  });
  invalidatePlanning(client);
  const after = (await mockApi.listProjects(true))[0];
  if (!after) throw new Error("Missing updated project");
  expect(after.taskCount).toBe(before.taskCount + 1);
  render(view());
  await waitFor(() =>
    expect(
      screen.getByText(new RegExp(`${after.taskCount} tasks`)),
    ).toBeVisible(),
  );
});

it("reviewer canceled old-project result cannot overwrite new active query", async () => {
  const { QueryObserver } = await import("@tanstack/react-query");
  const { acceptProjectSelection } = await import("../lib/project-selection");
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  let resolveOld!: (value: string[]) => void;
  const old = new Promise<string[]>((resolve) => {
    resolveOld = resolve;
  });
  let selected = "A";
  const observer = new QueryObserver(client, {
    queryKey: ["epics"],
    queryFn: () => (selected === "A" ? old : Promise.resolve(["B epic"])),
  });
  const stop = observer.subscribe(() => {});
  selected = "B";
  await acceptProjectSelection(client, await mockApi.appState());
  expect(client.getQueryData(["epics"])).toEqual(["B epic"]);
  resolveOld(["A epic"]);
  await old;
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(client.getQueryData(["epics"])).toEqual(["B epic"]);
  stop();
  client.clear();
});
