// Runs against the actual Tauri WebView2 and a separate stdio MCP process.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const root = fileURLToPath(new URL("../", import.meta.url));
const finalOutput = `${root}docs/media/m3`;
const output = `${root}.dev-data/m3-capture/${Date.now()}`;
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().startsWith("http://127.0.0.1:1420"));
if (!page) throw new Error("The actual Jam Board WebView2 must be running");
const cdp = await page.context().newCDPSession(page);
const runtime = await page.evaluate(async () => (await import("/src/lib/api.ts")).api.runtimeInfo());
if (process.argv.includes("--fresh")) {
  const state = await page.evaluate(async () => (await import("/src/lib/api.ts")).api.appState());
  if (state.hasJam || !/[\\/]capture-[^\\/]+$/.test(runtime.dataDir))
    throw new Error("--fresh needs an empty running app with JAM_BOARD_DATA_DIR=./.dev-data/capture-<date>. Restart the app in that directory first.");
}
const failures = [];
page.on("pageerror", (error) => failures.push(error.message));
await page.evaluate(async () => {
  const { api } = await import("/src/lib/api.ts");
  await api.loadDemoJam();
  await api.setTheme("light");
});
await page.reload();
await page.getByTestId("task-card").first().waitFor();
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${output}/desktop-content-light.png` });
const before = await page.evaluate(async () =>
  (await import("/src/lib/api.ts")).api.listBoardTasks(),
);
const env = {
  ...process.env,
  JAM_BOARD_DATA_DIR: runtime.dataDir,
  JAM_AGENT_NAME: "Codex",
  RUST_LOG: "warn",
};
delete env.JAM_BOARD_DB;
const server = spawn(
  `${root}target/debug/jam-board-mcp.exe`,
  ["--db", `${runtime.dataDir}/jam.db`],
  { cwd: root, windowsHide: true, env, stdio: ["pipe", "pipe", "inherit"] },
);
const pending = new Map();
let sequence = 0;
const transcript = [];
const lines = createInterface({ input: server.stdout });
lines.on("line", (line) => {
  const response = JSON.parse(line);
  const waiter = pending.get(response.id);
  if (waiter) {
    pending.delete(response.id);
    clearTimeout(waiter.timer);
    response.error
      ? waiter.reject(new Error(JSON.stringify(response.error)))
      : waiter.resolve(response.result);
  }
});
function request(method, params) {
  const id = ++sequence;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout: ${method}`)),
      10000,
    );
    pending.set(id, { resolve, reject, timer });
  });
  server.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
  );
  return promise;
}
async function tool(name, args) {
  const result = await request("tools/call", { name, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  transcript.push({
    name,
    arguments: args,
    response: result.content,
    key: result.structuredContent?.key,
  });
  return result.structuredContent;
}
try {
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "codex-m3-live-demo", version: "1" },
  });
  server.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  const createTitle = "Add a warm lantern flicker";
  const column = page.locator('[data-column="review"]');
  await column.locator(".card-button").last().scrollIntoViewIfNeeded();
  await page.locator(".board-scroll").evaluate((e) => {
    e.scrollLeft = 480;
    e.scrollTop = 350;
  });
  await page.evaluate((title) => {
    window.__m3Started = performance.now();
    window.__m3Arrival = null;
    const observer = new MutationObserver(() => {
      const card = [...document.querySelectorAll(".task-card")].find((card) =>
        card.textContent.includes(title),
      );
      if (card?.getAttribute("data-highlighted") === "true") {
        window.__m3Arrival = performance.now() - window.__m3Started;
        observer.disconnect();
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-highlighted"],
    });
  }, createTitle);
  const captured = [];
  let latest;
  let firstFrame;
  const ready = new Promise((resolve) => {
    firstFrame = resolve;
  });
  cdp.on("Page.screencastFrame", (frame) => {
    latest = { data: frame.data, at: performance.now() };
    captured.push(latest);
    firstFrame();
    void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 90,
    maxWidth: 1360,
    maxHeight: 860,
    everyNthFrame: 1,
  });
  await ready;
  await page.evaluate(() => {
    window.__m3Started = performance.now();
  });
  const start = performance.now();
  const creation = tool("create_task", {
    title: createTitle,
    status: "review",
    tags: ["polish"],
    priority: "high",
    description:
      "A subtle, cozy glow that agents and humans can review together.",
  });
  const frames = [];
  // Sample the real compositor stream every 200 ms. Source frame times are kept
  // too: the compositor emits no extra frames when the window has not changed.
  for (let i = 0; i < 6; i++) {
    const wait = start + i * 200 - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const at = performance.now() - start;
    await writeFile(
      `${output}/agent-arrival-${i + 1}.jpg`,
      Buffer.from(latest.data, "base64"),
    );
    frames.push({
      frame: i + 1,
      sampledAtMs: Math.round(at),
      compositorFrameAtMs: Math.round(latest.at - start),
    });
  }
  await cdp.send("Page.stopScreencast");
  // Encode the captured compositor frames locally. This browser only encodes
  // pixels already captured from Jam Board; it makes no network requests.
  async function encodeVideo() {
    const encoder = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      const canvasPage = await encoder.newPage();
      const base64 = await canvasPage.evaluate(async (frames) => {
        const canvas = document.createElement("canvas");
        document.body.append(canvas);
        const load = (data) =>
          new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.src = `data:image/jpeg;base64,${data}`;
          });
        const image = await load(frames[0].data);
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const stream = canvas.captureStream(30);
        const recorder = new MediaRecorder(stream, {
          mimeType: "video/webm;codecs=vp9",
        });
        const chunks = [];
        recorder.ondataavailable = (event) => chunks.push(event.data);
        const stopped = new Promise((resolve) => {
          recorder.onstop = resolve;
        });
        recorder.start();
        const started = performance.now();
        for (const frame of frames) {
          const image = await load(frame.data);
          const delay = frame.at - frames[0].at - (performance.now() - started);
          if (delay > 0) await new Promise((r) => setTimeout(r, delay));
          context.drawImage(image, 0, 0);
        }
        await new Promise((r) => setTimeout(r, 350));
        recorder.stop();
        await stopped;
        for (const track of stream.getTracks()) track.stop();
        const bytes = new Uint8Array(
          await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer(),
        );
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
      }, captured);
      await writeFile(
        `${output}/agent-arrival.webm`,
        Buffer.from(base64, "base64"),
      );
    } finally {
      await encoder.close();
    }
  }
  const created = await creation;
  const card = page.locator(`[data-key="${created.key}"]`);
  await card.waitFor();
  const arrivalMs = await page.evaluate(() => Math.round(window.__m3Arrival));
  if (!arrivalMs || arrivalMs > 1000)
    throw new Error(`Live rendering exceeded one second: ${arrivalMs} ms`);
  if ((await card.getAttribute("data-highlighted")) !== "true")
    throw new Error("The live agent card was not highlighted");
  if (
    !(
      await page.getByRole("status", { name: "Notifications" }).innerText()
    ).includes(created.key)
  )
    throw new Error("Missing live toast");
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/desktop-highlight-toast.png` });
  const claim = before.todo.find((t) => !t.assigneeId);
  const move = before.backlog.find((t) => !t.assigneeId);
  if (!claim || !move) throw new Error("Missing demo candidates");
  await tool("claim_task", { key: claim.key });
  await tool("move_task", {
    key: move.key,
    status: "review",
    beforeKey: before.review[0].key,
  });
  await page.waitForFunction(
    ({ claimKey, moveKey }) =>
      document.querySelector(
        `[data-column="in_progress"] [data-key="${claimKey}"]`,
      ) &&
      document.querySelector(`[data-column="review"] [data-key="${moveKey}"]`),
    { claimKey: claim.key, moveKey: move.key },
  );
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.waitForTimeout(300);
  await page.locator(".board-scroll").evaluate((e) => {
    e.scrollTop = 0;
    e.scrollLeft = 0;
  });
  await page.screenshot({ path: `${output}/desktop-content-dark.png` });
  // A real UI command must attribute the mutation to the selected human.
  await page.getByRole("button", { name: "New task", exact: false }).click();
  const input = page.getByRole("textbox", { name: "New task in To do" });
  await input.fill("Human bridge verification");
  await input.press("Enter");
  const human = await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const app = await api.appState();
    const tasks = await api.listBoardTasks();
    return {
      memberId: app.currentMember?.id,
      task: tasks.todo.find((t) => t.title === "Human bridge verification"),
    };
  });
  if (human.task?.createdBy !== human.memberId)
    throw new Error("UI actor mismatch");
  await input.press("Escape");
  await page.reload();
  await page.getByTestId("task-card").first().waitFor();
  if ((await page.locator("html").getAttribute("data-theme")) !== "dark")
    throw new Error("Theme was not persisted");
  await encodeVideo();
  if (process.argv.includes("--hold-highlight")) {
    await tool("move_task", {
      key: created.key,
      status: "review",
      beforeKey: move.key,
    });
    await page.locator(".board-scroll").evaluate((e) => {
      e.scrollTop = 0;
      e.scrollLeft = 480;
    });
    await page.waitForFunction(
      (key) =>
        document
          .querySelector(`[data-key="${key}"]`)
          ?.getAttribute("data-highlighted") === "true",
      created.key,
    );
  }
  const result = {
    transport: "real stdio process → SQLite → ChangeFeed → Tauri event → React",
    created: created.key,
    claimed: claim.key,
    moved: move.key,
    arrivalObservedByMs: arrivalMs,
    frames,
    humanActorVerified: true,
    themePersistsAfterReload: true,
    pageErrors: failures,
  };
  if (failures.length)
    throw new Error(`Desktop page errors: ${failures.join("; ")}`);
  await writeFile(
    `${output}/live-result.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  await writeFile(
    `${output}/mcp-transcript.md`,
    "# M3 live desktop MCP scenario\n\n```json\n" +
      JSON.stringify({ result, calls: transcript }, null, 2) +
      "\n```\n",
  );
  await mkdir(finalOutput, { recursive: true });
  for (const name of await readdir(output))
    await copyFile(`${output}/${name}`, `${finalOutput}/${name}`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  lines.close();
  server.stdin.end();
  await browser.close();
}
