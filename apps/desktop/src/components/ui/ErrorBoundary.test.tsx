import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

vi.mock("@tanstack/react-router", () => ({}));

function Child({ fail }: { fail: boolean }) {
  if (fail) throw Error("Lazy module unavailable");
  return <p>Editor ready</p>;
}
it("router-independent fallback keeps focused recovery controls until an explicit reset", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const view = render(
      <ErrorBoundary
        resetKey={0}
        fallback={<button type="button">Recover</button>}
      >
        <Child fail />
      </ErrorBoundary>,
    );
    const recovery = screen.getByRole("button", { name: "Recover" });
    recovery.focus();
    view.rerender(
      <ErrorBoundary
        resetKey={0}
        fallback={<button type="button">Recover</button>}
      >
        <Child fail={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: "Recover" })).toBe(recovery);
    expect(recovery).toHaveFocus();
    view.rerender(
      <ErrorBoundary
        resetKey={1}
        fallback={<button type="button">Recover</button>}
      >
        <Child fail={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Editor ready")).toBeVisible();
  } finally {
    error.mockRestore();
  }
});
