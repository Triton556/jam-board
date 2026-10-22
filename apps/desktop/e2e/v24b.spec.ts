import { expect, test } from "@playwright/test";

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
test("Agents validates locally, copies exact commands and confirms install after plan", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.evaluate(() => {
    let n = 0;
    window.__jamMock.pickFolder = async () =>
      ++n === 1 ? "C:/temporary project" : "C:/playbook clone";
  });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose project folder…", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Choose playbook folder…", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Skill client" }).click();
  await page.getByRole("option", { name: "Claude Code", exact: true }).click();
  await expect(
    page.getByText(
      "Installing records a receipt in this playbook folder (.harness-state).",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "Whole agent-playbook", exact: true })
    .click();
  await page.getByRole("button", { name: "Check setup", exact: true }).click();
  await expect(page.getByText("Playbook 1.3.0")).toBeVisible();
  const card = page.locator(".settings-card").filter({
    has: page.getByRole("heading", {
      name: "Optional · Give your agent workflow guidance",
      exact: true,
    }),
  });
  await card.getByRole("button", { name: "Copy", exact: true }).click();
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).replaceAll(
      "\r\n",
      "\n",
    ),
  ).toBe(
    "& py -3 -B 'C:/playbook clone/harness.py' plan --client claude --target 'C:/temporary project' --profile full\n& py -3 -B 'C:/playbook clone/harness.py' install --client claude --target 'C:/temporary project' --profile full",
  );
  await page.getByRole("button", { name: "Run install", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "This adds files to that project.",
  );
  expect(
    await page.evaluate(
      () =>
        window.__jamMock.calls.filter((c) => c.command === "run_skill").length,
    ),
  ).toBe(1);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Install", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Installed · verified" }),
  ).toBeVisible();
  await expect(page.getByRole("log")).toContainText("Exit: 0");
});
