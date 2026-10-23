import { expect, test } from "@playwright/test";

test("AC04/AS03 saved answer stays durable; manual continuation copies IDs without starting work", async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  const question = await page.evaluate(() =>
    window.__jamMock.askUser({
      scope: { type: "task", id: "JB-7" },
      title: "Which route should the fictional player see?",
      bodyMd:
        "Keep this fictional question body on the board, not in the prompt.",
      options: [
        { label: "Keep the short route", description: "One clear destination" },
      ],
      recommendedIndex: 0,
      allowFreeText: true,
      roundLabel: null,
    }),
  );
  await page.goto("/inbox");
  const card = page.getByRole("article", {
    name: `Question: ${question.title}`,
  });
  await expect(
    card.getByRole("button", { name: "Continue in brain chat" }),
  ).toHaveCount(0);
  const answer = "Оставить короткий маршрут — без новых уровней.";
  await card
    .getByRole("textbox", { name: "Or answer in your own words" })
    .fill(answer);
  await card.getByRole("button", { name: "Answer", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Answer saved for" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue in brain chat" }),
  ).toBeVisible();
  const saved = await page.evaluate(
    async (id) =>
      (await window.__jamMock.listQuestions()).find((q) => q.id === id),
    question.id,
  );
  expect(saved?.status).toBe("answered");
  expect(saved?.answerText).toBe(answer);

  // A fresh page has no transient receipt, but the persisted answer still offers the aid.
  await page.reload();
  await page.getByRole("radio", { name: "Answered", exact: true }).click();
  await expect(card).toContainText(answer);
  await card.getByRole("button", { name: "Continue in brain chat" }).click();
  const preview = card.getByRole("textbox", { name: "Continuation prompt" });
  const prompt = await preview.inputValue();
  for (const id of [
    question.id,
    question.jamId,
    question.scopeId,
    question.epicId ?? "",
  ])
    expect(prompt).toContain(id);
  expect(prompt).toContain("not Start approval");
  expect(prompt).not.toContain(answer);
  expect(prompt).not.toContain(question.bodyMd);
  await expect(preview).toHaveAttribute("readonly");
  const before = await page.evaluate(async () => ({
    task: await window.__jamMock.getTask("JB-7"),
    calls: window.__jamMock.calls.length,
  }));
  await card.getByRole("button", { name: "Copy continuation prompt" }).click();
  await expect(card.getByRole("status")).toContainText(
    "Nothing was sent and no work was started",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    prompt,
  );
  expect(await page.evaluate(() => window.__jamMock.getTask("JB-7"))).toEqual(
    before.task,
  );
  expect(
    await page.evaluate(
      (start) =>
        window.__jamMock.calls
          .slice(start)
          .filter((call) => !/^(get_task|list_|app_state)/.test(call.command)),
      before.calls,
    ),
  ).toEqual([]);
  for (const theme of ["light", "dark"] as const) {
    await page
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOption(theme);
    await preview.scrollIntoViewIfNeeded();
    const geometry = await preview.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: bounds.left,
        right: bounds.right,
        viewport: innerWidth,
        font: style.fontSize,
        line: style.lineHeight,
        overflow: element.scrollWidth <= element.clientWidth + 1,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.font).toBe("14px");
    expect(parseFloat(geometry.line)).toBeGreaterThanOrEqual(22);
    expect(geometry.overflow).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`answer-continuation-${theme}.png`),
      fullPage: true,
    });
  }
});
