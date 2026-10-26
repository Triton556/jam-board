import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { lazy, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LazyDrawerBoundary } from "./LazyBoundary";

const route = vi.hoisted(() => ({ pathname: "/references" }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useRouterState: () => route.pathname,
}));
const pending = new Promise(() => {});
function Loading(): never {
  throw pending;
}

it("H-D01: Escape while the editor module is loading survives module resolution and restores the opener", async () => {
  route.pathname = "/board";
  let resolve!: (module: { default: () => React.ReactNode }) => void;
  const module = new Promise<{ default: () => React.ReactNode }>((done) => {
    resolve = done;
  });
  const Editor = lazy(() => module);
  const close = vi.fn();
  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open task
        </button>
        {open && (
          <LazyDrawerBoundary
            title="JB-12"
            kind="task"
            close={() => {
              close();
              setOpen(false);
            }}
          >
            <Editor />
          </LazyDrawerBoundary>
        )}
      </>
    );
  }
  render(<Host />);
  const opener = screen.getByRole("button", { name: "Open task" });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole("dialog")).toHaveFocus();
  fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
  await act(async () =>
    resolve({ default: () => <div role="dialog">Loaded editor</div> }),
  );
  expect(close).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});
afterEach(() =>
  document.head.querySelector("[data-drawer-loading-test]")?.remove(),
);

it.each(["light", "dark"])(
  "%s References task loading shell has no scrim or pointer barrier",
  (theme) => {
    route.pathname = "/references";
    const style = document.createElement("style");
    style.dataset.drawerLoadingTest = "";
    style.textContent = readFileSync("src/styles/app.css", "utf8");
    document.head.append(style);
    const view = render(
      <div data-theme={theme}>
        <LazyDrawerBoundary title="JB-12" kind="task" close={vi.fn()}>
          <Loading />
        </LazyDrawerBoundary>
      </div>,
    );
    const shell = screen.getByRole("dialog", { name: "JB-12" });
    // The drawer portal lives at body, so set the same root theme as the app.
    document.body.dataset.theme = theme;
    expect(shell).not.toHaveAttribute("aria-modal");
    const backdrop = shell.parentElement as HTMLElement;
    expect(getComputedStyle(backdrop).pointerEvents).toBe("none");
    expect(getComputedStyle(backdrop).backgroundColor).toBe("transparent");
    expect(getComputedStyle(shell).pointerEvents).toBe("auto");
    expect(screen.getByText("Loading task editor…")).toBeVisible();
    view.unmount();
    delete document.body.dataset.theme;
  },
);

it.each(["/board", "/plan/JB-E1", "/inbox"])(
  "%s keeps its loading drawer modal",
  (pathname) => {
    route.pathname = pathname;
    render(
      <LazyDrawerBoundary title="JB-12" kind="task" close={vi.fn()}>
        <Loading />
      </LazyDrawerBoundary>,
    );
    expect(screen.getByRole("dialog", { name: "JB-12" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
  },
);
