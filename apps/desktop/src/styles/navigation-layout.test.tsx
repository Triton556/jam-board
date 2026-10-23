import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { StoryDrawer } from "../features/plan/StoryDrawer";
import { mockApi } from "../lib/mock-bridge";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  vi.restoreAllMocks();
  await mockApi.resetDemo();
});

it("the sticky-header allowance applies to body rows, not the sticky sort controls themselves", () => {
  const css = readFileSync("src/styles/app.css", "utf8");
  const container = css.match(/\.table-scroll\s*\{([^}]+)\}/)?.[1] ?? "";
  expect(container).not.toMatch(/scroll-padding-top:\s*84px/);
  expect(css).toMatch(
    /\.task-table tbody tr\s*\{\s*scroll-margin-top:\s*84px;/,
  );
});
it("Story permission uses a full-width heading and a separate action row without removing policy text", async () => {
  const style = document.createElement("style");
  style.textContent = readFileSync("src/styles/workflow.css", "utf8");
  document.head.append(style);
  try {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <StoryDrawer storyKey="JB-S1" close={vi.fn()} openTask={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByText("New work paused");
    const section = screen.getByRole("region", { name: "Story execution" });
    const actions = section.querySelector(".execution-actions") as HTMLElement;
    const count = section.querySelector(
      ".execution-heading > .small:last-child",
    ) as HTMLElement;
    // CSS/cascade contract only; Happy DOM does not measure actual widths.
    expect(getComputedStyle(section).gridTemplateColumns).toBe(
      "minmax(0, 1fr)",
    );
    expect(getComputedStyle(actions).gridColumn).toBe("1");
    expect(getComputedStyle(actions).gridRow).toBe("auto");
    expect(getComputedStyle(actions).justifyContent).toBe("flex-start");
    expect(getComputedStyle(count).whiteSpace).toBe("nowrap");
    expect(actions).toHaveTextContent(
      "Start lets agents take Ready tasks; it does not launch them.",
    );
    expect(screen.getByRole("button", { name: "Start story" })).toBeEnabled();
  } finally {
    style.remove();
  }
});
