import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((page) => page.url().startsWith("http://127.0.0.1:1420"));
if (!page) throw new Error("Run the real Tauri application first");
const theme = process.argv[2] ?? "light";
await page.getByLabel("Theme", { exact: true }).selectOption(theme);
await page.locator(".board-scroll").evaluate((element) => {
  element.scrollTop = 0;
  element.scrollLeft = 0;
});
await page.waitForTimeout(450);
const observation = await page.evaluate(() => {
  const style = getComputedStyle(document.documentElement);
  function luminance(hex) {
    const colors = hex
      .trim()
      .slice(1)
      .match(/../g)
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return colors[0] * 0.2126 + colors[1] * 0.7152 + colors[2] * 0.0722;
  }
  function contrast(a, b) {
    const x = luminance(a);
    const y = luminance(b);
    return Number(
      ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2),
    );
  }
  return {
    theme: document.documentElement.dataset.theme,
    fonts: document.fonts.status,
    viewport: [innerWidth, innerHeight],
    cards: document.querySelectorAll(".task-card").length,
    cardBackground: getComputedStyle(document.querySelector(".task-card"))
      .backgroundColor,
    contrast: {
      primary: contrast("#2B2622", style.getPropertyValue("--coral")),
      inkOnPaper: contrast(
        style.getPropertyValue("--ink"),
        style.getPropertyValue("--paper"),
      ),
      secondaryOnCard: contrast(
        style.getPropertyValue("--ink-2"),
        style.getPropertyValue("--card"),
      ),
    },
  };
});
await writeFile(
  `../../docs/media/m3/ui-${theme}.json`,
  JSON.stringify(observation, null, 2) + "\n",
);
console.log(observation);
if (process.argv.includes("--minimum")) {
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.screenshot({ path: "../../docs/media/m3/desktop-minimum.png" });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.setViewportSize({ width: 1360, height: 860 });
}
if (process.argv.includes("--task-link")) {
  const key = await page.evaluate(
    async () =>
      (await (await import("/src/lib/api.ts")).api.listBoardTasks()).backlog[0]
        .key,
  );
  await page.goto(`http://127.0.0.1:1420/board?task=${key}`);
  await page.getByRole("dialog").waitFor();
  if (!(await page.getByRole("dialog").innerText()).includes(key))
    throw new Error("Direct task link did not resolve");
  await page.screenshot({
    path: "../../docs/media/m3/desktop-task-drawer.png",
  });
  await page.keyboard.press("Escape");
  console.log(`Direct native task link verified: ${key}`);
}
await browser.close();
if (process.argv.includes("--verify-video")) {
  const data = await readFile("../../docs/media/m3/agent-arrival.webm");
  const encoder = await chromium.launch({ channel: "chrome" });
  try {
    const check = await encoder.newPage();
    console.log(
      await check.evaluate(async (data) => {
        const video = document.createElement("video");
        video.src = `data:video/webm;base64,${data}`;
        video.muted = true;
        document.body.append(video);
        await new Promise((resolve, reject) => {
          video.onloadeddata = resolve;
          video.onerror = reject;
        });
        await video.play();
        await new Promise((r) => setTimeout(r, 600));
        return {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames,
          playbackSeconds: video.currentTime,
        };
      }, data.toString("base64")),
    );
  } finally {
    await encoder.close();
  }
}
