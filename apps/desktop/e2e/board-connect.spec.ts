import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openExternalAgents } from "./assertions";

test("board connection prompt stays neutral, remembers its code folder and reports clipboard failure", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.evaluate(() => {
    window.__jamMock.pickFolder = async () => "C:/Projects/Small game";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copiedPrompt = text;
        },
      },
    });
  });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await openExternalAgents(page);
  const section = page.locator(".settings-card").filter({
    has: page.getByRole("heading", {
      name: "Connect an agent to this board",
      exact: true,
    }),
  });
  await expect(section.getByText(/Not set. The agent will ask/)).toBeVisible();
  await section
    .getByRole("button", { name: "Copy agent connection prompt" })
    .click();
  await expect(section.getByRole("status")).toContainText(
    "nothing has connected yet",
  );
  let prompt = await page.evaluate(
    () => document.documentElement.dataset.copiedPrompt ?? "",
  );
  expect(prompt).toContain("jam://guide");
  expect(prompt).toContain(
    "not an instruction to start work or appoint yourself as brain",
  );
  expect(prompt).not.toContain("Authorization: Bearer");
  await section.getByRole("button", { name: "Choose code folder…" }).click();
  await expect(section.getByText("C:/Projects/Small game")).toBeVisible();
  await section
    .getByRole("button", { name: "Copy agent connection prompt" })
    .click();
  prompt = await page.evaluate(
    () => document.documentElement.dataset.copiedPrompt ?? "",
  );
  expect(prompt).toContain("C:/Projects/Small game");
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await openExternalAgents(page);
  await expect(section.getByText("C:/Projects/Small game")).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard is unavailable");
        },
      },
    });
  });
  await section
    .getByRole("button", { name: "Copy agent connection prompt" })
    .click();
  await expect(section.getByRole("status")).toContainText(
    "Clipboard is unavailable",
  );
  await expect(
    section.getByRole("button", { name: "Copy agent connection prompt" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      window.__jamMock.calls.some((c) =>
        [
          "reveal_mcp_token",
          "mcp_config_snippets",
          "set_brain",
          "claim_task",
          "run_skill",
        ].includes(c.command),
      ),
    ),
  ).toBe(false);
  await page.setViewportSize({ width: 840, height: 800 });
  await expect(
    section.getByRole("button", { name: "Copy agent connection prompt" }),
  ).toBeVisible();
  await expect(section.getByText(/No token is copied/)).toBeVisible();
  await mkdir("../../test-visuals", { recursive: true });
  await section.screenshot({
    path: "../../test-visuals/readability-connect-agent.png",
  });
});
