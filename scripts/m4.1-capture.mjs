import { assertHistoricalCapture } from "./historical-capture-guard.mjs";
assertHistoricalCapture(import.meta.url);

// Prepare and crop actual Tauri WebView2 states; native frame captures use sky.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const output = new URL("../docs/media/m4.1/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts().flatMap((context) => context.pages()).find((page) => page.url().startsWith("http://127.0.0.1:1420"));
if (!page) throw new Error("Start the actual Tauri app with process-local diagnostics on 9223.");
const runtime = await page.evaluate(async () => (await import("/src/lib/api.ts")).api.runtimeInfo());
if (!/[\\/]\.dev-data[\\/]capture-[^\\/]+$/.test(runtime.dataDir)) throw new Error("Use an isolated .dev-data/capture-* directory.");
if (process.argv.includes("--fresh")) {
  const state = await page.evaluate(async () => (await import("/src/lib/api.ts")).api.appState());
  if (state.hasJam) throw new Error("--fresh refuses an existing jam. Start with a new directory; no data is deleted.");
  await page.evaluate(async () => (await import("/src/lib/api.ts")).api.loadDemoJam());
}
const stage = process.argv.find((arg) => arg.startsWith("--stage="))?.slice(8) ?? "board-light";
const theme = stage.endsWith("dark") ? "dark" : "light";
await page.evaluate(async (theme) => (await import("/src/lib/api.ts")).api.setTheme(theme), theme);
await page.goto(`http://127.0.0.1:1420/${stage === "panel" ? "board?task=JB-7" : "board"}`);
await page.getByTestId("task-card").first().waitFor();
await page.evaluate(() => document.fonts.ready);
if (stage === "panel") {
  await page.getByRole("textbox", { name: "Task title" }).fill("Player movement: tune the jump buffer");
  await page.getByRole("button", { name: "Set due date" }).click();
  const input = page.locator('input[type="datetime-local"]');
  await input.fill("2026-10-21T18:00");
  await page.getByRole("textbox", { name: "Task title" }).click();
}
await page.mouse.move(30, 70);
await page.waitForTimeout(300);
const failures = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, boardFits: document.querySelector(".board-scroll").scrollWidth <= document.querySelector(".board-scroll").clientWidth, keys: [...document.querySelectorAll("[data-key]")].map((card) => card.dataset.key) }));
if (!failures.keys.every((key) => /^JB-\d+$/.test(key))) throw new Error("Capture keys must use JB-*.");
await page.screenshot({ path: new URL(`content-${stage}.png`, output).pathname.replace(/^\/(\w:)/, "$1") });
if (stage !== "panel") {
  const cards = [];
  const paddedCard = async (card) => {
    await card.scrollIntoViewIfNeeded();
    const bounds = await card.boundingBox();
    if (!bounds) throw new Error("Card has no visible bounds");
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const x = Math.max(0, bounds.x - 24), y = Math.max(0, bounds.y - 24);
    return page.screenshot({ clip: { x, y, width: Math.min(size.width - x, bounds.width + 48), height: Math.min(size.height - y, bounds.height + 48) } });
  };
  for (const status of ["backlog", "todo", "in_progress", "review", "done"]) {
    const card = page.locator(`[data-column="${status}"] [data-testid="task-card"]`).first();
    cards.push({ name: status, png: await paddedCard(card) });
  }
  for (const [name, key] of [["agent", "JB-16"], ["critical", "JB-11"]]) {
    const card = page.locator(`[data-key="${key}"]`);
    if (name === "critical") {
      const critical = page.locator(".card-button").filter({ has: page.locator(".tape") }).first();
      cards.push({ name, png: await paddedCard(critical) });
    } else cards.push({ name, png: await paddedCard(card) });
  }
  const sharp = require("sharp");
  const widths = await Promise.all(cards.map(async (card) => (await sharp(card.png).metadata()).width));
  const heights = await Promise.all(cards.map(async (card) => (await sharp(card.png).metadata()).height));
  const width = widths.reduce((sum, n) => sum + n + 16, 16);
  await sharp({ create: { width, height: Math.max(...heights) + 32, channels: 4, background: theme === "dark" ? "#1E1B19" : "#F7F1E6" } }).composite(cards.map((card, i) => ({ input: card.png, top: 16, left: widths.slice(0, i).reduce((sum, n) => sum + n + 16, 16) }))).png().toFile(new URL(`cards-closeup-${theme}.png`, output).pathname.replace(/^\/(\w:)/, "$1"));
  // Return the native window to the original top-of-column board view.
  await page.goto("http://127.0.0.1:1420/board");
  await page.getByTestId("task-card").first().waitFor();
}
if (process.argv.includes("--highlight")) {
  const server = spawn(runtime.sidecarPath, ["--db", `${runtime.dataDir}/jam.db`], { windowsHide: true, env: { ...process.env, JAM_AGENT_NAME: "Codex", RUST_LOG: "warn" }, stdio: ["pipe", "pipe", "inherit"] });
  let sequence = 0;
  const pending = new Map();
  const lines = createInterface({ input: server.stdout });
  lines.on("line", (line) => {
    const response = JSON.parse(line), waiter = pending.get(response.id);
    if (waiter) { pending.delete(response.id); clearTimeout(waiter.timer); response.error ? waiter.reject(new Error(JSON.stringify(response.error))) : waiter.resolve(response.result); }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 10000);
    pending.set(id, { resolve, reject, timer });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  try {
    await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "codex-m4-1-capture", version: "1" } });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const result = await request("tools/call", { name: "add_comment", arguments: { key: "JB-16", body: "Checked the lantern puzzle handoff for the sticker capture." } });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    await page.locator('[data-key="JB-16"][data-highlighted="true"]').waitFor();
    await page.waitForTimeout(350);
    await page.screenshot({ path: new URL(`agent-highlight-${theme}.png`, output).pathname.replace(/^\/(\w:)/, "$1") });
    await writeFile(new URL(`agent-${theme}.json`, output), JSON.stringify({ transport: "real stdio sidecar", tool: "add_comment", key: "JB-16", content: result.content, highlighted: await page.locator('[data-key="JB-16"]').getAttribute("data-highlighted"), toast: await page.getByRole("status", { name: "Notifications" }).innerText() }, null, 2));
  } finally { server.stdin.end(); lines.close(); server.kill(); }
}
await writeFile(new URL(`capture-${stage}.json`, output), JSON.stringify({ stage, dataDir: runtime.dataDir, ...failures, source: "actual Tauri WebView2; native frame captured separately" }, null, 2));
console.log(JSON.stringify({ stage, dataDir: runtime.dataDir, ...failures }));
await browser.close();
