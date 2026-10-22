import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Dialog, modalTabStops } from "./controls";

it("modal tab stops include closed disclosure summaries but not hidden, inert or negative-tabindex descendants", () => {
  const view = render(
    <div data-testid="root">
      <button type="button">First</button>
      <details>
        <summary>Earlier report</summary>
        <button type="button">Hidden report action</button>
      </details>
      <div hidden>
        <button type="button">Hidden parent</button>
      </div>
      <div inert>
        <button type="button">Inert parent</button>
      </div>
      <div style={{ display: "none" }}>
        <button type="button">CSS hidden</button>
      </div>
      <button type="button" tabIndex={-1}>
        Programmatic only
      </button>
      <input type="hidden" />
      <button type="button">Last</button>
    </div>,
  );
  expect(
    modalTabStops(view.getByTestId("root")).map((node) => node.textContent),
  ).toEqual(["First", "Earlier report", "Last"]);
});
it("a nested closed disclosure never makes its inner summary a tab stop", () => {
  const view = render(
    <div data-testid="root">
      <details>
        <summary>Outer</summary>
        <details>
          <summary>Inner</summary>
          <button type="button">Action</button>
        </details>
      </details>
    </div>,
  );
  expect(
    modalTabStops(view.getByTestId("root")).map((node) => node.textContent),
  ).toEqual(["Outer"]);
});
it("Tab wraps around visible controls rather than focusing a hidden earlier-report action", async () => {
  render(
    <Dialog title="Evidence" onClose={() => {}}>
      <button type="button">Review latest</button>
      <details>
        <summary>Earlier evidence</summary>
        <button type="button">Hidden action</button>
      </details>
    </Dialog>,
  );
  const user = userEvent.setup(),
    summary = screen.getByText("Earlier evidence");
  // The dialog container starts focused: Shift+Tab must go to the visible last summary.
  await user.tab({ shift: true });
  expect(summary).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Close Evidence" })).toHaveFocus();
});
