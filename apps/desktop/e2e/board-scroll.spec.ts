import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";

const evidence = resolve(
  process.cwd(),
  process.env.JAM_R12_EVIDENCE_DIR ?? "../../test-visuals/round12/R12-B",
);
const counts = {
  backlog: 192,
  ready: 40,
  in_progress: 10,
  review: 5,
  done: 30,
};
const cards = (page: Page, status = "backlog") =>
  page.locator(`[data-column="${status}"] .column-cards`);
const task = (page: Page, key: string) =>
  page.locator(`[data-board-task-key="${key}"]`);

async function screenshot(page: Page, name: string) {
  const selected = process.env.JAM_R12_B_SCREENSHOT;
  if (!selected || selected === name)
    await page.screenshot({ path: resolve(evidence, `${name}.png`) });
}

async function fixture(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);
  // Only the existing fictional mock inventory is mutated; no production bridge,
  // execution grant, provider or mock product fallback is involved.
  await page.evaluate((sizes) => {
    const mock = window.__jamMock;
    mock.setLatency(0);
    const inventory = mock.fileInventory();
    const template = structuredClone(
      inventory.tasks.find((t) => t.key === "JB-2"),
    );
    if (!template) throw new Error("Missing prepared mock task");
    inventory.tasks.splice(0);
    let seq = 1000;
    for (const [status, size] of Object.entries(sizes)) {
      for (let i = 0; i < size; i++) {
        const key = `JB-${++seq}`;
        inventory.tasks.push({
          ...structuredClone(template),
          id: crypto.randomUUID(),
          key,
          title: `${status} task ${i + 1}: polish the lantern village`,
          status: status as typeof template.status,
          position: (i + 1) * 1024,
          assigneeId: null,
          tags: ["gameplay", "polish"],
          activity: [],
          history: [],
          comments: [],
          commentCount: 0,
        });
      }
    }
    // Persist the fictional inventory through an existing public mock API so a
    // real navigation includes query loading and the complete board render.
    return mock.setTheme("light");
  }, counts);
  await page.goto("/board");
  await expect(page.locator(".card-button")).toHaveCount(277);
  await expect(task(page, "JB-1001")).toBeInViewport();
  await page.evaluate(() => document.fonts.ready);
}

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("Missing board geometry");
  return value;
}
async function pageFits(page: Page) {
  expect(
    await page.evaluate(() => {
      const root = document.scrollingElement;
      return (
        !!root &&
        root.scrollHeight === root.clientHeight &&
        root.scrollWidth === root.clientWidth
      );
    }),
  ).toBe(true);
}
async function bottom(page: Page, status = "backlog") {
  // Use native input through the estimated-height change and its following
  // frame. A single jump uses intrinsic heights for not-yet-rendered cards.
  const viewport = await box(cards(page, status));
  await page.mouse.move(viewport.x + 80, viewport.y + 100);
  for (let step = 0; step < 3; step++) {
    await page.mouse.wheel(0, 100000);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }
  await expect
    .poll(() =>
      cards(page, status).evaluate((node) =>
        Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop),
      ),
    )
    .toBeLessThanOrEqual(1);
}
async function startDrag(page: Page, key: string) {
  const source = await box(task(page, key));
  await page.mouse.move(source.x + 70, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 80, source.y + source.height / 2, {
    steps: 3,
  });
  await expect(page.locator(`.drag-overlay [data-key="${key}"]`)).toBeVisible();
}

async function pageScrollKey(page: Page, key: "PageDown" | "PageUp") {
  await cards(page).evaluate((node) => {
    (window as unknown as { r12ScrollEnd: Promise<number> }).r12ScrollEnd =
      new Promise((resolve) =>
        node.addEventListener("scrollend", () => resolve(node.scrollTop), {
          once: true,
        }),
      );
  });
  await page.keyboard.press(key);
  return page.evaluate(
    () => (window as unknown as { r12ScrollEnd: Promise<number> }).r12ScrollEnd,
  );
}

test.use({ viewport: { width: 1440, height: 900 } });

