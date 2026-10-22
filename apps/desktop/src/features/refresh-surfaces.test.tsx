import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { mockApi } from "../lib/mock-bridge";
import { AssetsPage } from "./assets/AssetsPage";
import { ReferencesPage } from "./references/ReferencesPage";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => undefined,
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.setLatency(0);
});
afterEach(() => vi.restoreAllMocks());
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["app"], await mockApi.appState());
  return {
    ...render(
      <QueryClientProvider client={client}>{node}</QueryClientProvider>,
    ),
    client,
  };
}
it.each(["assets", "references"] as const)(
  "AS02 %s explicit check is single-flight and unchanged success has timestamp; failure keeps cache",
  async (kind) => {
    const { client } = await mount(
      kind === "assets" ? (
        <AssetsPage openTask={() => {}} />
      ) : (
        <ReferencesPage />
      ),
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const button = screen.getByRole("button", { name: `Refresh ${kind}` });
    const key = [kind];
    const cached = client.getQueryData(key);
    expect(cached).toBeDefined();
    const d = deferred<never>();
    const read = vi
      .spyOn(api, kind === "assets" ? "listAssets" : "referenceCanvas")
      .mockImplementation(() => d.promise);
    const user = userEvent.setup();
    await user.dblClick(button);
    expect(read).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByText(`Checking ${kind}…`, { selector: "p" }),
    ).toBeInTheDocument();
    const pendingFocus = document.activeElement;
    await act(async () => d.resolve(cached as never));
    await waitFor(() => expect(button).toBeEnabled());
    expect(
      screen.getByText(new RegExp(`Checked ${kind}\\.`)),
    ).toHaveTextContent("Last checked:");
    expect(document.activeElement).toBe(pendingFocus);
    expect(client.getQueryData(key)).toEqual(cached);
    read.mockRejectedValueOnce(new Error("Fictional read failure"));
    await user.click(button);
    await screen.findByText(`Could not check ${kind}. Try again when ready.`);
    expect(client.getQueryData(key)).toEqual(cached);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Fictional read failure",
    );
    expect(button).toBeEnabled();
  },
);
it("AS02 Assets background refresh stays quiet, changing filter invalidates explicit receipt", async () => {
  const { client } = await mount(<AssetsPage openTask={() => {}} />);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["assets"] });
  });
  expect(screen.queryByText(/Checked assets/)).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Refresh assets" }));
  await screen.findByText(/Checked assets/);
  await userEvent
    .setup()
    .type(
      screen.getByRole("textbox", { name: "Search assets" }),
      "fictional filter",
    );
  expect(screen.queryByText(/Checked assets/)).toBeNull();
});

it("VS01 reference feedback stays in one flow container without replacing controls or a local note", async () => {
  const { client } = await mount(<ReferencesPage />);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const toolbar = screen.getByRole("toolbar", { name: "Canvas tools" });
  const filters = screen.getByRole("group", { name: "Filter references" });
  const stack = toolbar.parentElement;
  expect(stack).toHaveClass("reference-control-stack");
  expect(filters.parentElement).toBe(stack);
  const notice = stack?.querySelector(".reference-read-notice");
  expect(notice).toBeEmptyDOMElement();
  const pendingCreate =
    deferred<Awaited<ReturnType<typeof api.addReference>>>();
  const write = vi
    .spyOn(api, "addReference")
    .mockReturnValue(pendingCreate.promise);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.click(screen.getByRole("button", { name: "Note" }));
  await screen.findByText(/Click the canvas to place a note/);
  expect(
    screen.getByRole("region", { name: "References canvas" }),
  ).toHaveFocus();
  expect(write).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  const body = await screen.findByRole("textbox", { name: "Note text" });
  await user.type(body, "Retained local note");
  vi.spyOn(api, "referenceCanvas").mockRejectedValueOnce(
    new Error("Fictional long read diagnostic. ".repeat(40)),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["references"] });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Fictional long read diagnostic",
  );
  expect(notice).toContainElement(screen.getByRole("alert"));
  expect(body).toHaveFocus();
  expect(body).toHaveValue("Retained local note");
  expect(screen.getByRole("toolbar", { name: "Canvas tools" })).toBe(toolbar);
  expect(screen.getByRole("group", { name: "Filter references" })).toBe(
    filters,
  );
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(notice).toBeEmptyDOMElement();
  expect(screen.getByRole("textbox", { name: "Note text" })).toBe(body);
  expect(body).toHaveValue("Retained local note");
  // Leaving the paper deliberately flushes its autosave. The failed read and
  // retry must not replace the editor or duplicate that pending first create.
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  expect(write.mock.calls[0][0]).toMatchObject({
    kind: "note",
    text: "Retained local note",
  });
  expect(write.mock.calls[0][0].title).toBeUndefined();
  expect(write.mock.calls[0][1]).toBe(true);
});
