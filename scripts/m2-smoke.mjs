import { assertHistoricalCapture } from "./historical-capture-guard.mjs";
assertHistoricalCapture(import.meta.url);

// A real stdio MCP client; optionally observes console events in the running WebView2.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
const root = fileURLToPath(new URL("../", import.meta.url));
const dbDir = `${root}.dev-data`;
const binary = `${root}target/debug/jam-board-mcp${process.platform === "win32" ? ".exe" : ""}`;
const observed = [];
let socket;
let shellState;
let cdpSequence = 0;
const cdpPending = new Map();
function cdp(method, params = {}) {
  const id = ++cdpSequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`CDP timeout: ${method}`)),
      5000,
    );
    cdpPending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
if (process.argv.includes("--cdp")) {
  const pages = await fetch("http://127.0.0.1:9223/json/list").then((r) =>
    r.json(),
  );
  const page = pages.find((p) => p.type === "page" && p.title === "Jam Board");
  if (!page) throw new Error("Jam Board WebView2 page is unavailable");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (e) => {
    const message = JSON.parse(String(e.data));
    const waiter = cdpPending.get(message.id);
    if (waiter) {
      cdpPending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error)
        waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
    if (message.method === "Runtime.consoleAPICalled")
      observed.push({ at: performance.now(), args: message.params.args });
  });
  await cdp("Runtime.enable");
  const inspected = await cdp("Runtime.evaluate", {
    expression: `(async()=>{await document.fonts.ready;return {title:document.title,theme:document.documentElement.dataset.theme,paper:getComputedStyle(document.body).backgroundColor,bodyFont:getComputedStyle(document.body).fontFamily,headingFont:getComputedStyle(document.querySelector('h1')).fontFamily,fontReady:document.fonts.status,viewport:[innerWidth,innerHeight]};})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (inspected.exceptionDetails)
    throw new Error(JSON.stringify(inspected.exceptionDetails));
  shellState = inspected.result.value;
  if (
    shellState.title !== "Jam Board" ||
    shellState.fontReady !== "loaded" ||
    !shellState.headingFont.includes("Fraunces")
  )
    throw new Error("The actual shell did not load its fonts/content");
  await cdp("Runtime.evaluate", {
    expression:
      "window.__m2Events=[];window.__m2OriginalInfo=console.info;console.info=function(...args){if(args[0]==='board-changed')window.__m2Events.push({at:performance.now(),payload:args[1]});window.__m2OriginalInfo.apply(console,args);};",
  });
}
const childEnv = {
  ...process.env,
  JAM_BOARD_DATA_DIR: dbDir,
  JAM_AGENT_NAME: "Codex",
  RUST_LOG: "warn",
};
delete childEnv.JAM_BOARD_DB;
const child = spawn(
  binary,
  process.argv.includes("--seed-demo") ? ["--seed-demo"] : [],
  {
    cwd: root,
    env: childEnv,
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  },
);
const pending = new Map();
let sequence = 0;
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  const response = JSON.parse(line);
  const waiter = pending.get(response.id);
  if (waiter) {
    pending.delete(response.id);
    clearTimeout(waiter.timer);
    if (response.error)
      waiter.reject(new Error(JSON.stringify(response.error)));
    else waiter.resolve(response.result);
  }
});
const transcript = [
  `# M2 MCP stdio transcript`,
  ``,
  `Recorded: ${new Date().toISOString()}`,
  ``,
  `Binary: \`${binary}\``,
  ``,
  `JAM_BOARD_DATA_DIR: \`${dbDir}\``,
  ``,
  `Real process, real SQLite database. Responses below are shortened; no protocol frames are simulated.`,
  ``,
];
if (shellState)
  transcript.push(
    "## Actual desktop shell",
    "",
    "```json",
    JSON.stringify(shellState, null, 2),
    "```",
    "",
  );
function record(method, params, result) {
  let output = result;
  if (method === "tools/list")
    output = { tools: result.tools.map((t) => t.name) };
  else if (result.structuredContent) {
    const v = result.structuredContent;
    output = {
      isError: result.isError ?? false,
      content: result.content,
      structuredContent:
        method === "tools/call" && params.name === "list_tasks"
          ? {
              tasks: v.tasks.map(({ key, title, status }) => ({
                key,
                title,
                status,
              })),
              nextCursor: v.nextCursor,
            }
          : {
              key: v.key,
              title: v.title,
              status: v.status,
              tags: v.tags,
              bodyMd: v.bodyMd,
              comments: v.comments?.map(({ bodyMd }) => ({ bodyMd })),
              activityCount: v.activity?.length,
            },
    };
  }
  transcript.push(
    `## ${method}${params?.name ? ` · ${params.name}` : ""}`,
    "",
    "```json",
    JSON.stringify({ request: { method, params }, response: output }, null, 2),
    "```",
    "",
  );
}
async function request(method, params) {
  const id = ++sequence;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
  });
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
  );
  const result = await promise;
  record(method, params, result);
  return result;
}
async function tool(name, args) {
  const result = await request("tools/call", { name, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return result.structuredContent;
}
try {
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "codex-m2-manual-client", version: "1.0" },
  });
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  await request("tools/list", {});
  const started = performance.now();
  const pageStarted = socket
    ? (
        await cdp("Runtime.evaluate", {
          expression: "performance.now()",
          returnByValue: true,
        })
      ).result.value
    : 0;
  const task = await tool("create_task", {
    title: "Add jump buffer",
    description: "Allow a jump press just before landing.",
    priority: "high",
    tags: ["gameplay"],
    idempotencyKey: `m2-manual-${Date.now()}`,
  });
  await tool("list_tasks", { query: "Add jump buffer" });
  await tool("claim_task", { key: task.key });
  await tool("move_task", { key: task.key, status: "review" });
  await tool("add_comment", {
    key: task.key,
    body: "Jump buffer implemented; checked landing and repeated input.",
  });
  const detail = await tool("get_task", { key: task.key });
  if (detail.status !== "review" || detail.comments.length !== 1)
    throw new Error("Unexpected task detail");
  if (socket) {
    const deadline = performance.now() + 1000;
    let matching;
    while (!matching && performance.now() < deadline) {
      const read = await cdp("Runtime.evaluate", {
        expression: `window.__m2Events.find(e=>e.payload.events.some(event=>event.taskKey===${JSON.stringify(task.key)}&&event.action==='task.created'))`,
        returnByValue: true,
      });
      matching = read.result.value;
      if (!matching) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!matching)
      throw new Error(
        "No board-changed event for the created task in the actual WebView2 console",
      );
    const elapsed = Math.round(matching.at - pageStarted);
    if (elapsed > 1000)
      throw new Error(`Event latency ${elapsed} ms exceeded one second`);
    transcript.push(
      `Actual desktop console received \`board-changed\` ${elapsed} ms after the create request began.`,
      "",
    );
    console.log(`Desktop board-changed: ${elapsed} ms`);
  }
  mkdirSync(`${root}docs/media`, { recursive: true });
  writeFileSync(
    `${root}docs/media/m2-mcp-transcript.md`,
    transcript.join("\n"),
  );
  console.log(`M2 scenario passed: ${task.key}; transcript saved.`);
} finally {
  lines.close();
  child.stdin.end();
  if (socket) {
    await cdp("Runtime.evaluate", {
      expression:
        "console.info=window.__m2OriginalInfo;delete window.__m2Events;delete window.__m2OriginalInfo;",
    });
    socket.close();
  }
}
