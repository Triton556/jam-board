// Prepare reproducible states in the actual Tauri WebView2. Native window
// screenshots are captured separately through the Windows capture API.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = `${root}docs/media/m4`;
await mkdir(output, { recursive: true });
const stage =
  process.argv.find((a) => a.startsWith("--stage="))?.slice(8) ?? "board";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().startsWith("http://127.0.0.1:1420"));
if (!page)
  throw new Error(
    "Run the actual Jam Board app with process-scoped WebView2 diagnostics on 9223 first.",
  );
const runtime = await page.evaluate(async () =>
  (await import("/src/lib/api.ts")).api.runtimeInfo(),
);
if (!/[\\/]\.dev-data[\\/]capture-[^\\/]+$/.test(runtime.dataDir))
  throw new Error(
    "Captures require JAM_BOARD_DATA_DIR=./.dev-data/capture-<date>.",
  );
if (process.argv.includes("--fresh")) {
  const state = await page.evaluate(async () =>
    (await import("/src/lib/api.ts")).api.appState(),
  );
  if (state.hasJam)
    throw new Error(
      "--fresh requires an empty capture directory. Restart the app with a new directory; existing data will not be deleted.",
    );
  await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    await api.loadDemoJam();
    await api.setTheme("light");
  });
}
async function go(path) {
  await page.goto(`http://127.0.0.1:1420${path}`);
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".topbar").waitFor();
}
if (stage === "board") {
  await page.evaluate(async () =>
    (await import("/src/lib/api.ts")).api.setTheme("light"),
  );
  await go("/board");
  await page.getByTestId("task-card").first().waitFor();
} else if (stage === "table-light" || stage === "table-dark") {
  await page.evaluate(
    async (theme) => (await import("/src/lib/api.ts")).api.setTheme(theme),
    stage === "table-dark" ? "dark" : "light",
  );
  await go("/table?status=todo,review&assignee=unassigned&sort=priority:desc");
  await page.getByTestId("table-row").first().waitFor();
} else if (stage === "edit") {
  await page.evaluate(async () =>
    (await import("/src/lib/api.ts")).api.setTheme("light"),
  );
  await go("/table?task=JB-7");
  await page
    .getByRole("textbox", { name: "Task title" })
    .fill("Player movement: tune the jump buffer");
  await page
    .getByRole("group", { name: "Priority", exact: true })
    .getByRole("button", { name: "High", exact: true })
    .click();
} else if (stage === "conflict") {
  if (!(await page.getByRole("textbox", { name: "Task title" }).count()))
    throw new Error(
      "Prepare --stage=edit first; the unsaved form must stay open.",
    );
  const server = spawn(
    runtime.sidecarPath,
    ["--db", `${runtime.dataDir}/jam.db`],
    {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        JAM_AGENT_NAME: "Codex",
        JAM_BOARD_DATA_DIR: runtime.dataDir,
        RUST_LOG: "warn",
      },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const pending = new Map();
  let sequence = 0;
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
  const request = (method, params) => {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout: ${method}`)),
        10000,
      );
      pending.set(id, { resolve, reject, timer });
      server.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  };
  try {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "codex-m4-live-demo", version: "1" },
    });
    server.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    const args = {
      key: "JB-7",
      title: "Player movement: a more forgiving jump buffer",
      priority: "critical",
      description:
        "## Agent checkpoint\nReviewed jump buffering and coyote time. Keep the transition gentle.",
    };
    const result = await request("tools/call", {
      name: "update_task",
      arguments: args,
    });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    await page.locator(".conflict-banner").waitFor();
    await writeFile(
      `${output}/live-mcp-transcript.json`,
      JSON.stringify(
        {
          transport: "stdio",
          client: "codex-m4-live-demo",
          request: { tool: "update_task", arguments: args },
          content: result.content,
          updatedAt: result.structuredContent?.updatedAt,
          observedBanner: await page.locator(".conflict-banner").innerText(),
          preservedHumanTitle: await page
            .getByRole("textbox", { name: "Task title" })
            .inputValue(),
        },
        null,
        2,
      ),
    );
  } finally {
    server.stdin.end();
    lines.close();
    server.kill();
  }
} else if (stage === "palette") {
  if (
    await page.getByRole("button", { name: "Close task", exact: true }).count()
  ) {
    await page.getByRole("button", { name: "Close task", exact: true }).click();
    const discard = page.getByRole("button", { name: "Discard", exact: true });
    if (await discard.count()) await discard.click();
  }
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("lantern");
} else throw new Error(`Unknown capture stage: ${stage}`);
await page.mouse.move(700, 80);
await page.waitForTimeout(350);
await page.screenshot({
  path: `${output}/content-${stage}.jpg`,
  type: "jpeg",
  quality: 92,
});
const geometry = await page.evaluate(() => ({
  width: innerWidth,
  height: innerHeight,
  boardFits: document.querySelector(".board-scroll")
    ? document.querySelector(".board-scroll").scrollWidth <=
      document.querySelector(".board-scroll").clientWidth
    : null,
}));
console.log(JSON.stringify({ stage, dataDir: runtime.dataDir, ...geometry }));
await browser.close();
