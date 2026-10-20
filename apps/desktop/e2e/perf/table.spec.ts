import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";

const phase = process.env.JAM_PERF_PHASE === "before" ? "before" : "after";
const directory = process.env.JAM_PERF_OUTPUT ?? "../../docs/media/m4";

for (const scenario of ["A", "B", "C"] as const) {
  test(`${scenario}: production table with 2000 representative tasks`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto("/");
    await page.waitForFunction(() => !!window.__jamMock);
    expect(await page.evaluate(() => window.__jamMock.buildMode)).toBe(
      "production",
    );
    await page.evaluate(async () => {
      const startsAt = new Date().toISOString();
      await window.__jamMock.createJam({
        name: "Performance jam",
        yourName: "Danil",
        startsAt,
        endsAt: new Date(Date.now() + 172800000).toISOString(),
        timezone: "UTC",
        theme: "Small lights",
      });
      await window.__jamMock.seedBulk(2000);
    });
    await page.goto("/table?sort=key:asc");
    await expect(page.getByText("2000 tasks", { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const displayIntervalMs = await page.evaluate(async () => {
      const frames: number[] = [];
      await new Promise<void>((resolve) => {
        let previous: number | undefined;
        const frame = (now: number) => {
          if (previous !== undefined) frames.push(now - previous);
          previous = now;
          if (frames.length < 30) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      frames.sort((a, b) => a - b);
      return ((frames[14] ?? 0) + (frames[15] ?? 0)) / 2;
    });
    const scroll = page.getByTestId("table-scroll");
    await scroll.hover();
    await scroll.evaluate((element) => {
      element.tabIndex = 0;
      (element as HTMLElement).focus();
    });

    const drive = async () => {
      const start = Date.now();
      const cadence = scenario === "A" ? 16 : 100;
      const inputs: Promise<unknown>[] = [];
      for (let step = 0; Date.now() - start < 4000; step++) {
        if (scenario === "A") inputs.push(page.mouse.wheel(0, 120));
        else await page.keyboard.press("PageDown");
        await delay(Math.max(0, start + (step + 1) * cadence - Date.now()));
      }
      await Promise.all(inputs);
    };
    // Metrics run without tracing; a second equivalent pass records the timeline.
    const measure = (record: boolean) =>
      scroll.evaluate(
        async (element, args) => {
          const frames: number[] = [];
          const longTasks: { start: number; duration: number }[] = [];
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
              longTasks.push({
                start: entry.startTime,
                duration: entry.duration,
              });
          });
          observer.observe({ type: "longtask", buffered: false });
          const range = element.scrollHeight - element.clientHeight;
          const start = performance.now();
          let previous: number | undefined;
          let maxRows = 0;
          let end = start;
          await new Promise<void>((resolve) => {
            const frame = (time: number) => {
              const elapsed = time - start;
              if (args.scenario === "B")
                element.scrollTop = Math.min(range, elapsed * 15);
              maxRows = Math.max(
                maxRows,
                element.querySelectorAll('[data-testid="table-row"]').length,
              );
              if (previous !== undefined && previous >= start + 1000)
                frames.push(time - previous);
              previous = time;
              if (elapsed < 4000) requestAnimationFrame(frame);
              else {
                end = time;
                resolve();
              }
            };
            requestAnimationFrame(frame);
          });
          for (const entry of observer.takeRecords())
            longTasks.push({
              start: entry.startTime,
              duration: entry.duration,
            });
          observer.disconnect();
          const measuredTasks = longTasks.filter(
            (task) =>
              task.start >= start + 1000 &&
              task.start < end &&
              task.duration > 50,
          );
          const sorted = frames.slice().sort((a, b) => a - b);
          return {
            scenario: args.scenario,
            phase: args.phase,
            recordedAt: new Date().toISOString(),
            production: true,
            warmupMs: 1000,
            measurementMs: end - start - 1000,
            displayIntervalMs: args.displayIntervalMs,
            meanFrameMs: frames.reduce((a, b) => a + b, 0) / frames.length,
            p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0,
            longFrameFraction:
              frames.filter((ms) => ms > args.displayIntervalMs * 1.5).length /
              frames.length,
            longTasks: {
              count: measuredTasks.length,
              sumMs: measuredTasks.reduce(
                (sum, task) => sum + task.duration,
                0,
              ),
              maxMs: Math.max(0, ...measuredTasks.map((task) => task.duration)),
            },
            maxRows,
            frameCount: frames.length,
            scrollTop: element.scrollTop,
            frames,
            traced: args.record,
          };
        },
        { scenario, phase, displayIntervalMs, record },
      );
    const pending = measure(false);
    if (scenario !== "B") await drive();
    const result = await pending;
    await mkdir(directory, { recursive: true });
    const path = `${directory}/table-performance.json`;
    const previous = JSON.parse(
      await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "{}";
        throw error;
      }),
    );
    const report = previous.methodology
      ? previous
      : Object.keys(previous).length
        ? { legacyM4: previous }
        : {};
    report.methodology = {
      build: "production VITE_MOCK_BRIDGE=1",
      viewport: { width: 1360, height: 860 },
      totalRows: 2000,
      warmupMs: 1000,
      measuredMs: 3000,
      displayCalibration: "median of 30 idle rAF intervals",
      A: "wheel 120 px every 16 ms",
      B: "15000 px/s scrollTop via rAF",
      C: "PageDown every 100 ms",
      thresholds: {
        A_C: {
          longFrameFraction: 0.05,
          p95DisplayIntervals: 2,
          longTaskLimitMs: 50,
        },
        B: { longFrameFraction: 0.15, longTaskLimitMs: 100 },
        maxRows: 60,
      },
    };
    report[phase] ??= {};
    report[phase][scenario] = result;
    await writeFile(path, JSON.stringify(report, null, 2));

    await scroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    await delay(500);
    const session = await page.context().newCDPSession(page);
    const traceEvents: unknown[] = [];
    session.on("Tracing.dataCollected", (event) =>
      traceEvents.push(...event.value),
    );
    await session.send("Tracing.start", {
      categories: "devtools.timeline,blink.user_timing",
      transferMode: "ReportEvents",
    });
    const traceRun = measure(true);
    if (scenario !== "B") await drive();
    await traceRun;
    const done = new Promise<void>((resolve) =>
      session.once("Tracing.tracingComplete", () => resolve()),
    );
    await session.send("Tracing.end");
    await done;
    await mkdir("../../.dev-data/perf-traces", { recursive: true });
    await writeFile(
      `../../.dev-data/perf-traces/${phase}-${scenario}.json`,
      JSON.stringify({ traceEvents }),
    );
    console.log(JSON.stringify({ ...result, frames: undefined }));
    expect(result.maxRows).toBeLessThanOrEqual(60);
    expect(result.longFrameFraction).toBeLessThanOrEqual(
      scenario === "B" ? 0.15 : 0.05,
    );
    if (scenario !== "B")
      expect(result.p95Ms).toBeLessThanOrEqual(displayIntervalMs * 2);
    expect(result.longTasks.maxMs).toBeLessThanOrEqual(
      scenario === "B" ? 100 : 50,
    );
  });
}
