import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const evidence = resolve(
  process.cwd(),
  process.env.JAM_R12_EVIDENCE_DIR ?? "../../test-visuals/round12/R12-M/fix1",
);
async function checkFrameMenu(page: Page, title: string) {
  const frame = page.locator(".reference-frame").filter({
    has: page.locator(".reference-frame-title", { hasText: title }),
  });
  await expect(
    frame.locator(".reference-frame-actions [aria-haspopup='menu']"),
  ).toHaveCount(1);
  const menu = frame.getByRole("button", {
    name: `Frame actions for ${title}`,
    exact: true,
  });
  await menu.click();
  for (const name of [
    "Review items",
    "Send review to brain",
    "Collect Keep into new frame…",
    `Edit frame ${title}`,
  ])
    await expect(
      page.getByRole("menuitem", { name, exact: true }),
    ).toBeVisible();
  await page.keyboard.press("Escape");
}
async function seed(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  await expect(page.getByTestId("task-card").first()).toBeVisible();
  const fixture = await page.evaluate(async () => {
    const mock = window.__jamMock!;
    mock.setLatency(0);
    // This scenario owns exactly six active frames; retain the demo's Inbox
    // frame as archived history before creating the dedicated review fixture.
    for (const frame of (await mock.referenceCanvas()).frames) {
      await mock.canvasArchive({ kind: "frame", id: frame.id, archived: true });
    }
    const frames: { id: string; title: string }[] = [];
    const items: { id: string; x: number | null; y: number | null }[] = [];
    for (let i = 0; i < 6; i++)
      frames.push(
        await mock.createRefFrame({
          title: i === 0 ? "Moodboard — Sky" : `Moodboard — Section ${i + 1}`,
          x: i * 1000,
          y: 0,
          w: 880,
          h: 600,
        }),
      );
    for (let i = 0; i < 47; i++) {
      const frame = i < 22 ? frames[0]! : frames[1 + Math.floor((i - 22) / 5)]!;
      items.push(
        await mock.addReference({
          kind: "asset",
          title: `Sky study ${String(i + 1).padStart(2, "0")}`,
          filePath: `C:/mock/sky-${i}.png`,
          frameId: frame.id,
          sourceUrl: `https://example.test/sky/${i}`,
          origin: i === 1 ? "generated" : "found",
          derivedFrom: i === 1 ? items[0]!.id : null,
        }),
      );
    }
    return { frames, items };
  });
  await page.goto(`/references?frame=${fixture.frames[0]!.id}`);
  await expect(
    page.getByRole("button", { name: "Review Moodboard — Sky", exact: true }),
  ).toBeVisible();
  return fixture;
}
test("47 images in six frames: 20 keyboard ratings and three reasons need no pointer action, Send preserves exact feedback", async ({
  page,
}) => {
  const fixture = await seed(page);
  await page
    .getByRole("button", { name: "Review Moodboard — Sky", exact: true })
    .click();
  await expect(page.getByLabel("Moodboard review")).toBeVisible();
  await page.evaluate(() => {
    document.body.dataset.reviewPointers = "0";
    document.addEventListener("pointerdown", () => {
      document.body.dataset.reviewPointers = String(
        Number(document.body.dataset.reviewPointers) + 1,
      );
    });
  });
  const initial = fixture.items.slice(0, 22).map((i) => [i.id, i.x, i.y]);
  const ratingStarted = Date.now();
  for (let i = 0; i < 20; i++) {
    if (i < 3) {
      await page.keyboard.press("c");
      await expect(
        page.getByPlaceholder("Why keep or reject this?"),
      ).toBeFocused();
      await page.keyboard.insertText(`Reason ${i + 1}: keep the light`);
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("dialog", { name: "Reference reason" }),
      ).toHaveCount(0);
    }
    await page.keyboard.press(i % 2 === 0 ? "1" : "2");
    await expect(page.getByLabel("Moodboard review")).toContainText(
      `${i + 1} of 22 rated`,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__jamMock!.calls.filter(
              (c) => c.command === "set_reference_verdict",
            ).length,
        ),
      )
      .toBeGreaterThanOrEqual(i + 1);
    await expect(page.locator('[data-review-current="true"]')).toHaveCount(1);
  }
  expect(await page.evaluate(() => document.body.dataset.reviewPointers)).toBe(
    "0",
  );
  await mkdir(evidence, { recursive: true });
  await writeFile(
    resolve(evidence, "keyboard-rating.json"),
    JSON.stringify(
      {
        rated: 20,
        reasons: 3,
        totalItems: 47,
        frames: 6,
        pointerActions: 0,
        durationMs: Date.now() - ratingStarted,
      },
      null,
      2,
    ) + "\n",
  );
  await page
    .getByRole("button", { name: "Done, send to brain", exact: true })
    .click();
  await expect(page.getByLabel("Moodboard review")).toHaveCount(0);
  const canvas = await page.evaluate(() => window.__jamMock!.referenceCanvas());
  expect(canvas.items.filter((i) => i.verdict)).toHaveLength(20);
  expect(canvas.items.filter((i) => i.verdictNote)).toHaveLength(3);
  expect(
    canvas.items
      .filter((i) => fixture.items.slice(0, 22).some((f) => f.id === i.id))
      .map((i) => [i.id, i.x, i.y]),
  ).toEqual(initial);
  const frame = canvas.frames.find((f) => f.id === fixture.frames[0]!.id)!;
  expect(frame.review).toMatchObject({
    total: 22,
    keep: 10,
    reject: 10,
    comments: 3,
    changedSinceSent: false,
  });
  expect(frame.review?.sentAt).toBeTruthy();
  expect(canvas.items.filter((i) => i.verdictNote).map((i) => i.id)).toEqual(
    fixture.items.slice(0, 3).map((i) => i.id),
  );
});
for (const variant of [
  { name: "1440-light", width: 1440, dark: false },
  { name: "1440-dark", width: 1440, dark: true },
  { name: "1000-light", width: 1000, dark: false },
  { name: "375-light", width: 375, dark: false },
]) {
  test(`moodboard open states ${variant.name}`, async ({ page }) => {
    await page.setViewportSize({ width: variant.width, height: 900 });
    const fixture = await seed(page);
    if (variant.dark)
      await page.evaluate(async () => {
        await window.__jamMock!.setTheme("dark");
        document.documentElement.dataset.theme = "dark";
      });
    await mkdir(evidence, { recursive: true });
    await checkFrameMenu(page, "Moodboard — Sky");
    await page
      .getByRole("button", { name: "Review Moodboard — Sky", exact: true })
      .click();
    await expect(page.getByLabel("Moodboard review")).toBeVisible();
    const hint = page.locator(".moodboard-review-hint");
    if (variant.width < 1000) await expect(hint).toBeHidden();
    else {
      await expect(hint).toBeVisible();
      expect(
        await hint.evaluate((element) => getComputedStyle(element).fontSize),
      ).toBe(
        await page
          .getByLabel("Moodboard review")
          .evaluate((element) => getComputedStyle(element).fontSize),
      );
    }
    const filterHeight = (await page
      .getByRole("button", { name: "Keep 0", exact: true })
      .boundingBox())!.height;
    for (const name of ["Previous item", "Next item"]) {
      const bounds = (await page
        .getByRole("button", { name, exact: true })
        .boundingBox())!;
      expect(bounds.height).toBeGreaterThanOrEqual(filterHeight);
      expect(bounds.height).toBeGreaterThanOrEqual(28);
      expect(bounds.width).toBeGreaterThanOrEqual(28);
    }
    expect(
      await page
        .locator(".moodboard-review-bar fieldset")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: resolve(evidence, `review-mode-${variant.name}.png`),
    });
    await page.keyboard.press("c");
    await page.keyboard.insertText(
      "Keep the soft light and simple silhouette. This direction feels calm.",
    );
    await expect(
      page.getByRole("dialog", { name: "Reference reason" }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Reference reason" }),
    ).toHaveCount(0);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("1");
      await expect(page.getByLabel("Moodboard review")).toContainText(
        `${i + 1} of 22 rated`,
      );
    }
    await page
      .getByRole("button", { name: "Done, send to brain", exact: true })
      .click();
    await expect(page.getByLabel("Moodboard review")).toHaveCount(0);
    await expect(
      page.getByText(
        "Review sent. The brain will see 3 rated items and 1 reason.",
        { exact: true },
      ),
    ).toBeVisible();
    await checkFrameMenu(page, "Moodboard — Sky");
    await page.screenshot({
      path: resolve(evidence, `frame-sent-${variant.name}.png`),
    });
    const collection = await page.evaluate(async ({ frames, items }) => {
      const moduleUrl = "/src/lib/mock-moodboard.ts";
      const module = (await import(
        /* @vite-ignore */ moduleUrl
      )) as typeof import("../src/lib/mock-moodboard");
      await module.mockMoodboardApi.feedback({
        itemId: items[22]!.id,
        verdict: "keep",
      });
      const result = await module.mockMoodboardApi.collect({
        requestId: "visual-collect",
        sourceFrameIds: [frames[0]!.id, frames[1]!.id],
        title: "Moodboard — kept",
        linkTo: null,
      });
      await module.mockMoodboardApi.update(result.itemIds[1]!, {
        derivedFrom: result.itemIds[0],
        origin: "generated",
      });
      return { frame: { id: result.frame.id } };
    }, fixture);
    await page.goto(`/references?frame=${collection.frame.id}`);
    if (variant.dark)
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
    await expect(
      page.getByText("Moodboard — kept", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator(".moodboard-derived-edge")).toBeAttached();
    await checkFrameMenu(page, "Moodboard — kept");
    await page.screenshot({
      path: resolve(evidence, `collected-frame-${variant.name}.png`),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