test("H-B01: independent column wheel bounds, pinned controls and QuickCreate recovery", async ({
  page,
}) => {
  await fixture(page);
  await pageFits(page);
  await expect(page.locator(".board-scroll")).toHaveCSS("overflow-y", "hidden");
  await expect(cards(page)).toHaveCSS("overscroll-behavior-x", "auto");
  await expect(cards(page)).toHaveCSS("overscroll-behavior-y", "contain");
  await expect(cards(page)).toHaveCSS("overflow-anchor", "auto");
  await expect(task(page, "JB-1001")).toHaveCSS("content-visibility", "auto");
  const backlogBox = await box(cards(page));
  await page.mouse.move(backlogBox.x + 100, backlogBox.y + 100);
  await page.mouse.wheel(0, 550);
  await expect
    .poll(() => cards(page).evaluate((node) => node.scrollTop))
    .toBeGreaterThan(100);
  await bottom(page);
  await expect(task(page, "JB-1192")).toBeInViewport();
  for (const status of Object.keys(counts)) {
    const column = await box(page.locator(`[data-column="${status}"]`));
    expect(column.y).toBeGreaterThan(0);
    expect(column.y + column.height).toBeLessThanOrEqual(900);
    await expect(
      page.locator(`[data-column="${status}"] .column-heading`),
    ).toBeInViewport();
  }
  const before = await page
    .locator(".column-cards")
    .evaluateAll((nodes) => nodes.map((n) => n.scrollTop));
  await page.mouse.wheel(0, 1200);
  // Two animation frames allow the native wheel event to be applied.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page
      .locator(".column-cards")
      .evaluateAll((nodes) => nodes.map((n) => n.scrollTop)),
  ).toEqual(before);
  expect(
    await page
      .locator(".board-scroll")
      .evaluate((node) => ({ x: node.scrollLeft, y: node.scrollTop })),
  ).toEqual({ x: 0, y: 0 });
  await pageFits(page);
  await cards(page).evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.getByRole("button", { name: "Add draft" }).click();
  await expect(page.locator(".quick-create")).toBeInViewport();
  const formBox = await box(page.locator(".quick-create"));
  const scrollerBox = await box(cards(page));
  // Native scroll offsets are integral; fractional flex geometry can differ by
  // less than one CSS pixel at the scroll boundary.
  expect(formBox.y).toBeGreaterThanOrEqual(scrollerBox.y - 1);
  expect(formBox.y + formBox.height).toBeLessThanOrEqual(
    scrollerBox.y + scrollerBox.height + 1,
  );
  await expect(
    page.getByRole("textbox", { name: "New task in Backlog" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".quick-create")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add draft" })).toBeFocused();
  await task(page, "JB-1001").focus();
  await expect(task(page, "JB-1001")).toBeInViewport({ ratio: 1 });
  // Wait for each native scrollend before starting the next focus operation.
  const afterPageDown = await pageScrollKey(page, "PageDown");
  expect(afterPageDown).toBeGreaterThan(0);
  expect(await pageScrollKey(page, "PageUp")).toBeLessThan(afterPageDown);
  await task(page, "JB-1192").focus();
  await expect(task(page, "JB-1192")).toBeInViewport({ ratio: 1 });
  await pageFits(page);
});

test("H-B01: five live inserts retain the visible card and do not remount columns", async ({
  page,
}) => {
  await fixture(page);
  await task(page, "JB-1090").focus();
  await cards(page).evaluate((node) => {
    node.scrollTop += 65;
  });
  const anchor = await cards(page).evaluate((node) => {
    const viewport = node.getBoundingClientRect();
    const first = [...node.querySelectorAll<HTMLElement>(".card-button")].find(
      (card) => {
        const rect = card.getBoundingClientRect();
        return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
      },
    );
    if (!first) throw new Error("No visible anchor");
    (window as unknown as { r12Columns: Element[] }).r12Columns = [
      ...document.querySelectorAll(".board-column, .column-cards"),
    ];
    return {
      key: first.dataset.boardTaskKey ?? "",
      y: first.getBoundingClientRect().y,
    };
  });
  const drift = await page.evaluate((anchor) => {
    const mock = window.__jamMock;
    const inventory = mock.fileInventory();
    const template = inventory.tasks[0];
    if (!template) throw new Error("Missing live-insert template");
    for (let i = 0; i < 5; i++)
      inventory.tasks.push({
        ...structuredClone(template),
        id: crypto.randomUUID(),
        key: `JB-live-${i}`,
        title: `Live inserted draft ${i + 1}`,
        position: -1024 * (5 - i),
      });
    mock.emit([]); // The existing mock BoardChanged subscription refetches tasks.
    return new Promise<number>((resolve) => {
      let framesAfterInsert = 0,
        maxDrift = 0;
      const sample = () => {
        const card = document.querySelector(
          `[data-board-task-key="${anchor.key}"]`,
        );
        if (!card) throw new Error("Visible anchor was removed");
        maxDrift = Math.max(
          maxDrift,
          Math.abs(card.getBoundingClientRect().y - anchor.y),
        );
        if (
          document.querySelectorAll('[data-column="backlog"] .card-button')
            .length === 197
        )
          framesAfterInsert++;
        if (framesAfterInsert >= 20) resolve(maxDrift);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  }, anchor);
  await writeFile(
    resolve(evidence, "live-anchor.json"),
    JSON.stringify({ maxDriftPx: drift }, null, 2),
  );
  expect(drift).toBeLessThanOrEqual(2);
  await expect(
    page.locator('[data-column="backlog"] .card-button'),
  ).toHaveCount(197);
  await expect
    .poll(async () =>
      Math.abs((await box(task(page, anchor.key))).y - anchor.y),
    )
    .toBeLessThanOrEqual(2);
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll(".board-column, .column-cards")].every(
        (node, i) =>
          node ===
          (window as unknown as { r12Columns: Element[] }).r12Columns[i],
      ),
    ),
  ).toBe(true);
});

test("H-B01: bottom Backlog card drops before the intended Ready neighbor with captured version", async ({
  page,
}) => {
  await fixture(page);
  await bottom(page);
  const version = (
    await page.evaluate(() => window.__jamMock.getTask("JB-1192"))
  ).updatedAt;
  await startDrag(page, "JB-1192");
  const target = await box(task(page, "JB-1194"));
  await page.mouse.move(target.x + 80, target.y + target.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
  await expect(
    page.locator('[data-column="ready"] [data-board-task-key="JB-1192"]'),
  ).toBeInViewport();
  const moves = await page.evaluate(() =>
    window.__jamMock.calls.filter((call) => call.command === "move_task"),
  );
  expect(moves).toHaveLength(1);
  expect(moves[0]?.input).toMatchObject({
    key: "JB-1192",
    status: "ready",
    expectedUpdatedAt: version,
    beforeKey: "JB-1194",
    afterKey: "JB-1193",
  });
  const order = await cards(page, "ready")
    .locator(".card-button")
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-board-task-key")),
    );
  expect(order.slice(0, 3)).toEqual(["JB-1193", "JB-1192", "JB-1194"]);
});

test("H-B01: navigation and ten wheel steps meet the mock performance budget", async ({
  page,
}) => {
  await fixture(page);
  await page.addInitScript(() => {
    const state = {
      interactiveMs: 0,
      longTasks: [] as number[],
      observe: false,
    };
    (window as unknown as { r12Perf: typeof state }).r12Perf = state;
    new PerformanceObserver((list) => {
      if (state.observe)
        state.longTasks.push(
          ...list.getEntries().map((entry) => entry.duration),
        );
    }).observe({ type: "longtask", buffered: false });
    const check = () => {
      const card = document.querySelector(".card-button");
      if (
        card &&
        document.querySelectorAll(".board-column").length === 5 &&
        card.getBoundingClientRect().height > 0
      )
        state.interactiveMs = performance.now();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  await page.goto("/board");
  await expect(task(page, "JB-1001")).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { r12Perf: { interactiveMs: number } }).r12Perf
            .interactiveMs,
      ),
    )
    .toBeGreaterThan(0);
  const viewport = await box(cards(page));
  await page.mouse.move(viewport.x + 100, viewport.y + 100);
  await page.evaluate(() => {
    (window as unknown as { r12Perf: { observe: boolean } }).r12Perf.observe =
      true;
  });
  for (let i = 0; i < 10; i++) {
    const stride = await cards(page).evaluate(
      (node, remaining) =>
        (node.scrollHeight - node.clientHeight - node.scrollTop) / remaining,
      10 - i,
    );
    const position = await cards(page).evaluate((node) => node.scrollTop);
    await page.mouse.wheel(0, i >= 8 ? 100000 : Math.ceil(stride));
    await expect
      .poll(() => cards(page).evaluate((node) => node.scrollTop))
      .toBeGreaterThanOrEqual(position);
  }
  await expect(task(page, "JB-1192")).toBeInViewport();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const measured = await page.evaluate(
    () =>
      (
        window as unknown as {
          r12Perf: { interactiveMs: number; longTasks: number[] };
        }
      ).r12Perf,
  );
  await mkdir(evidence, { recursive: true });
  await writeFile(
    resolve(evidence, "performance.json"),
    JSON.stringify(measured, null, 2),
  );
  console.log("R12-B performance", JSON.stringify(measured));
  expect(measured.interactiveMs).toBeLessThanOrEqual(2000);
  expect(measured.longTasks.filter((duration) => duration > 50)).toEqual([]);
});

test("H-B01: native Shift+wheel over a card scrolls the row horizontally", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await fixture(page);
  const viewport = await box(cards(page));
  await page.mouse.move(viewport.x + 80, viewport.y + 80);
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 350);
  await page.keyboard.up("Shift");
  await expect
    .poll(() =>
      page.locator(".board-scroll").evaluate((node) => node.scrollLeft),
    )
    .toBeGreaterThan(0);
});

