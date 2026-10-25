import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { useUiStore } from "../../lib/ui-store";
import { LazyReadinessDialog } from "./LazyReadinessDialog";

vi.mock("./Readiness", async () => {
  throw Error("Chunk unavailable");
});
it("H-BD04 a rejected readiness chunk leaves a closable dialog and an explicit reload action", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  useUiStore.setState({ readyRequest: null });
  render(<LazyReadinessDialog />);
  act(() =>
    useUiStore.setState({
      readyRequest: {
        key: "JB-1",
        status: "ready",
        expectedUpdatedAt: "2026-10-25T00:00:00Z",
      },
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not open readiness review",
  );
  expect(screen.getByRole("button", { name: "Reload app" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(useUiStore.getState().readyRequest).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});
