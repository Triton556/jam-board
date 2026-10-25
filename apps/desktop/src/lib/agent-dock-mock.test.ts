import { expect, it, vi } from "vitest";
import {
  mockDockApi,
  resetMockDock,
  setMockCatalogError,
} from "./agent-dock-mock";
import { mockApi } from "./mock-bridge";

it("custom mock profiles keep unique nonempty IDs across creation, edits and UUID collisions", async () => {
  const uuid = vi
    .spyOn(crypto, "randomUUID")
    .mockReturnValue("00000000-0000-4000-8000-000000000042");
  const created: string[] = [];
  try {
    for (const id of [undefined, "", undefined]) {
      const saved = await mockDockApi.saveProfile({
        id,
        label: "Custom regression",
        kind: "acp",
        command: "custom",
      });
      expect(saved.id).toBeTruthy();
      created.push(saved.id);
    }
    expect(new Set(created).size).toBe(3);
    const updated = await mockDockApi.saveProfile({
      id: created[0],
      label: "Renamed regression",
      kind: "acp",
    });
    expect(updated.id).toBe(created[0]);
    const profiles = await mockDockApi.profiles();
    expect(profiles.filter((p) => p.id === created[0])).toHaveLength(1);
    expect(new Set(profiles.map((p) => p.id)).size).toBe(profiles.length);
  } finally {
    uuid.mockRestore();
    for (const id of created) await mockDockApi.deleteProfile(id);
  }
});
it("BC12 mock catalog includes vision/reasoning/tools and a recoverable cached error", async () => {
  vi.stubEnv("VITE_MOCK_BRIDGE", "1");
  try {
    setMockCatalogError("Provider unavailable — using cached models.");
    const catalog = await mockDockApi.modelCatalog({
      profileId: "api-openrouter",
      refresh: true,
    });
    expect(catalog.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inputImage: true,
          reasoning: true,
          tools: true,
        }),
        expect.objectContaining({ inputImage: false, reasoning: false }),
        expect.objectContaining({ tools: false }),
      ]),
    );
    expect(catalog.error).toContain("using cached models");
    setMockCatalogError(null);
    expect(
      (
        await mockDockApi.modelCatalog({
          profileId: "api-openrouter",
          refresh: true,
        })
      ).error,
    ).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});
it("BC14 mock attachment thumbnails and copy refusals precede any turn and IDs stay session-bound", async () => {
  resetMockDock();
  await mockApi.resetDemo();
  const first = await mockDockApi.startSession({ profileId: "claude-code" });
  const second = await mockDockApi.startSession({ profileId: "claude-code" });
  const image = await mockDockApi.addAttachment({
    sessionId: first.id,
    source: { kind: "path", path: "C:/mood.png" },
  });
  expect(image).toMatchObject({
    isImage: true,
    name: "mood.png",
    previewUrl: expect.stringContaining("data:image/"),
  });
  expect(image.thumbnail?.length).toBeLessThan(64000);
  await expect(
    mockDockApi.addAttachment({
      sessionId: first.id,
      source: { kind: "path", path: "C:/refused-copy.txt" },
    }),
  ).rejects.toThrow("Could not copy");
  await expect(
    mockDockApi.sendPrompt({
      sessionId: second.id,
      content: [{ type: "attachment", attachmentId: image.id }],
    }),
  ).rejects.toThrow("another session");
  expect(
    (await mockDockApi.history(second.id)).some(
      (e) => e.kind === "user_message",
    ),
  ).toBe(false);
  resetMockDock();
});