for (const variant of [
  { width: 1440, height: 900, theme: "light" },
  { width: 1440, height: 900, theme: "dark" },
  { width: 1000, height: 900, theme: "light" },
  { width: 375, height: 812, theme: "light" },
] as const) {
  test(`H-B01: scroll, drag auto-scroll and layout ${variant.width} ${variant.theme}`, async ({
    page,
  }) => {
    await page.setViewportSize(variant);
    await fixture(page);
    await page.evaluate(
      (theme) => document.documentElement.setAttribute("data-theme", theme),
      variant.theme,
    );
    const suffix = `${variant.width}-${variant.theme}`;
    await mkdir(evidence, { recursive: true });
    await screenshot(page, `board-long-top-${suffix}`);
    await pageFits(page);
    await bottom(page);
    await expect(task(page, "JB-1192")).toBeInViewport();
    await screenshot(page, `board-long-bottom-${suffix}`);
    await cards(page).evaluate((node) => {
      node.scrollTop = 0;
    });
    await startDrag(page, "JB-1001");
    const viewport = await box(cards(page));
    await page.mouse.move(viewport.x + 80, viewport.y + viewport.height - 7, {
      steps: 15,
    });
    await expect
      .poll(() => cards(page).evaluate((node) => node.scrollTop))
      .toBeGreaterThan(50);
    await screenshot(page, `board-drag-autoscroll-${suffix}`);
    // Reverse direction while still dragging, then cancel and confirm no write.
    await page.mouse.move(viewport.x + 80, viewport.y + 3, { steps: 12 });
    await expect
      .poll(() => cards(page).evaluate((node) => node.scrollTop))
      .toBe(0);
    if (variant.width < 1440) {
      const row = await box(page.locator(".board-scroll"));
      await page.mouse.move(row.x + row.width - 2, viewport.y + 120, {
        steps: 15,
      });
      await expect
        .poll(() =>
          page.locator(".board-scroll").evaluate((node) => node.scrollLeft),
        )
        .toBeGreaterThan(30);
      await page.mouse.move(row.x + 2, viewport.y + 120, { steps: 15 });
      await expect
        .poll(() =>
          page.locator(".board-scroll").evaluate((node) => node.scrollLeft),
        )
        .toBe(0);
    }
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(
      await page.evaluate(() =>
        window.__jamMock.calls.filter((call) => call.command === "move_task"),
      ),
    ).toEqual([]);
    const row = page.locator(".board-scroll");
    await row.focus();
    await page.keyboard.press("Home");
    await expect.poll(() => row.evaluate((node) => node.scrollLeft)).toBe(0);
    if (variant.width < 1440) {
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => row.evaluate((node) => node.scrollLeft))
        .toBeGreaterThan(0);
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("End");
      await expect(
        page.locator('[data-column="done"] .column-heading'),
      ).toBeInViewport();
      await page.getByRole("button", { name: "Scroll columns left" }).click();
      await page.keyboard.press("Home");
      const rowBox = await box(row);
      await page.mouse.move(rowBox.x + 20, rowBox.y + 35);
      await page.keyboard.down("Shift");
      await page.mouse.wheel(0, 350);
      await page.keyboard.up("Shift");
      await expect
        .poll(() => row.evaluate((node) => node.scrollLeft))
        .toBeGreaterThan(0);
    }
    await pageFits(page);
    expect(
      await page
        .locator(".board-column")
        .first()
        .evaluate((node) => node.getBoundingClientRect().width),
    ).toBeGreaterThanOrEqual(232);
  });
}
