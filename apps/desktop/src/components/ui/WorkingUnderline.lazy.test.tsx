import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WorkingLine } from "./AgentWorking";

const load = vi.hoisted(() => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
});
vi.mock("./WorkingUnderline", async (original) => {
  await load.promise;
  return original();
});
it("H-B01 live activity text and its static underline render before the drawing chunk without a loading label", async () => {
  const { container } = render(
    <WorkingLine
      state={{
        mode: "quiet",
        color: "var(--ink-3)",
        name: "Worker",
        status: "reported",
        text: "Worker · last update",
        tooltip: "Last reported activity",
      }}
    />,
  );
  expect(screen.getByText("Worker · last update")).toBeVisible();
  const fallback = container.querySelector(".working-underline");
  const path = fallback?.querySelector("path")?.getAttribute("d");
  expect(path).toContain("C44.56248544825758");
  expect(fallback?.querySelector("path")).toHaveStyle({ animation: "none" });
  expect(screen.queryByText(/Loading/)).toBeNull();
  await act(async () => load.resolve());
  await waitFor(() =>
    expect(container.querySelector(".working-underline")).not.toBe(fallback),
  );
  expect(container.querySelector(".working-underline path")).toHaveAttribute(
    "d",
    path,
  );
  expect(screen.getByText("Worker · last update")).toBeVisible();
});
