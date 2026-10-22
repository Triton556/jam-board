import { expect, type Page, test } from "@playwright/test";

async function select(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function writeBlock(page: Page, label: string, text: string) {
  await page
    .getByRole("button", { name: `Edit ${label}`, exact: true })
    .click();
  const input = page.getByRole("textbox", { name: label, exact: true });
  await input.fill(text);
  await input.press("Tab");
  await expect(
    page.getByRole("button", { name: `Edit ${label}`, exact: true }),
  ).toContainText(text);
}
async function emptyPlan(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__jamMock);
  await page.evaluate(async () => {
    await window.__jamMock.createJam({
      name: "Lantern workshop",
      yourName: "Danil",
      theme: "Small lights",
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 172800000).toISOString(),
      timezone: "UTC",
    });
  });
  await page.goto("/plan");
}
test("human plans, edits briefs, overrides readiness, reviews and answers a worker", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await emptyPlan(page);
  await expect(page.getByText("No epics yet", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "New epic", exact: true })
    .last()
    .click();
  await page.getByRole("textbox", { name: "Epic name" }).fill("Lantern levels");
  await page.getByRole("button", { name: "Create epic", exact: true }).click();
  await writeBlock(
    page,
    "Goal and audience",
    "A new player follows a short warm lantern route.",
  );
  await writeBlock(
    page,
    "Done when",
    "The bridge playtest passes with keyboard controls.",
  );
  await select(page, "Epic plan status", "Active");
  await expect(
    page.getByRole("combobox", { name: "Epic plan status" }),
  ).toContainText("Active");
  await page.getByRole("radio", { name: "Stories", exact: true }).click();
  await page.getByRole("button", { name: "New story", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Story name" })
    .fill("Readable bridge");
  await page.getByRole("button", { name: "Create story", exact: true }).click();
  await writeBlock(page, "Outcome", "The next safe tile is obvious.");
  await page
    .getByRole("button", { name: "Add criterion", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Criterion 1", exact: true })
    .fill("Exactly one tile lights up");
  await page
    .getByRole("textbox", { name: "Criterion 1 check", exact: true })
    .fill("Run the bridge playtest");
  await page
    .getByRole("button", { name: "Save acceptance", exact: true })
    .click();
  await select(page, "Story plan status", "Active");
  await expect(
    page.getByRole("combobox", { name: "Story plan status" }),
  ).toContainText("Active");
  await page.getByRole("button", { name: "Close task", exact: true }).click();
  await page
    .getByRole("button", { name: "+ Task", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "New planned task title" })
    .fill("Light one safe tile");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  for (const [label, text] of [
    ["Goal", "Show the safe next step."],
    ["Where", "game/lantern.gd"],
    ["Result", "Report files, tests, deviations and unverified checks."],
  ])
    await writeBlock(page, label ?? "", text ?? "");
  await page.getByRole("button", { name: "Add change", exact: true }).click();
  await page.getByRole("textbox", { name: "Change 1 title" }).fill("Tile cue");
  await page
    .getByRole("textbox", { name: "Change 1 required" })
    .fill("Illuminate only one adjacent safe tile.");
  await page.getByRole("button", { name: "Add test", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Test 1 setup" })
    .fill("Hold the lantern beside the bridge");
  await page
    .getByRole("textbox", { name: "Test 1 expected" })
    .fill("One safe tile lights up");
  await page.getByRole("button", { name: /^Save Ctrl/ }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark ready", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toContainText("Ready");
  await page.getByRole("button", { name: "Close task", exact: true }).click();
  await page
    .getByRole("button", { name: "+ Task", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "New planned task title" })
    .fill("Explore the bridge edge");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await page.getByRole("button", { name: "Mark ready", exact: true }).click();
  const ready = page.getByRole("dialog", { name: "Not ready · JB-2" });
  await expect(ready).toContainText("At least one test");
  await ready
    .getByRole("button", { name: "Mark ready anyway…", exact: true })
    .click();
  await ready.getByRole("textbox", { name: "Override reason" }).fill("short");
  await expect(
    ready.getByRole("button", { name: "Mark ready anyway", exact: true }),
  ).toBeDisabled();
  await ready
    .getByRole("textbox", { name: "Override reason" })
    .fill("Explore the existing route before narrowing the test.");
  await ready
    .getByRole("button", { name: "Mark ready anyway", exact: true })
    .click();
  await expect(ready).not.toBeVisible();
  await page.getByRole("button", { name: "Close task", exact: true }).click();
  // Ready describes the brief, not permission. The human starts this exact story.
  const planned = await page.evaluate(() => window.__jamMock.getTask("JB-1"));
  await page.goto(`/plan/${planned.epic.key}?story=${planned.story.key}`);
  await page.getByRole("button", { name: "Start story", exact: true }).click();
  const start = page.getByRole("dialog", {
    name: `Start ${planned.story.key}?`,
  });
  await expect(start).toContainText("does not launch");
  await start
    .getByRole("button", { name: `Start ${planned.story.key}`, exact: true })
    .click();
  await expect(start).not.toBeVisible();
  await page.getByRole("button", { name: "Close task", exact: true }).click();
  await page.evaluate(async () => {
    await window.__jamMock.simulateAgent({
      action: "task.claimed",
      key: "JB-1",
    });
    await window.__jamMock.simulateAgent({
      action: "report.submitted",
      key: "JB-1",
    });
  });
  await page.getByRole("button", { name: /JB-1 Light one safe tile/ }).click();
  await expect(
    page.getByRole("region", { name: "Latest report", exact: true }),
  ).toContainText("FAIL");
  await page
    .getByRole("button", { name: "Request changes…", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Request changes",
    exact: true,
  });
  await expect(
    review.getByRole("button", { name: "Request changes", exact: true }),
  ).toBeDisabled();
  await review
    .getByRole("textbox", { name: "Review comments" })
    .fill("Limit the radius to the adjacent tile and repeat test 1.");
  await review.getByRole("checkbox").first().check();
  await review
    .getByRole("button", { name: "Request changes", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Latest review", exact: true }),
  ).toContainText("Changes requested");
  await page.getByRole("button", { name: "Close task", exact: true }).click();
  await page.evaluate(() =>
    window.__jamMock.simulateAgent({
      action: "question.asked",
      key: "JB-1",
      title: "Which lantern color?",
    }),
  );
  await expect(
    page.getByRole("status", { name: "Notifications" }),
  ).toContainText("Codex asked: Which lantern color?");
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(page.locator('[data-key="JB-1"]')).toContainText("Needs info");
  await expect(page.locator('[data-key="JB-1"]')).toContainText(
    "Changes requested",
  );
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  const question = page.getByRole("article", {
    name: "Question: Which lantern color?",
  });
  await expect(question).toContainText("Recommended");
  await question.focus();
  await page.keyboard.press("a");
  await expect(
    question.getByRole("button", { name: /Warm amber/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await question
    .getByRole("textbox", { name: "Or answer in your own words" })
    .fill("Keep the route warm.");
  await question.getByRole("button", { name: "Answer", exact: true }).click();
  await page.getByRole("radio", { name: "Answered", exact: true }).click();
  await expect(
    page.getByText("Keep the route warm.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(page.locator('[data-key="JB-1"]')).not.toContainText(
    "Needs info",
  );
  await page.getByRole("link", { name: "Plan", exact: true }).click();
  await page.getByRole("radio", { name: "Journal", exact: true }).click();
  await expect(page.getByTestId("journal-scroll")).toContainText(
    "returned JB-1",
  );
  const journal = await page.evaluate(() =>
    window.__jamMock.epicJournal("JB-E1"),
  );
  for (const action of [
    "epic.created",
    "story.created",
    "task.created",
    "task.ready_override",
    "task.claimed",
    "report.submitted",
    "review.recorded",
    "question.asked",
    "question.answered",
  ])
    expect(journal.some((e) => e.action === action)).toBe(true);
  const report = journal.find((e) => e.action === "report.submitted"),
    verdict = journal.find((e) => e.action === "review.recorded");
  expect(report?.seq).toBeLessThan(verdict?.seq ?? 0);
  expect(errors).toEqual([]);
});
test("board epic chips and table hierarchy filters preserve their URL", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);
  await page
    .getByRole("group", { name: "Board epics" })
    .getByRole("button", { name: "Lantern levels", exact: true })
    .click();
  await expect(page).toHaveURL(/epics=JB-E1/);
  await expect(page.getByTestId("task-card")).toHaveCount(17);
  await expect(page.locator('[data-key="JB-7"]')).toHaveAttribute(
    "data-color-by",
    "epic",
  );
  await page.reload();
  await expect(page.getByTestId("task-card")).toHaveCount(17);
  await page.getByRole("link", { name: "Table", exact: true }).click();
  await select(page, "Filter epic", "JB-E1 · Lantern levels");
  await select(
    page,
    "Filter story",
    "JB-S1 · Movement and lantern readability",
  );
  await expect(page).toHaveURL(/epic=JB-E1/);
  await expect(page).toHaveURL(/story=JB-S1/);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Filter story" }),
  ).toContainText("JB-S1");
  await page.locator(".new-task-button").click();
  await page
    .getByRole("textbox", { name: "New task title" })
    .fill("Requires a story");
  await expect(
    page.getByRole("button", { name: "Create", exact: true }),
  ).toBeDisabled();
  await select(
    page,
    "New task story",
    "JB-S1 · Movement and lantern readability",
  );
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByText("Requires a story", { exact: true }),
  ).toBeVisible();
});

test("brief lists reorder by pointer and Alt arrows; Plan fits the minimum window", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.evaluate(() =>
    window.__jamMock.updateTaskBrief("JB-1", {
      changes: [
        { title: "First change", required: "Keep one safe tile" },
        { title: "Second change", required: "Preserve the snow edge" },
      ],
      tests: [
        { setup: "First setup", expected: "One tile" },
        { setup: "Second setup", expected: "No overflow" },
      ],
    }),
  );
  await page.goto("/board?task=JB-1");
  for (const label of ["Change", "Test"]) {
    const first = page.getByRole("button", {
      name: `Drag ${label} 1`,
      exact: true,
    });
    const second = page.getByRole("button", {
      name: `Drag ${label} 2`,
      exact: true,
    });
    await second.scrollIntoViewIfNeeded();
    const a = await first.boundingBox(),
      b = await second.boundingBox();
    if (!a || !b) throw new Error("Missing list drag handles");
    await page.mouse.move(a.x + 8, a.y + 8);
    await page.mouse.down();
    await page.mouse.move(b.x + 8, b.y + 18, { steps: 12 });
    await page.mouse.up();
    const field = page.getByRole("textbox", {
      name: label === "Change" ? "Change 1 title" : "Test 1 setup",
      exact: true,
    });
    await expect(field).toHaveValue(
      label === "Change" ? "Second change" : "Second setup",
    );
    await field.press("Alt+ArrowDown");
    await expect(field).toHaveValue(
      label === "Change" ? "First change" : "First setup",
    );
  }
  // Pointer and Alt-key moves restore the original order, so there is no patch.
  await expect(page.getByRole("button", { name: /^Save Ctrl/ })).toBeDisabled();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close task", exact: true }).click();
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page).toHaveURL(/\/plan/);
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect(page.locator(".epic-rail")).toHaveCSS("width", "220px");
  await expect(
    page.getByRole("combobox", { name: "Epic filter" }),
  ).toBeVisible();
  await expect(page.locator(".epic-card h2").first()).toBeVisible();
  await select(page, "Epic filter", "Draft");
  await expect(
    page.locator(".epic-card").filter({ hasText: "JB-E2" }),
  ).toBeVisible();
  await select(page, "Epic filter", "All");
  await expect(page.locator(".epic-card")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("g");
  await page.keyboard.press("i");
  await expect(page).toHaveURL(/\/inbox/);
});

test("brief conflict compares fields and Keep mine preserves the agent's other edits", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.goto("/board?task=JB-2");
  const required = page.getByRole("textbox", {
    name: "Change 1 required",
    exact: true,
  });
  await required.fill("Keep exactly one neighboring safe tile illuminated.");
  await page.evaluate(async () => {
    const task = await window.__jamMock.getTask("JB-2");
    await window.__jamMock.simulateAgent({
      action: "task.brief_updated",
      key: task.key,
      patch: {
        brief: {
          ...task.brief,
          goalMd: "The agent clarified the route goal.",
          whereMd: "game/bridge/next-tile.gd",
        },
      },
    });
  });
  await expect(page.locator(".conflict-banner")).toContainText(
    "Codex updated this task",
  );
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review changes",
    exact: true,
  });
  await expect(dialog).toContainText("game/bridge/next-tile.gd");
  await dialog.getByRole("button", { name: "Keep mine", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(() => window.__jamMock.getTask("JB-2"));
  expect(saved.brief.goalMd).toBe("The agent clarified the route goal.");
  expect(saved.brief.whereMd).toBe("game/bridge/next-tile.gd");
  expect(saved.brief.changes?.[0]?.required).toBe(
    "Keep exactly one neighboring safe tile illuminated.",
  );
  await required.fill("A local draft that will be discarded.");
  await page.evaluate(async () => {
    const task = await window.__jamMock.getTask("JB-2");
    const change = task.brief.changes?.[0];
    if (!change) throw new Error("Missing change fixture");
    await window.__jamMock.simulateAgent({
      action: "task.brief_updated",
      key: task.key,
      patch: {
        brief: {
          ...task.brief,
          changes: [
            {
              ...change,
              required: "Use the newly reviewed tile boundary.",
            },
          ],
        },
      },
    });
  });
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await page.getByRole("button", { name: "Take theirs", exact: true }).click();
  await expect(required).toHaveValue("Use the newly reviewed tile boundary.");
});
