// AS02 hosted-browser behavior; prepared/typechecked, not a native transport probe.
import { expect, test } from "@playwright/test";

test("AS02 cached question failure preserves the real answer editor; explicit check is single-flight and read-only", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  const question = await page.evaluate(() =>
    window.__jamMock.askUser({
      scope: { type: "task", id: "JB-7" },
      title: "Which fictional route should remain?",
      bodyMd: "A read-recovery fixture, not an instruction to start work.",
      options: [],
      recommendedIndex: null,
      allowFreeText: true,
      roundLabel: null,
    }),
  );
  await page.goto("/inbox");
  const questions = page.getByRole("region", {
    name: "Questions",
    exact: true,
  });
  const card = questions.getByRole("article", {
    name: `Question: ${question.title}`,
  });
  const input = card.getByRole("textbox", {
    name: "Or answer in your own words",
  });
  const draft = "Оставить короткий маршрут — это пока мой черновик.";
  await input.fill(draft);
  await input.evaluate((element) =>
    Reflect.set(window, "answerEditor", element),
  );
  const before = await page.evaluate(async () => ({
    task: await window.__jamMock.getTask("JB-7"),
    calls: window.__jamMock.calls.length,
  }));
  await page.evaluate(() => {
    const original = window.__jamMock.listQuestions.bind(window.__jamMock);
    Reflect.set(window, "originalQuestionsRead", original);
    window.__jamMock.listQuestions = async () => {
      throw new Error("Fictional background read failure");
    };
    // The normal board event invalidation path, without creating a domain event.
    window.__jamMock.emit([]);
  });
  await expect(questions.getByRole("alert")).toContainText(
    "Showing the last loaded questions",
  );
  await expect(input).toHaveValue(draft);
  await expect(input).toBeFocused();
  expect(
    await input.evaluate(
      (element) => element === Reflect.get(window, "answerEditor"),
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("cached-answer-read-failure.png"),
    fullPage: true,
  });

  await page.evaluate(() => {
    Reflect.set(window, "explicitQuestionReads", 0);
    window.__jamMock.listQuestions = () => {
      Reflect.set(
        window,
        "explicitQuestionReads",
        Reflect.get(window, "explicitQuestionReads") + 1,
      );
      return new Promise((resolve, reject) => {
        Reflect.set(window, "releaseQuestionRead", async () => {
          try {
            resolve(await Reflect.get(window, "originalQuestionsRead")());
          } catch (error) {
            reject(error);
          }
        });
      });
    };
  });
  const refresh = questions.getByRole("button", {
    name: "Refresh",
    exact: true,
  });
  await refresh.click();
  const pending = questions.getByRole("button", {
    name: "Checking questions…",
    exact: true,
  });
  await expect(pending).toBeDisabled();
  await expect(pending).toHaveAttribute("aria-busy", "true");
  await expect(questions.getByRole("status")).toHaveText("Checking questions…");
  await page.keyboard.press("Enter");
  expect(
    await page.evaluate(() => Reflect.get(window, "explicitQuestionReads")),
  ).toBe(1);
  await page.evaluate(() => Reflect.get(window, "releaseQuestionRead")());
  await expect(refresh).toBeEnabled();
  await expect(questions.getByRole("status")).toContainText(
    "Checked questions.",
  );
  await expect(questions.getByRole("status").locator("time")).toHaveAttribute(
    "datetime",
    /\d{4}-/,
  );
  await expect(questions.getByRole("alert")).toHaveCount(0);
  await expect(input).toHaveValue(draft);
  expect(
    await input.evaluate(
      (element) => element === Reflect.get(window, "answerEditor"),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.__jamMock.getTask("JB-7"))).toEqual(
    before.task,
  );
  const stored = await page.evaluate(
    async (id) =>
      (await Reflect.get(window, "originalQuestionsRead")()).find(
        (row: { id: string }) => row.id === id,
      ),
    question.id,
  );
  expect(stored).toEqual(question);
  expect(
    await page.evaluate(
      (start) =>
        window.__jamMock.calls
          .slice(start)
          .filter((call) =>
            /^(answer_question|withdraw_question|update_task|claim_task|set_execution)$/.test(
              call.command,
            ),
          ),
      before.calls,
    ),
  ).toEqual([]);
});
