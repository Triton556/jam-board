import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { useUiStore } from "../../lib/ui-store";
import { TaskDrawer } from "../task/TaskDrawer";
import { AssetLinkDialog } from "./AssetLinkDialog";
import { AssetDialog } from "./AssetsPage";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => "/board",
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
  useUiStore.setState({ taskChanges: {}, highlights: {}, toasts: [] });
});
afterEach(() => vi.restoreAllMocks());
async function mount(node: ReactNode, cached = true) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  if (cached) client.setQueryData(["app"], await mockApi.appState());
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}
it.each(["assets", "tasks"] as const)(
  "F01 %s: arrows announce/scroll the active option; Enter selects, Tab+Enter links once",
  async (source) => {
    const asset = (await mockApi.listAssets())[0];
    if (!asset) throw new Error("Missing asset fixture");
    const link = vi.spyOn(mockApi, "linkAsset");
    const close = vi.fn();
    await mount(
      <AssetLinkDialog
        {...(source === "assets" ? { taskKey: "JB-1" } : { assetId: asset.id })}
        close={close}
      />,
    );
    const search = screen.getByRole("combobox", { name: "Search" });
    const options = await screen.findAllByRole("option");
    const first = options[0],
      second = options[1];
    if (!first || !second) throw new Error("Need two link results");
    const scroll = vi.fn();
    Object.defineProperty(first, "scrollIntoView", {
      configurable: true,
      value: scroll,
    });
    const user = userEvent.setup();
    await user.click(search);
    await user.keyboard("{ArrowDown}");
    expect(search).toHaveAttribute("aria-activedescendant", first.id);
    expect(first).toHaveAttribute("data-active", "true");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    await user.keyboard("{ArrowDown}");
    expect(search).toHaveAttribute("aria-activedescendant", second.id);
    await user.keyboard("{ArrowUp}{Enter}");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(search).toHaveFocus();
    const confirm = screen.getByRole("button", { name: "Link" });
    expect(confirm).toBeEnabled();
    expect(link).not.toHaveBeenCalled();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(link).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledWith(
      source === "assets"
        ? { assetId: asset.id, taskKey: "JB-1" }
        : { assetId: asset.id, taskKey: first.textContent?.split(" ")[0] },
    );
  },
);
it("F01 filtering clears stale active/selected results; empty results cannot link", async () => {
  const link = vi.spyOn(mockApi, "linkAsset");
  await mount(<AssetLinkDialog taskKey="JB-1" close={vi.fn()} />);
  await screen.findAllByRole("option");
  const search = screen.getByRole("combobox");
  const user = userEvent.setup();
  await user.click(search);
  await user.keyboard("{ArrowUp}{Enter}");
  expect(screen.getByRole("button", { name: "Link" })).toBeEnabled();
  await user.type(search, "No matching asset fixture");
  await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
  expect(search).not.toHaveAttribute("aria-activedescendant");
  expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
  expect(link).not.toHaveBeenCalled();
});
it("F01 failed source results cannot be activated or linked by Enter", async () => {
  vi.spyOn(mockApi, "listAssets").mockRejectedValue(
    new Error("Link list failed"),
  );
  const link = vi.spyOn(mockApi, "linkAsset");
  await mount(<AssetLinkDialog taskKey="JB-1" close={vi.fn()} />);
  await screen.findByRole("alert");
  const search = screen.getByRole("combobox");
  const user = userEvent.setup();
  await user.click(search);
  await user.keyboard("{ArrowDown}{Enter}");
  expect(search).not.toHaveAttribute("aria-activedescendant");
  expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();
  expect(link).not.toHaveBeenCalled();
});
it("F01 Escape closes the link dialog and restores its trigger without linking", async () => {
  const link = vi.spyOn(mockApi, "linkAsset");
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open asset link
        </button>
        {open && (
          <AssetLinkDialog taskKey="JB-1" close={() => setOpen(false)} />
        )}
      </>
    );
  }
  await mount(<Example />);
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Open asset link" });
  await user.click(trigger);
  await screen.findAllByRole("option");
  await user.click(screen.getByRole("combobox"));
  await user.keyboard("{ArrowDown}{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(link).not.toHaveBeenCalled();
});
it.each([false, true])(
  "F02 asset Name receives initial focus (edit=%s), skipping disabled location",
  async (edit) => {
    const asset = edit ? (await mockApi.listAssets())[0] : undefined;
    await mount(<AssetDialog asset={asset} close={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    expect(
      screen.getByRole("textbox", { name: "Asset location" }),
    ).toBeDisabled();
  },
);
it("F02 a cold context read does not steal initial Name focus when it completes", async () => {
  await mount(<AssetDialog close={vi.fn()} />, false);
  const name = screen.getByRole("textbox", { name: "Name" });
  expect(name).toHaveFocus();
  await waitFor(() => expect(name).not.toHaveAttribute("readonly"));
  expect(name).toHaveFocus();
});
async function saveTooltip() {
  const save = await screen.findByRole("button", { name: /^Save.*Ctrl\+S/ });
  const wrapper = save.parentElement;
  if (!wrapper) throw new Error("Missing Save tooltip wrapper");
  return { save, wrapper };
}
it("F04 unchanged task Save explains that there are no unsaved changes", async () => {
  await mount(<TaskDrawer taskKey="JB-1" close={vi.fn()} />);
  const { save, wrapper } = await saveTooltip();
  expect(save).toBeDisabled();
  await userEvent.hover(wrapper);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "No unsaved changes.",
  );
});
it("F04 archived task Save explains the need to unarchive first", async () => {
  await mockApi.archiveTask("JB-1", "Archive tooltip fixture");
  await mount(<TaskDrawer taskKey="JB-1" close={vi.fn()} />);
  const { save, wrapper } = await saveTooltip();
  expect(save).toBeDisabled();
  await userEvent.hover(wrapper);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Unarchive this task before editing.",
  );
});
it("F04 invalid task Save explains validation instead of claiming everything is saved", async () => {
  await mount(<TaskDrawer taskKey="JB-1" close={vi.fn()} />);
  const title = await screen.findByRole("textbox", { name: "Task title" });
  await userEvent.clear(title);
  const { save, wrapper } = await saveTooltip();
  expect(save).toBeDisabled();
  await userEvent.hover(wrapper);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Fix the highlighted fields before saving.",
  );
});
it("F04 pending task Save explains waiting and dispatches only once", async () => {
  let finish!: (task: Awaited<ReturnType<typeof mockApi.getTask>>) => void;
  const task = await mockApi.getTask("JB-1");
  const update = vi.spyOn(mockApi, "updateTask").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await mount(<TaskDrawer taskKey="JB-1" close={vi.fn()} />);
  const title = await screen.findByRole("textbox", { name: "Task title" });
  fireEvent.change(title, { target: { value: "A changed title" } });
  const { save, wrapper } = await saveTooltip();
  await waitFor(() => expect(save).toBeEnabled());
  const user = userEvent.setup();
  await user.click(save);
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(save).toBeDisabled();
  await user.hover(wrapper);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Wait for the result",
  );
  await act(async () => {
    finish({ ...task, title: "A changed title" });
  });
});
