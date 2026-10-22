import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__jamMock);
  await page.evaluate(async () => window.__jamMock.loadDemoJam());
  await page.goto("/plan");
});

test("epic overview exposes stories and a safe scoped planning handoff", async ({
  page,
}) => {
  const hierarchy = page.getByRole("navigation", { name: "Epic hierarchy" });
  await expect(hierarchy).toContainText("Stories live inside this epic");
  await hierarchy
    .getByRole("button", { name: /stories? · features & outcomes/ })
    .click();
  await expect(
    page.getByRole("radio", { name: "Stories", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Refine with brain", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: /Plan JB-E\d+ with your brain/,
  });
  const prompt = dialog.getByRole("textbox", { name: "Planning prompt" });
  const project = await page.evaluate(() => window.__jamMock.appState());
  await expect(prompt).toHaveValue(/key prefix is JB/);
  expect(await prompt.inputValue()).toContain(
    `project ID is ${project.jam?.id}`,
  );
  await expect(prompt).toHaveValue(/matching name or prefix is not enough/);
  await expect(prompt).toHaveValue(/Planning only: do not claim tasks/);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Stories", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Refine with brain", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test("agent setup distinguishes connection, skill and planning without starting a task", async ({
  page,
}) => {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await expect(
    page.getByText("Set up in three steps", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Use the jam-board MCP connection for a read-only connection check/,
    ),
  ).toBeAttached();
  const current = await page.evaluate(() => window.__jamMock.appState());
  await expect(
    page.getByText(
      /Use the jam-board MCP connection for a read-only connection check/,
    ),
  ).toContainText(current.jam?.id ?? "missing project");
  await expect(
    page.getByText(/Switching boards in Jam Board does not redirect/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show configuration" }).click();
  const configuration = page.getByRole("region", { name: "Connect the board" });
  await expect(configuration).toBeFocused();
  await expect(configuration.locator("pre")).toContainText(
    current.jam?.id ?? "missing project",
  );
  const stdioTab = configuration.getByRole("tab", {
    name: "Codex · stdio",
    exact: true,
  });
  await stdioTab.focus();
  await page.keyboard.press("ArrowRight");
  const httpTab = configuration.getByRole("tab", {
    name: "Codex · HTTP",
    exact: true,
  });
  await expect(httpTab).toBeFocused();
  await expect(stdioTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(
    configuration.getByRole("tabpanel", { name: "Codex · HTTP", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Prepare planning prompt" }).click();
  const dialog = page.getByRole("dialog", { name: "Plan with your brain" });
  await expect(dialog).toContainText("not an agent launch");
  await expect(
    dialog.getByRole("textbox", { name: "Planning prompt" }),
  ).toHaveValue(/do not replace another brain/);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
});

test("new projects keep existing boards and the picker restores their hierarchy", async ({
  page,
}) => {
  const original = await page.evaluate(() => window.__jamMock.appState());
  await page.getByRole("link", { name: /^Switch project ·/ }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Fictional second project");
  await page.getByLabel("Your name", { exact: true }).fill("Human");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: "Switch project · Fictional second project",
    }),
  ).toBeVisible();
  await expect(page.getByTestId("task-card")).toHaveCount(0);
  await page.getByRole("link", { name: /^Switch project ·/ }).click();
  await page
    .getByRole("button", { name: `Open project ${original.jam?.name}` })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Epic hierarchy" }),
  ).toContainText("Stories live inside this epic");
  await expect(
    page.getByRole("link", { name: `Switch project · ${original.jam?.name}` }),
  ).toBeVisible();
  const projects = await page.evaluate(() => window.__jamMock.listProjects());
  expect(projects).toHaveLength(2);
  expect(
    projects.find((p) => p.name === "Fictional second project")?.keyPrefix,
  ).not.toBe(original.jam?.keyPrefix);
});
