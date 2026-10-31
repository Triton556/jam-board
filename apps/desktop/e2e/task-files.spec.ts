import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

const output = path.resolve("../../test-visuals/round11/R11-T");
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.evaluate(async () => {
    const source = "/src/lib/mock-task-files.ts";
    const { mockTaskFiles } = (await import(
      /* @vite-ignore */ source
    )) as typeof import("../src/lib/mock-task-files");
    mockTaskFiles.reset();
    mockTaskFiles.copyDelay = 600;
  });
  await page.goto("/board?task=JB-7");
});
async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function showFiles(page: Page) {
  const files = page.getByRole("region", { name: "Task files", exact: true });
  await files.getByRole("button", { name: "Add file", exact: true }).focus();
  await page.keyboard.press("Tab");
  await files.evaluate((element) => {
    const surface = element.closest<HTMLElement>(".drawer");
    if (!surface) throw new Error("Missing task scroll surface");
    const heading = surface
      .querySelector(".drawer-heading")
      ?.getBoundingClientRect();
    const top = heading?.bottom ?? surface.getBoundingClientRect().top;
    surface.scrollTop += element.getBoundingClientRect().top - top - 12;
  });
  const bounds = await files.evaluate((element) => {
    const surface = element.closest(".drawer");
    const heading = surface
      ?.querySelector(".drawer-heading")
      ?.getBoundingClientRect();
    const footer = surface
      ?.querySelector(".task-savebar")
      ?.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      headerBottom: heading?.bottom ?? 0,
      footerTop: footer?.top ?? innerHeight,
    };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.headerBottom);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.footerTop);
  return files;
}
async function addFile(
  page: Page,
  storage: "Copy into board…" | "Link existing file…" | "Add URL…",
  source: string,
  role: string,
) {
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  await page.getByRole("button", { name: storage, exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: storage.replace("…", ""),
    exact: true,
  });
  await choose(page, "File role", role);
  if (storage === "Add URL…")
    await dialog.getByRole("textbox", { name: "File URL" }).fill(source);
  else {
    await page.evaluate((value) => {
      window.__jamMock.pickFiles = async () => [value];
    }, source);
    await dialog.getByRole("button", { name: "Choose files…" }).click();
    await expect(dialog.getByText(source, { exact: true })).toBeVisible();
  }
  await dialog.getByRole("button", { name: "Add files", exact: true }).click();
  return dialog;
}
test("FI-T browser: copied image, linked model, URL, roles, modal, unlink retains bytes and reload", async ({
  page,
}) => {
  for (const entry of [
    ["Copy into board…", "C:/source/Игрок.png", "To edit"],
    ["Link existing file…", "C:/mock/repo/Assets/Ship.glb", "Reference"],
    ["Add URL…", "https://example.com/brief", "Result"],
  ] as const) {
    const dialog = await addFile(page, entry[0], entry[1], entry[2]);
    await expect(dialog).toHaveCount(0);
  }
  const image = page.getByRole("article", { name: "Игрок.png", exact: true });
  const model = page.getByRole("article", { name: "Ship.glb", exact: true });
  await expect(
    model.getByText("Assets/Ship.glb", { exact: true }),
  ).toBeVisible();
  await choose(page, "Role for Игрок.png", "Result");
  await image.getByRole("button", { name: "Apply role", exact: true }).click();
  await expect(image.getByRole("combobox")).toHaveText("Result");
  await page.getByRole("button", { name: "Open larger", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "JB-7", exact: true }),
  ).toHaveAttribute("data-presentation", "modal");
  await image
    .getByRole("button", { name: "More actions for Игрок.png", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Unlink…", exact: true }).click();
  const confirm = page.getByRole("dialog", {
    name: "Unlink file?",
    exact: true,
  });
  await expect(
    confirm.getByText(/Unlinking never deletes file bytes/),
  ).toBeVisible();
  await confirm
    .getByRole("button", { name: "Unlink file", exact: true })
    .click();
  await expect(image).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const source = "/src/lib/mock-task-files.ts";
      const { mockTaskFiles } = (await import(
        /* @vite-ignore */ source
      )) as typeof import("../src/lib/mock-task-files");
      return mockTaskFiles.bytes.has("files/images/Игрок.png");
    }),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("article", { name: "Ship.glb", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Игрок.png", exact: true }),
  ).toHaveCount(0);
});
for (const variant of [
  { name: "1440-light", width: 1440, theme: "light" },
  { name: "1440-dark", width: 1440, theme: "dark" },
  { name: "1000-light", width: 1000, theme: "light" },
  { name: "375-light", width: 375, theme: "light" },
] as const) {
  test(`FI-T visual matrix ${variant.name}`, async ({ page }) => {
    await mkdir(output, { recursive: true });
    await page.setViewportSize({ width: variant.width, height: 1200 });
    await page.evaluate(
      (theme) => window.__jamMock.setTheme(theme),
      variant.theme,
    );
    await page.reload();
    for (const entry of [
      [
        "Copy into board…",
        "C:/source/Изображение с длинным кириллическим именем.png",
        "To edit",
      ],
      [
        "Link existing file…",
        "C:/mock/repo/Assets/missing-Ship.glb",
        "Reference",
      ],
      [
        "Link existing file…",
        "C:/mock/repo/Docs/unreadable-guide.pdf",
        "Reference",
      ],
      ["Add URL…", "https://example.com/results", "Result"],
    ] as const)
      await expect(
        await addFile(page, entry[0], entry[1], entry[2]),
      ).toHaveCount(0);
    const files = await showFiles(page);
    const controls = await files
      .locator(".task-file-actions")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rects = Array.from(element.children).map((child) =>
            child.getBoundingClientRect(),
          );
          return (
            Math.max(...rects.map((rect) => rect.top)) -
            Math.min(...rects.map((rect) => rect.top))
          );
        }),
      );
    expect(controls.every((delta) => delta < 3)).toBe(true);
    const contrast = await files
      .locator(
        '.file-availability[data-status="missing"], .file-availability[data-status="unreadable"]',
      )
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rgb = (value: string) =>
            (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
          const luminance = (color: number[]) =>
            color.reduce((sum, value, index) => {
              const c = value / 255;
              return (
                sum +
                (index === 0 ? 0.2126 : index === 1 ? 0.7152 : 0.0722) *
                  (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
              );
            }, 0);
          let parent: Element | null = element;
          while (
            parent &&
            ["transparent", "rgba(0, 0, 0, 0)"].includes(
              getComputedStyle(parent).backgroundColor,
            )
          )
            parent = parent.parentElement;
          const foreground = getComputedStyle(element).color,
            background = getComputedStyle(
              parent ?? document.body,
            ).backgroundColor;
          const a = luminance(rgb(foreground)),
            b = luminance(rgb(background));
          return {
            status: element.getAttribute("data-status"),
            foreground,
            background,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        }),
      );
    expect(contrast).toHaveLength(2);
    expect(contrast.every((result) => result.ratio >= 4.5)).toBe(true);
    await writeFile(
      path.join(output, `${variant.name}-contrast.json`),
      JSON.stringify(contrast, null, 2),
    );
    await files.screenshot({
      path: path.join(output, `${variant.name}-drawer-files.png`),
    });
    await page
      .getByRole("button", { name: "Open larger", exact: true })
      .click();
    await showFiles(page);
    await files.screenshot({
      path: path.join(output, `${variant.name}-modal-files.png`),
    });
    await files.getByRole("button", { name: "Add file", exact: true }).click();
    await page.keyboard.press("Tab");
    await files.locator(".task-files-menu").screenshot({
      path: path.join(output, `${variant.name}-add-menu.png`),
    });
    await page
      .getByRole("button", { name: "Copy into board…", exact: true })
      .click();
    const copy = page.getByRole("dialog", {
      name: "Copy into board",
      exact: true,
    });
    await page.evaluate(async () => {
      const source = "/src/lib/mock-task-files.ts";
      const { mockTaskFiles } = (await import(
        /* @vite-ignore */ source
      )) as typeof import("../src/lib/mock-task-files");
      mockTaskFiles.copyDelay = 5000;
      window.__jamMock.pickFiles = async () => ["C:/source/Copy-progress.png"];
    });
    await copy.getByRole("button", { name: "Choose files…" }).click();
    await copy.getByRole("button", { name: "Add files", exact: true }).click();
    await expect(
      copy.getByRole("progressbar", { name: "Copy progress" }),
    ).toBeVisible();
    await expect(
      copy.getByRole("button", { name: "Cancel copy" }),
    ).toBeEnabled();
    await copy.getByRole("button", { name: "Cancel copy" }).focus();
    await page.keyboard.press("Tab");
    await copy.screenshot({
      path: path.join(output, `${variant.name}-copy-progress.png`),
    });
    await copy.getByRole("button", { name: "Cancel copy" }).click();
    await expect(copy.getByText(/Copy cancelled/)).toBeVisible();
    await copy.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Close task", exact: true }).click();
    await page.goto("/assets");
    await choose(page, "Storage", "Linked");
    await choose(page, "Used by tasks", "Reference");
    await page.getByRole("button", { name: /^model /i }).click();
    await page.getByText("File usage and roles", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "JB-7 · Reference", exact: true }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "Storage" }).focus();
    await page.keyboard.press("Tab");
    await page.screenshot({
      path: path.join(output, `${variant.name}-assets-filters.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
