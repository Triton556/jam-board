import { expect, test } from "@playwright/test";

test("Plan journal includes a labeled project interview before epic creation", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__jamMock);
  const result = await page.evaluate(async () => {
    const state = await window.__jamMock.createJam({
      name: "Prelude",
      yourName: "Operator",
      timezone: "UTC",
      template: "gamedev",
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 172800000).toISOString(),
    });
    if (!state.jam) throw new Error("Missing project");
    await window.__jamMock.simulateAgent({
      action: "question.asked",
      agent: "Brain",
      question: {
        scope: { type: "project", id: state.jam.id },
        title: "Which sketch comes first?",
        options: [{ label: "Snowball", description: "A small rolling toy" }],
        recommendedIndex: 0,
        allowFreeText: true,
      },
    });
    const question = (await window.__jamMock.listQuestions())[0];
    if (!question) throw new Error("Missing interview");
    await window.__jamMock.answerQuestion({ id: question.id, answerIndex: 0 });
    const epic = await window.__jamMock.createEpic({
      title: "The confirmed sketch",
    });
    const events = await window.__jamMock.listChangesSince(0);
    return {
      key: epic.key,
      seq: events.find((e) => e.action === "question.asked")?.seq,
      created: events.find((e) => e.action === "epic.created")?.seq,
    };
  });
  await page.goto(`/plan/${result.key}?tab=Journal`);
  const entry = page.locator(`.journal-entry[data-seq="${result.seq}"]`);
  const session = page.locator(".journal-session").filter({ has: entry });
  if ((await session.getAttribute("open")) === null)
    await session.locator("summary").click();
  await entry.scrollIntoViewIfNeeded();
  await expect(entry).toContainText("Project prelude");
  await expect(entry).toContainText("Which sketch comes first?");
  await expect(
    page.locator(`.journal-entry[data-seq="${result.created}"]`),
  ).not.toContainText("Project prelude");
  const unchanged = await page.evaluate(
    async (key) => ({
      scoped: await window.__jamMock.epicJournal(key),
      project: await window.__jamMock.listChangesSince(0),
    }),
    result.key,
  );
  expect(unchanged.scoped.some((e) => e.seq === result.seq)).toBe(false);
  expect(
    unchanged.project.find((e) => e.seq === result.seq)?.epicId,
  ).toBeNull();
});

test("overview pan preserves a legacy link's stored geometry", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  const id = await page.evaluate(async () => {
    const item = await window.__jamMock.addReference({
      kind: "link",
      url: "https://example.test/legacy",
      title: "Legacy layout",
    });
    await window.__jamMock.canvasGeometry({
      id: item.id,
      x: 2200,
      y: 200,
      w: 195,
      h: 145,
      z: 0,
      frameId: null,
    });
    await window.__jamMock.canvasViewport(
      JSON.stringify({ x: 10, y: 20, zoom: 0.2 }),
    );
    return item.id;
  });
  await page.goto("/references");
  await page.waitForFunction(
    () => window.__jamCanvas?.getViewport().zoom === 0.2,
  );
  await page.waitForTimeout(700);
  const geometry = () =>
    page.evaluate(async (id) => {
      const item = (await window.__jamMock.referenceCanvas()).items.find(
        (i) => i.id === id,
      );
      return { w: item?.w, h: item?.h };
    }, id);
  await expect.poll(geometry).toEqual({ w: 195, h: 145 });
  const saves = await page.evaluate(
    () =>
      window.__jamMock.calls.filter((c) => c.command === "canvas_geometry")
        .length,
  );
  await page.evaluate(async () => {
    for (let n = 0; n < 20; n++) {
      await window.__jamCanvas?.setViewport({
        x: 10 - n * 10,
        y: 20,
        zoom: 0.2,
      });
      await new Promise(requestAnimationFrame);
    }
  });
  await page.waitForTimeout(500);
  expect(await geometry()).toEqual({ w: 195, h: 145 });
  expect(
    await page.evaluate(
      () =>
        window.__jamMock.calls.filter((c) => c.command === "canvas_geometry")
          .length,
    ),
  ).toBe(saves);
});

test("planning and Inbox polish preserve shared controls and readable placement", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.goto("/plan/JB-E1?tab=Stories");
  const add = page.getByRole("button", { name: "New story", exact: true });
  await expect(add.locator("svg")).toHaveCount(1);
  await expect(add).toHaveCSS("height", "32px");
  await expect(page.locator(".story-completeness").first()).toContainText(
    /\d+ of \d+ criteria mandatory/,
  );
  await page.goto("/board?task=JB-2");
  const required = page.getByRole("textbox", {
    name: "Change 1 required",
    exact: true,
  });
  await expect(required).toHaveAttribute("aria-required", "true");
  await expect(required.locator("..")).toContainText("Required *");
  await expect(required.locator("..").locator(".stamp")).toHaveCount(0);
  await page.goto("/inbox");
  const positions = await page.locator(".question-groups").evaluate((el) => {
    const group = el.getBoundingClientRect(),
      host = el.parentElement?.getBoundingClientRect();
    if (!host) throw Error("Missing Inbox scroll host");
    return {
      left: group.left - host.left,
      right: host.right - group.right,
      width: group.width,
    };
  });
  expect(positions.width).toBeLessThanOrEqual(900);
  expect(Math.abs(positions.left - positions.right)).toBeLessThanOrEqual(12);
});

test("canvas links fit content, frames are rough, handles stay quiet until needed", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.goto("/references");
  await page.evaluate(async () => {
    await window.__jamMock.simulateAgent({
      action: "reference.added",
      reference: {
        kind: "link",
        url: "https://example.test/local-only",
        title:
          "A long reference title that needs several lines to remain readable",
        caption: "Local notes about the reference. ".repeat(10),
      },
    });
  });
  await page.getByRole("button", { name: "Fit view · F" }).click();
  const card = page.locator(".reference-card.kind-link");
  await expect(
    card.getByRole("button", { name: "Fetch preview", exact: true }),
  ).toBeVisible();
  const overflow = await card.evaluate((el) =>
    Array.from(
      el.querySelectorAll<HTMLElement>(".reference-content,.reference-caption"),
    ).map((n) => ({
      scroll: n.scrollHeight,
      client: n.clientHeight,
      overflow: getComputedStyle(n).overflowY,
    })),
  );
  for (const box of overflow) {
    expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
    expect(box.overflow).not.toBe("auto");
  }
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.__jamMock.referenceCanvas()).items.find(
            (i) => i.kind === "link",
          )?.h ?? 0,
      ),
    )
    .toBeGreaterThan(180);
  const frame = page.locator(".reference-frame").first();
  await expect(frame.locator(".reference-frame-tab")).toHaveCSS(
    "font-size",
    "16px",
  );
  expect(
    await frame
      .locator(".reference-frame-outline path")
      .first()
      .getAttribute("d"),
  ).toContain("C");
  await page.mouse.move(80, 70);
  await expect(card.locator(".react-flow__handle").first()).toHaveCSS(
    "opacity",
    "0",
  );
  await card.locator(".reference-card-header").hover();
  await expect(card.locator(".react-flow__handle").first()).toHaveCSS(
    "opacity",
    "1",
  );
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.mouse.move(80, 70);
  await expect(card.locator(".react-flow__handle").first()).toHaveCSS(
    "opacity",
    "1",
  );
});
