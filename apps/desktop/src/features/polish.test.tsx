import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { SegmentedControl } from "../components/ui";
import { mockApi } from "../lib/mock-bridge";
import { ActivityPage } from "./activity/ActivityPage";
import { AssetsPage } from "./assets/AssetsPage";
import { BoardHeader } from "./board/BoardHeader";
import { SettingsPage } from "./settings/SettingsPage";
import { TaskDrawer } from "./task/TaskDrawer";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
vi.mock("../lib/sound", () => ({ paperRustle: vi.fn() }));
beforeEach(async () => {
  await mockApi.loadDemoJam();
  await mockApi.setSettings({ estimatesEnabled: true });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
function wrap(children: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, staleTime: Infinity } },
        })
      }
    >
      {children}
    </QueryClientProvider>,
  );
}
it("segments use radio roles, roving focus and arrow/Home/End selection without underline elements", async () => {
  function Example() {
    const [value, set] = useState("a");
    return (
      <SegmentedControl
        label="Example"
        value={value}
        onChange={set}
        options={[
          { value: "a", label: "One" },
          { value: "b", label: "Two" },
          { value: "c", label: "Three" },
        ]}
      />
    );
  }
  render(<Example />);
  const user = userEvent.setup();
  await user.tab();
  expect(screen.getByRole("radio", { name: "One" })).toHaveFocus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio", { name: "Two" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await user.keyboard("{End}");
  expect(screen.getByRole("radio", { name: "Three" })).toHaveFocus();
  await user.keyboard("{ArrowRight}{ArrowLeft}{Home}");
  expect(screen.getByRole("radio", { name: "One" })).toHaveFocus();
  expect(screen.getByRole("radiogroup").children).toHaveLength(3);
  for (const radio of screen.getAllByRole("radio"))
    expect(radio.children).toHaveLength(0);
});
it("all five screen controls use the same segmented component class", async () => {
  const board = wrap(<BoardHeader />);
  expect(
    await screen.findByRole("radiogroup", { name: "Color by" }),
  ).toHaveClass("segmented");
  board.unmount();
  const activity = wrap(<ActivityPage openTask={() => {}} />);
  expect(
    screen.getByRole("radiogroup", { name: "Activity filter" }),
  ).toHaveClass("segmented");
  activity.unmount();
  const assets = wrap(<AssetsPage openTask={() => {}} />);
  expect(screen.getByRole("radiogroup", { name: "Assets view" })).toHaveClass(
    "segmented",
  );
  assets.unmount();
  wrap(<TaskDrawer taskKey="JB-7" close={() => {}} />);
  expect(
    await screen.findByRole("radiogroup", { name: "Priority" }),
  ).toHaveClass("segmented", "segmented-large");
  expect(
    await screen.findByRole("radiogroup", { name: "Estimate" }),
  ).toHaveClass("segmented", "segmented-large");
  expect(
    within(screen.getByRole("radiogroup", { name: "Priority" })).getAllByRole(
      "radio",
    ),
  ).toHaveLength(4);
});
it("playing a sample while sounds are off never enables them", async () => {
  await mockApi.setSettings({ soundEnabled: false });
  wrap(<SettingsPage initialSection="Appearance" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Play sample" }));
  expect((await import("../lib/sound")).paperRustle).toHaveBeenCalledOnce();
  expect(screen.getByRole("switch", { name: "Sounds" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  expect((await mockApi.getSettings()).soundEnabled).toBe(false);
});
