import { expect, test } from "@playwright/test";
import { completeProjectFolder, openExternalAgents } from "./assertions";

test("Web app onboarding, milestone and project template confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Web app", exact: true }).click();
  await expect(page.getByLabel("Start", { exact: true })).toHaveCount(0);
  await page.getByLabel("Project name", { exact: true }).fill("Ledger app");
  await page.getByLabel("Your name", { exact: true }).fill("Danil");
  await page.getByLabel("Milestone (optional)").fill("2026-11-30T18:00");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await completeProjectFolder(page);
  await expect(
    page.getByRole("heading", { name: /The product board/ }),
  ).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);
  await expect(page.getByText("Milestone · Nov 30")).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your project", exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Project template" }).click();
  await page.getByRole("option", { name: "Gamedev", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Tags already used stay; suggestions and the timer change.",
  );
  await page
    .getByRole("button", { name: "Switch template", exact: true })
    .click();
  await expect(page.getByText("level-design", { exact: true })).toBeVisible();
  await expect(page.getByText("frontend", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /The project board/ }),
  ).toBeVisible();
});
test("Agents reviews a bundled project skill and confirms installation without an external playbook", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.evaluate(() => {
    window.__jamMock.pickFolder = async () => "C:/temporary project";
  });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await openExternalAgents(page);
  const card = page.locator(".settings-card").filter({
    has: page.getByRole("heading", {
      name: "Optional · Jam Board skill",
      exact: true,
    }),
  });
  await expect(
    card.getByRole("button", { name: "Review installation" }),
  ).toBeDisabled();
  await expect(
    card.getByRole("button", { name: "Choose playbook folder…" }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("radio", { name: "Whole agent-playbook" }),
  ).toHaveCount(0);
  await card.getByRole("button", { name: "Choose project folder…" }).click();
  await card.getByRole("combobox", { name: "Skill client" }).click();
  await page.getByRole("option", { name: "Claude Code", exact: true }).click();
  await expect(
    card.getByText("C:/temporary project/.claude/skills/jam-board"),
  ).toBeVisible();
  await card.getByRole("button", { name: "Review installation" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "C:/temporary project/.claude/skills/jam-board",
  );
  expect(
    await page.evaluate(
      () =>
        window.__jamMock.calls.filter((c) => c.command === "run_skill").length,
    ),
  ).toBe(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        window.__jamMock.calls.filter((c) => c.command === "run_skill").length,
    ),
  ).toBe(1);
  await card.getByRole("button", { name: "Review installation" }).click();
  await dialog.getByRole("button", { name: "Install", exact: true }).click();
  await expect(card.getByRole("status")).toContainText(
    "Jam Board skill installed · files verified",
  );
  await card.getByText("Installation log", { exact: true }).click();
  await expect(card.getByRole("log")).toContainText("Exit: 0");
  expect(
    await page.evaluate(() =>
      window.__jamMock.calls
        .filter((c) => c.command === "run_skill")
        .map((c) => (c.input as { step: string }).step),
    ),
  ).toEqual(["plan", "plan", "install", "verify"]);
});
