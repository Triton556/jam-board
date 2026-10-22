import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../lib/mock-bridge";
import { SettingsPage } from "./settings/SettingsPage";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  await mockApi.resetDemo();
});
afterEach(() => vi.restoreAllMocks());
async function mount() {
  const user = userEvent.setup();
  await navigator.clipboard.writeText("previous clipboard");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <SettingsPage initialSection="Agents" />
    </QueryClientProvider>,
  );
  const region = within(
    await screen.findByRole("region", { name: "Connect the board" }),
  );
  await waitFor(() =>
    expect(region.getByRole("button", { name: "Copy" })).toBeEnabled(),
  );
  await user.click(region.getByRole("tab", { name: "Codex · HTTP" }));
  return { ...view, user, client, region };
}
it("one accepted copy locks transport and duplicate handlers, then permits a later explicit stdio copy", async () => {
  let finish!: (token: string) => void;
  const reveal = vi.spyOn(mockApi, "revealMcpToken").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { user, region } = await mount();
  const copy = region.getByRole("button", { name: "Copy" });
  await user.dblClick(copy);
  expect(reveal).toHaveBeenCalledOnce();
  expect(region.getByRole("button", { name: "Copying…" })).toBeDisabled();
  const stdio = region.getByRole("tab", { name: "Codex · stdio" });
  expect(stdio).toBeDisabled();
  fireEvent.click(stdio);
  fireEvent.click(copy);
  expect(reveal).toHaveBeenCalledOnce();
  expect(region.getByRole("tab", { name: "Codex · HTTP" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await navigator.clipboard.readText()).toBe("previous clipboard");
  await act(async () => {
    finish("fictional-http-token");
  });
  expect(await navigator.clipboard.readText()).toContain(
    "fictional-http-token",
  );
  await user.click(stdio);
  await user.click(region.getByRole("button", { name: "Copy" }));
  expect(await navigator.clipboard.readText()).toContain("command =");
  expect(await navigator.clipboard.readText()).not.toContain(
    "fictional-http-token",
  );
});
it.each([false, true])(
  "project changes cancel an outstanding token read without clipboard or success receipt (return=%s)",
  async (returnToOriginal) => {
    let finish!: (token: string) => void;
    vi.spyOn(mockApi, "revealMcpToken").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { user, client, region } = await mount();
    const original = await mockApi.appState();
    await user.click(region.getByRole("button", { name: "Copy" }));
    await act(async () => {
      client.setQueryData(["app"], {
        ...original,
        jam: {
          ...original.jam,
          id: "other-project",
          name: "Different project",
          keyPrefix: "DIFF",
        },
      });
    });
    if (returnToOriginal)
      await act(async () => {
        client.setQueryData(["app"], original);
      });
    await act(async () => {
      finish("must-not-be-copied");
    });
    expect(await navigator.clipboard.readText()).toBe("previous clipboard");
    expect(screen.queryByText(/Configuration copied for/)).toBeNull();
  },
);
it("unmount cancels a pending token copy and never writes a late secret", async () => {
  let finish!: (token: string) => void;
  vi.spyOn(mockApi, "revealMcpToken").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { user, region, unmount } = await mount();
  const write = vi.spyOn(navigator.clipboard, "writeText");
  await user.click(region.getByRole("button", { name: "Copy" }));
  unmount();
  await act(async () => {
    finish("must-not-be-copied");
  });
  expect(write).not.toHaveBeenCalled();
  expect(await navigator.clipboard.readText()).toBe("previous clipboard");
});
it("token failure leaves clipboard intact, unlocks setup, and only an explicit new copy retries", async () => {
  const reveal = vi
    .spyOn(mockApi, "revealMcpToken")
    .mockRejectedValueOnce(Error("Token unavailable"))
    .mockResolvedValueOnce("retry-fictional-token");
  const { user, region } = await mount();
  await user.click(region.getByRole("button", { name: "Copy" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Token unavailable",
  );
  expect(await navigator.clipboard.readText()).toBe("previous clipboard");
  expect(reveal).toHaveBeenCalledOnce();
  expect(region.getByRole("tab", { name: "Codex · stdio" })).toBeEnabled();
  await user.click(region.getByRole("button", { name: "Copy" }));
  expect(reveal).toHaveBeenCalledTimes(2);
  expect(await navigator.clipboard.readText()).toContain(
    "retry-fictional-token",
  );
});
it("a pending stdio clipboard write also locks the reverse transport order until it settles", async () => {
  const { user, region } = await mount();
  await user.click(region.getByRole("tab", { name: "Codex · stdio" }));
  const realWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
  let finish!: () => Promise<void>;
  vi.spyOn(navigator.clipboard, "writeText").mockImplementationOnce(
    (text) =>
      new Promise<void>((resolve) => {
        finish = async () => {
          await realWrite(text);
          resolve();
        };
      }),
  );
  const reveal = vi
    .spyOn(mockApi, "revealMcpToken")
    .mockResolvedValue("later-http-token");
  await user.click(region.getByRole("button", { name: "Copy" }));
  const http = region.getByRole("tab", { name: "Codex · HTTP" });
  expect(http).toBeDisabled();
  fireEvent.click(http);
  expect(reveal).not.toHaveBeenCalled();
  await act(async () => {
    await finish();
  });
  expect(await navigator.clipboard.readText()).toContain("command =");
  await user.click(http);
  await user.click(region.getByRole("button", { name: "Copy" }));
  expect(await navigator.clipboard.readText()).toContain("later-http-token");
});
