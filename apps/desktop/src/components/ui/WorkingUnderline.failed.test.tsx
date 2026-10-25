import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WorkingLine } from "./AgentWorking";

vi.mock("./WorkingUnderline", async () => {
  throw Error("Drawing chunk unavailable");
});
it("H-B01 unavailable underline rendering preserves activity text and its fallback artwork", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { container } = render(
    <WorkingLine
      state={{
        mode: "quiet",
        color: "var(--ink-3)",
        name: "Worker",
        status: "reported",
        text: "Worker · reported",
        tooltip: "Last reported activity",
      }}
    />,
  );
  await waitFor(() => expect(error).toHaveBeenCalled());
  expect(screen.getByText("Worker · reported")).toBeVisible();
  expect(container.querySelector(".working-underline path")).not.toBeNull();
  expect(screen.queryByText(/Loading/)).toBeNull();
  error.mockRestore();
});
