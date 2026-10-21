import { expect, test } from "@playwright/test";

test("asset stages align and team workload stays at the bottom", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.evaluate(async () => {
    const mock = window.__jamMock;
    const original = mock.assetPreview.bind(mock);
    const pixel = await mock.createAsset({
      kind: "sprite",
      name: "Pixel preview",
      location: "C:/demo/pixel.png",
      notes: null,
    });
    mock.assetPreview = async (id) =>
      id === pixel.id
        ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII="
        : original(id);
  });
  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await expect(page.locator(".asset-card")).toHaveCount(9);
  const preview = page.locator(".asset-preview");
  await expect(preview).toHaveCSS("image-rendering", "pixelated");
  const previewBox = await preview.boundingBox();
  expect(previewBox?.width).toBeGreaterThan(230);
  const geometry = await page.locator(".asset-card").evaluateAll((cards) =>
    cards.map((card) => {
      const stage = card.querySelector(".asset-card-top");
      const path = card.querySelector(".asset-location");
      return {
        height: card.getBoundingClientRect().height,
        stageHeight: stage?.getBoundingClientRect().height,
        pathAlign: path ? getComputedStyle(path).textAlign : null,
      };
    }),
  );
  expect(new Set(geometry.map((g) => g.height)).size).toBe(1);
  expect(
    geometry.every((g) => g.stageHeight === 112 && g.pathAlign === "left"),
  ).toBe(true);
  await page.getByRole("link", { name: "Team", exact: true }).click();
  const cards = page.locator(".team-section").first().locator(".member-card");
  await expect(cards).toHaveCount(3);
  const bottoms = await cards.evaluateAll((cards) =>
    cards.map((card) => ({
      bottom: card.getBoundingClientRect().bottom,
      workloadBottom: card.querySelector(".workload")?.getBoundingClientRect()
        .bottom,
    })),
  );
  expect(new Set(bottoms.map((g) => g.bottom)).size).toBe(1);
  expect(
    bottoms.every(
      (g) => Math.abs(g.bottom - (g.workloadBottom ?? 0) - 19.5) < 2,
    ),
  ).toBe(true);
});
