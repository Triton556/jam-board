import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { mockApi } from "../lib/mock-bridge";
import { AssetDialog, AssetsPage } from "./assets/AssetsPage";
import { assetKind } from "./assets/model";
import { welcomeSchema } from "./onboarding/Welcome";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useBlocker: () => ({}),
}));
async function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["app"], await mockApi.appState());
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}
beforeEach(async () => {
  await mockApi.resetDemo();
});
afterEach(() => vi.restoreAllMocks());

it.each([
  "config.json",
  "C:\\config\\CONFIG.JSON",
  "https://example.invalid/settings.json?download=1#file",
])("generic JSON %s retains Other instead of Document or Level", (location) => {
  expect(assetKind(location)).toBe("other");
});
it.each(["map.tmx", "WORLD.LDTK?download=1"])(
  "known map format %s retains the existing level kind",
  (location) => {
    expect(assetKind(location)).toBe("level");
  },
);
it("new generic assets start as other, and a JSON file suggestion stays other", async () => {
  const user = userEvent.setup(),
    pick = vi
      .spyOn(api, "pickFile")
      .mockResolvedValue("/fictional/config.json"),
    close = vi.fn(),
    save = vi.spyOn(api, "createAsset");
  await mount(<AssetDialog close={close} />);
  expect(screen.getByRole("combobox", { name: "Kind" })).toHaveTextContent(
    "other",
  );
  await user.click(screen.getByRole("button", { name: "Choose file" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Name")).toHaveValue("config"),
  );
  expect(screen.getByRole("combobox", { name: "Kind" })).toHaveTextContent(
    "other",
  );
  await user.click(screen.getByRole("button", { name: "Save asset" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith({
      name: "config",
      location: "/fictional/config.json",
      kind: "other",
      notes: null,
    }),
  );
  expect(pick).toHaveBeenCalledOnce();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});
it("automatic suggestions can follow a second file until a kind is explicitly chosen", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "pickFile")
    .mockResolvedValueOnce("/fictional/icon.png")
    .mockResolvedValueOnce("/fictional/config.json");
  await mount(<AssetDialog close={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Choose file" }));
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Kind" })).toHaveTextContent(
      "sprite",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Choose file" }));
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Kind" })).toHaveTextContent(
      "other",
    ),
  );
});
it.each(["audio", "other"])(
  "explicit kind %s is not replaced by a later image-file suggestion",
  async (kind) => {
    const user = userEvent.setup();
    vi.spyOn(api, "pickFile").mockResolvedValue("/fictional/icon.png");
    const save = vi.spyOn(api, "createAsset");
    await mount(<AssetDialog close={vi.fn()} />);
    await user.click(screen.getByRole("combobox", { name: "Kind" }));
    await user.click(screen.getByRole("option", { name: kind }));
    await user.click(screen.getByRole("button", { name: "Choose file" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toHaveValue("icon"),
    );
    expect(screen.getByRole("combobox", { name: "Kind" })).toHaveTextContent(
      kind,
    );
    await user.click(screen.getByRole("button", { name: "Save asset" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith({
        name: "icon",
        location: "/fictional/icon.png",
        kind,
        notes: null,
      }),
    );
  },
);
it("editing a persisted JSON level preserves its explicit classification", async () => {
  const user = userEvent.setup(),
    asset = await mockApi.createAsset({
      name: "Existing game map",
      location: "/fictional/map.json",
      kind: "level",
      notes: "Previously classified by a human",
    });
  const save = vi.spyOn(api, "updateAsset");
  await mount(<AssetDialog asset={asset} close={vi.fn()} />);
  expect(screen.getByRole("combobox", { name: "Kind" })).toHaveTextContent(
    "level",
  );
  expect(
    screen.queryByRole("button", { name: "Choose file" }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Name"), " renamed");
  await user.click(screen.getByRole("button", { name: "Save asset" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith({
      id: asset.id,
      name: "Existing game map renamed",
      kind: "level",
      notes: asset.notes,
    }),
  );
});
it("the empty Assets page describes a general project, without creating or reclassifying anything", async () => {
  await api.createJam({
    name: "Empty project",
    template: "custom",
    theme: null,
    startsAt: "2026-10-30T00:00:00Z",
    endsAt: "2026-11-30T00:00:00Z",
    timezone: "UTC",
    yourName: "Fixture",
  });
  const create = vi.spyOn(api, "createAsset"),
    edit = vi.spyOn(api, "updateAsset");
  await mount(<AssetsPage openTask={vi.fn()} />);
  expect(
    await screen.findByText(
      "No assets yet — add a file or URL for your project",
    ),
  ).toBeVisible();
  expect(
    screen.getByText("files and references your project uses"),
  ).toBeVisible();
  expect(create).not.toHaveBeenCalled();
  expect(edit).not.toHaveBeenCalled();
});
it.each(["custom", "game_jam"])(
  "%s blank-name validation uses project wording without relaxing validation",
  (template) => {
    const result = welcomeSchema.safeParse({
      name: " ",
      theme: "",
      startsAt: "2026-10-20T00:00",
      endsAt: "2026-10-22T00:00",
      timezone: "UTC",
      yourName: "QA",
      template,
    });
    expect(result.success).toBe(false);
    if (result.success) throw Error("Expected validation failure");
    expect(
      result.error.issues.find((issue) => issue.path[0] === "name")?.message,
    ).toBe("Give your project a name");
  },
);
