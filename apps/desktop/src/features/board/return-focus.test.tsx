import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { Dialog, Drawer } from "../../components/ui";
import { BoardOverflow } from "./BoardOverflow";
import { useBoardReturnFocus } from "./use-board-return-focus";

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["app"], { jam: { id: "A" } });
});
function Owner({
  taskKey,
  status = "ready",
  visible = true,
}: {
  taskKey?: string;
  status?: string;
  visible?: boolean;
}) {
  const restore = useBoardReturnFocus(taskKey);
  return (
    <>
      <BoardOverflow>
        <div data-column={status} key={status}>
          {visible &&
            ["JB-1", "JB-2"].map((key) => (
              <button key={key} type="button" data-board-task-key={key}>
                {key}
              </button>
            ))}
        </div>
      </BoardOverflow>
      {taskKey && (
        <Drawer
          key={taskKey}
          title={taskKey}
          onClose={() => {}}
          returnFocus={restore}
        >
          <button type="button">Editing {taskKey}</button>
        </Drawer>
      )}
    </>
  );
}
const wrap = (children: React.ReactNode) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
it("uses the Board entry when the saved column has not reconciled, without a later focus jump", () => {
  const view = render(wrap(<Owner taskKey="JB-1" />));
  act(() =>
    client.setQueryData(["task", "JB-1"], {
      jamId: "A",
      status: "backlog",
      archivedAt: null,
    }),
  );
  view.rerender(wrap(<Owner />));
  const board = screen.getByRole("region", { name: "Board columns" });
  expect(board).toHaveFocus();
  view.rerender(wrap(<Owner status="backlog" />));
  expect(board).toHaveFocus();
  expect(screen.getByRole("button", { name: "JB-1" })).not.toHaveFocus();
});
it.each(["filtered", "archived"])(
  "a %s card returns to the Board rather than a detached trigger",
  (reason) => {
    const view = render(wrap(<Owner />));
    screen.getByRole("button", { name: "JB-1" }).focus();
    view.rerender(wrap(<Owner taskKey="JB-1" />));
    if (reason === "archived")
      act(() =>
        client.setQueryData(["task", "JB-1"], {
          jamId: "A",
          status: "ready",
          archivedAt: "2026-01-01",
        }),
      );
    view.rerender(wrap(<Owner visible={reason === "archived"} />));
    expect(screen.getByRole("region", { name: "Board columns" })).toHaveFocus();
  },
);
it.each(["B", "ABA"])(
  "selection %s denies restoration even if the old trigger stays connected",
  (destination) => {
    const shell = (key?: string) =>
      wrap(
        <>
          <button type="button">New view control</button>
          <Owner taskKey={key} />
        </>,
      );
    const view = render(shell());
    const card = screen.getByRole("button", { name: "JB-1" });
    card.focus();
    view.rerender(shell("JB-1"));
    act(() => {
      client.setQueryData(["app"], { jam: { id: "B" } });
      if (destination === "ABA")
        client.setQueryData(["app"], { jam: { id: "A" } });
    });
    const other = screen.getByRole("button", { name: "New view control" });
    // The modal makes background controls inert until it closes.
    other.focus();
    expect(other).not.toHaveFocus();
    view.rerender(shell());
    expect(card.isConnected).toBe(true);
    expect(document.body).toHaveFocus();
    expect(card).not.toHaveFocus();
  },
);
it("route-owner unmount cannot restore into another still-mounted Board", () => {
  const shell = (owner: boolean) =>
    wrap(
      <>
        <button type="button">Destination</button>
        {owner ? (
          <Owner taskKey="JB-1" />
        ) : (
          <BoardOverflow>
            <button type="button" data-board-task-key="JB-1">
              Unrelated board card
            </button>
          </BoardOverflow>
        )}
      </>,
    );
  const view = render(shell(true));
  const destination = screen.getByRole("button", { name: "Destination" });
  destination.focus();
  view.rerender(shell(false));
  expect(document.body).toHaveFocus();
  expect(
    screen.getByRole("button", { name: "Unrelated board card" }),
  ).not.toHaveFocus();
});
it("task A to task B handoff keeps the new dialog focus and returns to B", () => {
  const view = render(wrap(<Owner taskKey="JB-1" />));
  view.rerender(wrap(<Owner taskKey="JB-2" />));
  expect(screen.getByRole("dialog", { name: "JB-2" })).toHaveFocus();
  view.rerender(wrap(<Owner />));
  expect(screen.getByRole("button", { name: "JB-2" })).toHaveFocus();
});
it("an older modal's cleanup cannot pull focus from a newer dialog", () => {
  const restore = vi.fn(() =>
    screen.queryByRole("button", { name: "Background" }),
  );
  const tree = (old: boolean, newer: boolean) => (
    <>
      <button type="button">Background</button>
      {old && (
        <Drawer title="Old" onClose={() => {}} returnFocus={restore}>
          Old
        </Drawer>
      )}
      {newer && (
        <Dialog title="New" onClose={() => {}}>
          <button type="button">New input</button>
        </Dialog>
      )}
    </>
  );
  const view = render(tree(true, false));
  view.rerender(tree(true, true));
  const input = screen.getByRole("button", { name: "New input" });
  input.focus();
  view.rerender(tree(false, true));
  expect(input).toHaveFocus();
  expect(restore).not.toHaveBeenCalled();
});
it("nested dialog closure restores its parent control before the Board resolver", async () => {
  const user = userEvent.setup();
  const restore = vi.fn(() =>
    screen.queryByRole("button", { name: "Background" }),
  );
  function Nested() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button">Background</button>
        <Drawer title="Task" onClose={() => {}} returnFocus={restore}>
          <button type="button" onClick={() => setOpen(true)}>
            Open nested
          </button>
          {open && (
            <Dialog title="Nested" onClose={() => setOpen(false)}>
              Nested details
            </Dialog>
          )}
        </Drawer>
      </>
    );
  }
  render(<Nested />);
  const trigger = screen.getByRole("button", { name: "Open nested" });
  await user.click(trigger);
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  expect(restore).not.toHaveBeenCalled();
});
