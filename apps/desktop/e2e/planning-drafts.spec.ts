import { expect, test } from "@playwright/test";
import { markdownReadView } from "./assertions";

for (const field of ["acceptance", "storyMarkdown", "epicMarkdown"] as const) {
  test(`queued ${field} saves retain their entity target across SPA navigation`, async ({
    page,
  }) => {
    const epic = field === "epicMarkdown";
    const url = (second = false) =>
      epic
        ? `/plan/JB-E${second ? 2 : 1}`
        : `/plan/JB-E1?tab=Stories&story=JB-S${second ? 2 : 1}`;
    await page.goto("/");
    await page
      .getByRole("button", { name: "Load demo jam", exact: true })
      .click();
    await page.goto(url());
    const label = epic ? "Goal and audience" : "Outcome";
    await page
      .getByRole("button", { name: `Edit ${label}`, exact: true })
      .waitFor();
    const before = await page.evaluate(
      async (epic) =>
        epic
          ? (await window.__jamMock.getEpic("JB-E2")).epic
          : (await window.__jamMock.getStory("JB-S2")).story,
      epic,
    );
    await page.evaluate((epic) => {
      const pending: { key: string; release(): Promise<void> }[] = [];
      Reflect.set(window, "targetedSaves", pending);
      function hold<T>(key: string, write: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
          pending.push({
            key,
            release: async () => {
              try {
                resolve(await write());
              } catch (error) {
                reject(error);
              }
            },
          });
        });
      }
      if (epic) {
        const original = window.__jamMock.updateEpic.bind(window.__jamMock);
        window.__jamMock.updateEpic = (key, patch) =>
          hold(key, () => original(key, patch));
      } else {
        const original = window.__jamMock.updateStory.bind(window.__jamMock);
        window.__jamMock.updateStory = (key, patch) =>
          hold(key, () => original(key, patch));
      }
    }, epic);
    for (const value of ["First submitted save", "Second submitted save"]) {
      if (field === "acceptance") {
        await page
          .getByRole("textbox", { name: "Criterion 1", exact: true })
          .fill(value);
        await page
          .getByRole("button", { name: "Save acceptance", exact: true })
          .click();
      } else {
        await page
          .getByRole("button", { name: `Edit ${label}`, exact: true })
          .click();
        const input = page.getByRole("textbox", { name: label, exact: true });
        await input.fill(value);
        await input.press("Control+s");
      }
    }
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "targetedSaves").length),
      )
      .toBe(1);
    await page.evaluate((url) => {
      window.history.pushState({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, url(true));
    if (epic) {
      await expect(
        page.getByRole("textbox", { name: "Epic title", exact: true }),
      ).toHaveValue(before.title);
    } else {
      await expect(
        page.getByRole("textbox", { name: "Story title", exact: true }),
      ).toHaveValue(before.title);
    }
    await page.evaluate(() =>
      Reflect.get(window, "targetedSaves")[0].release(),
    );
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "targetedSaves").length),
      )
      .toBe(2);
    await page.evaluate(() =>
      Reflect.get(window, "targetedSaves")[1].release(),
    );
    expect(
      await page.evaluate(() =>
        Reflect.get(window, "targetedSaves").map((s: { key: string }) => s.key),
      ),
    ).toEqual(epic ? ["JB-E1", "JB-E1"] : ["JB-S1", "JB-S1"]);
    await expect
      .poll(() =>
        page.evaluate(async (field) => {
          if (field === "epicMarkdown")
            return (await window.__jamMock.getEpic("JB-E1")).epic.goalMd;
          const story = (await window.__jamMock.getStory("JB-S1")).story;
          return field === "acceptance"
            ? story.acceptance[0]?.criterion
            : story.outcomeMd;
        }, field),
      )
      .toBe("Second submitted save");
    // Navigation must not change any persisted field of the second entity.
    expect(
      await page.evaluate(
        async (epic) =>
          epic
            ? (await window.__jamMock.getEpic("JB-E2")).epic
            : (await window.__jamMock.getStory("JB-S2")).story,
        epic,
      ),
    ).toEqual(before);
    await page.evaluate((url) => {
      window.history.pushState({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, url());
    if (field === "acceptance") {
      await expect(
        page.getByRole("textbox", { name: "Criterion 1", exact: true }),
      ).toHaveValue("Second submitted save");
    } else {
      await expect(markdownReadView(page, label)).toHaveText(
        "Second submitted save",
      );
    }
  });
}

test("an earlier Markdown response preserves a newer draft and its subsequent save", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.goto("/plan/JB-E1");
  await page
    .getByRole("button", { name: "Edit Goal and audience", exact: true })
    .waitFor();
  await page.evaluate(() => {
    const original = window.__jamMock.updateEpic.bind(window.__jamMock);
    window.__jamMock.updateEpic = (...args) =>
      new Promise((resolve) => {
        Reflect.set(window, "releasePlanningSave", async () => {
          window.__jamMock.updateEpic = original;
          resolve(await original(...args));
        });
      });
  });
  const edit = page.getByRole("button", {
    name: "Edit Goal and audience",
    exact: true,
  });
  const input = page.getByRole("textbox", {
    name: "Goal and audience",
    exact: true,
  });
  await edit.click();
  await input.fill("First saved text");
  await input.press("Control+s");
  await edit.click();
  await input.fill("New text typed while first save is pending");
  await page.evaluate(() => Reflect.get(window, "releasePlanningSave")());
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.__jamMock.getEpic("JB-E1")).epic.goalMd,
      ),
    )
    .toBe("First saved text");
  await expect(input).toHaveValue("New text typed while first save is pending");
  await input.press("Control+s");
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.__jamMock.getEpic("JB-E1")).epic.goalMd,
      ),
    )
    .toBe("New text typed while first save is pending");
  await page.reload();
  await expect(markdownReadView(page, "Goal and audience")).toHaveText(
    "New text typed while first save is pending",
  );
});

test("saving Story Outcome preserves unsaved acceptance until its explicit save", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.goto("/plan/JB-E1?tab=Stories&story=JB-S1");
  const criterion = page.getByRole("textbox", {
    name: "Criterion 1",
    exact: true,
  });
  await criterion.fill("New user criterion that is not saved yet");
  await page.getByRole("button", { name: "Edit Outcome", exact: true }).click();
  const outcome = page.getByRole("textbox", { name: "Outcome", exact: true });
  await outcome.fill("An unrelated saved outcome for the same story");
  await outcome.press("Tab");
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.__jamMock.getStory("JB-S1")).story.outcomeMd,
      ),
    )
    .toBe("An unrelated saved outcome for the same story");
  await expect(criterion).toHaveValue(
    "New user criterion that is not saved yet",
  );
  await page
    .getByRole("button", { name: "Save acceptance", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.__jamMock.getStory("JB-S1")).story.acceptance[0]
            ?.criterion,
      ),
    )
    .toBe("New user criterion that is not saved yet");
  await page.reload();
  await expect(criterion).toHaveValue(
    "New user criterion that is not saved yet",
  );
});
