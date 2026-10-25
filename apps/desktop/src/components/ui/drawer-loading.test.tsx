import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
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
