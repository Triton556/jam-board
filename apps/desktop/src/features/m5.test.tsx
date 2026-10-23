import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { WorkloadBar } from "../components/ui/m5";
import { makeSnippets } from "../lib/mcp-config";
import { mockApi } from "../lib/mock-bridge";
import { canRustle } from "../lib/sound";
import { activityHour, mergeEvents, pendingEvents } from "./activity/model";
import { AssetDialog } from "./assets/AssetsPage";
import { assetKind, assetSchema } from "./assets/model";
import { archiveConfirmed } from "./settings/SettingsPage";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  await mockApi.resetDemo();
  mockApi.calls.length = 0;
});
it("infers every asset kind including query strings and Windows paths", () => {
  expect(assetKind("C:\\art\\PLAYER.PNG")).toBe("sprite");
  expect(assetKind("https://local.invalid/snow.ogg?v=1")).toBe("audio");
  expect(assetKind("font.woff2")).toBe("font");
  expect(assetKind("world.ldtk")).toBe("level");
  expect(assetKind("README.md")).toBe("other");
});
it("validates file and URL modes without accepting script URLs", () => {
  const values = {
    mode: "URL",
    name: "Player",
    kind: "sprite",
    location: "javascript:alert(1)",
    notes: "",
  };
  expect(assetSchema.safeParse(values).success).toBe(false);
  expect(
    assetSchema.safeParse({
      ...values,
      location: "https://example.invalid/player.png",
    }).success,
  ).toBe(true);
  expect(
    assetSchema.safeParse({
      ...values,
      mode: "File",
      location: "C:\\art\\player.png",
    }).success,
  ).toBe(true);
  expect(assetSchema.safeParse({ ...values, name: "" }).success).toBe(false);
});
it("asset dialog switches modes and only creates a validated asset", async () => {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AssetDialog close={() => {}} />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText("Asset location")).toBeDisabled();
  await user.click(screen.getByRole("tab", { name: "URL" }));
  await user.click(screen.getByRole("button", { name: "Save asset" }));
  expect(await screen.findByText("Give the asset a name")).toBeVisible();
  await user.type(screen.getByLabelText("Name"), "Test sprite");
  await user.type(
    screen.getByLabelText("Asset location"),
    "https://example.invalid/player.png",
  );
  await user.click(screen.getByRole("button", { name: "Save asset" }));
  await waitFor(() =>
    expect(mockApi.calls.some((c) => c.command === "create_asset")).toBe(true),
  );
});
it("workload bar uses proportional widths and handles no tasks", () => {
  const { container, rerender } = render(
    <WorkloadBar counts={{ ready: 3, done: 1 }} />,
  );
  expect(screen.getByRole("img", { name: "4 tasks" })).toBeVisible();
  expect(container.querySelector('[title="Ready: 3"]')).toHaveStyle({
    width: "75%",
  });
  rerender(<WorkloadBar counts={{}} />);
  expect(screen.getByText("no tasks yet")).toBeVisible();
  expect(container.querySelector(".workload-bar")).toHaveClass("empty");
});
it("groups local hours and retains pending events without duplicates", async () => {
  const now = new Date(2026, 9, 21, 14, 30).getTime();
  expect(activityHour(new Date(2026, 9, 21, 14).toISOString(), now)).toBe(
    "Today · 14:00",
  );
  expect(activityHour(new Date(2026, 9, 20, 22).toISOString(), now)).toBe(
    "Yesterday · 22:00",
  );
  const events = await mockApi.listActivity({ limit: 20 });
  expect(mergeEvents(events, events)).toHaveLength(20);
  expect(
    pendingEvents(events, 0, "agent").every((e) => e.actor.kind === "agent"),
  ).toBe(true);
  expect(
    pendingEvents(events, Math.max(...events.map((e) => e.seq)), ""),
  ).toHaveLength(0);
});
it("display masks token while explicitly requested snippets contain it", async () => {
  const status = await mockApi.mcpStatus();
  const display = makeSnippets(status, `••••${status.tokenTail}`);
  const token = await mockApi.revealMcpToken();
  expect(display.claudeHttp).not.toContain(token);
  expect(display.codexHttp).not.toContain(token);
  const copy = await mockApi.mcpConfigSnippets();
  expect(copy.claudeHttp).toContain(token);
  expect(copy.codexHttp).toContain(token);
  expect(JSON.parse(copy.codexStdio.split("\n")[1]?.slice(10) ?? "null")).toBe(
    status.sidecarPath,
  );
});
it("archive requires the exact case-sensitive jam name", () => {
  expect(archiveConfirmed("Cozy Jam 48", "Cozy Jam 48")).toBe(true);
  expect(archiveConfirmed("Cozy Jam 48", "cozy jam 48")).toBe(false);
  expect(archiveConfirmed("Cozy Jam 48", "Cozy Jam 48 ")).toBe(false);
  expect(archiveConfirmed("", "")).toBe(false);
});
it("paper sound is limited to one event per 400ms", () => {
  expect(canRustle(1399, 1000)).toBe(false);
  expect(canRustle(1400, 1000)).toBe(true);
  expect(canRustle(1000, -Infinity)).toBe(true);
});
it("mock import maps handles, preserves teammates and rewrites linked IDs", async () => {
  await mockApi.addComment({
    key: "JB-2",
    bodyMd: "Keep the sprite outline crisp.",
  });
  const old = await mockApi.getTask("JB-2");
  const exported = await mockApi.exportJamJson();
  const added = await mockApi.createMember({
    name: "New teammate",
    color: "#5B8DEF",
    avatar: null,
  });
  await mockApi.importJamJson(exported.path);
  const imported = await mockApi.getTask("JB2-2");
  expect(imported.id).not.toBe(old.id);
  expect(imported.assets[0]?.id).not.toBe(old.assets[0]?.id);
  expect(imported.comments.every((c) => c.taskId === imported.id)).toBe(true);
  expect((await mockApi.listMembers()).some((m) => m.id === added.id)).toBe(
    true,
  );
});
it("mock links and unlinks assets and rejects unknown preview IDs", async () => {
  const a = await mockApi.createAsset({
    kind: "sprite",
    name: "Local sprite",
    location: "C:\\art\\sprite.png",
    notes: null,
  });
  await mockApi.linkAsset({ assetId: a.id, taskKey: "JB-1" });
  expect(
    (await mockApi.getTask("JB-1")).assets.some((x) => x.id === a.id),
  ).toBe(true);
  expect(
    (await mockApi.listAssets()).find((x) => x.id === a.id)?.tasks[0]?.key,
  ).toBe("JB-1");
  await mockApi.unlinkAsset({ assetId: a.id, taskKey: "JB-1" });
  expect(
    (await mockApi.getTask("JB-1")).assets.some((x) => x.id === a.id),
  ).toBe(false);
  await expect(
    mockApi.assetPreview("C:\\unregistered.png"),
  ).rejects.toMatchObject({ code: "not_found" });
});
