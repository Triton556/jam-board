import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
page.on("pageerror", (error) => console.error(error));
await page.goto("http://127.0.0.1:1420");
await page.getByRole("button", { name: "Load demo jam instead" }).click();
await page.getByTestId("task-card").first().waitFor();
await mkdir("../../docs/media/m3", { recursive: true });
await page.screenshot({ path: "../../docs/media/m3/browser-light.png" });
console.log({ cards: await page.getByTestId("task-card").count() });
await page.getByLabel("Theme", { exact: true }).selectOption("dark");
await page.waitForTimeout(400);
console.log(
  await page
    .locator(".task-card")
    .first()
    .evaluate((e) => ({
      background: getComputedStyle(e).backgroundColor,
      card: getComputedStyle(e).getPropertyValue("--card"),
      htmlcard: getComputedStyle(document.documentElement).getPropertyValue(
        "--card",
      ),
      theme: document.documentElement.dataset.theme,
    })),
);
await page.screenshot({ path: "../../docs/media/m3/browser-dark.png" });
await browser.close();
