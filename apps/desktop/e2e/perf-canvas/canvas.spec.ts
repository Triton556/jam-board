import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";

for (const scenario of ["pan-zoom", "drag"] as const)
  test(`${scenario}: production canvas with 500 items, 40 frames, 300 edges`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto("/");
    await page.waitForFunction(() => !!window.__jamMock);
    expect(await page.evaluate(() => window.__jamMock.buildMode)).toBe(
      "production",
    );
    await page.evaluate(async () => {
      await window.__jamMock.loadDemoJam();
      await window.__jamMock.seedBulkReferences(500, 40, 300);
    });
    await page.goto("/references");
    await page.waitForFunction(() => !!window.__jamCanvas);
    await page.evaluate(() => document.fonts.ready);
    const counts = await page.evaluate(async () => {
      const c = await window.__jamMock.referenceCanvas();
      return [
        c.items.length,
        c.frames.filter((f) => !f.archivedAt).length,
        c.edges.length,
      ];
    });
    expect(counts).toEqual([500, 40, 300]);

    await page.evaluate(() =>
      window.__jamCanvas?.setViewport({ x: 80, y: 90, zoom: 1 }),
    );
    await delay(1000);
    const display = await page.evaluate(async () => {
      const values: number[] = [];
      await new Promise<void>((resolve) => {
        let previous: number | undefined;
        const frame = (t: number) => {
          if (previous !== undefined) values.push(t - previous);
          previous = t;
          if (values.length < 30) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      values.sort((a, b) => a - b);
      return ((values[14] ?? 0) + (values[15] ?? 0)) / 2;
    });
    if (scenario === "pan-zoom")
      await page.evaluate(() =>
        window.__jamCanvas?.setViewport({ x: 10, y: 20, zoom: 0.2 }),
      );
    await delay(1000);
    const measurement = page.evaluate(
      async ({ scenario, display }) => {
        const values: number[] = [],
          tasks: number[] = [];
        let maxNodes = 0;
        const observer = new PerformanceObserver((entries) => {
          for (const e of entries.getEntries()) tasks.push(e.duration);
        });
        observer.observe({ type: "longtask", buffered: false });
        const start = performance.now();
        let previous: number | undefined;
        await new Promise<void>((resolve) => {
          const frame = (now: number) => {
            const elapsed = now - start;
            if (elapsed >= 1000 && previous !== undefined)
              values.push(now - previous);
            previous = now;
            maxNodes = Math.max(
              maxNodes,
              document.querySelectorAll(".react-flow__node").length,
            );
            if (scenario === "pan-zoom") {
              const phase = Math.min(1, elapsed / 4000),
                zoom = 0.2 + 0.06 * Math.sin(phase * Math.PI * 2);
              void window.__jamCanvas?.setViewport({
                x: 20 - phase * 440,
                y: 20 - phase * 120,
                zoom,
              });
            }
            if (elapsed < 4000) requestAnimationFrame(frame);
            else resolve();
          };
          requestAnimationFrame(frame);
        });
        observer.disconnect();
        values.sort((a, b) => a - b);
        return {
          scenario,
          displayIntervalMs: display,
          meanMs: values.reduce((a, b) => a + b, 0) / values.length,
          p95Ms: values[Math.ceil(values.length * 0.95) - 1] ?? 0,
          longFrames: values.filter((t) => t > display * 1.5).length,
          longFrameShare:
            values.filter((t) => t > display * 1.5).length / values.length,
          frames: values.length,
          longTasks: tasks.length,
          longTaskTotalMs: tasks.reduce((a, b) => a + b, 0),
          maxNodes,
        };
      },
      { scenario, display },
    );
    if (scenario === "drag") {
      const node = page.locator(
        '[data-reference-id="perf-item-0"] .reference-card-header',
      );
      const rect = await node.boundingBox();
      if (!rect) throw Error("Visible drag node missing");
      await page.mouse.move(rect.x + 70, rect.y + 14);
      await page.mouse.down();
      const start = Date.now();
      for (let step = 0; Date.now() - start < 4000; step++) {
        const phase = (Date.now() - start) / 4000;
        await page.mouse.move(
          rect.x + 70 + phase * 350,
          rect.y + 14 + Math.sin(phase * Math.PI) * 100,
        );
        await delay(Math.max(0, start + (step + 1) * 16 - Date.now()));
      }
      await page.mouse.up();
    }
    const result = await measurement;
    if (process.env.JAM_CANVAS_TRACE === "1" && scenario === "pan-zoom") {
      const session = await page.context().newCDPSession(page),
        traceEvents: unknown[] = [];
      session.on("Tracing.dataCollected", (e) => traceEvents.push(...e.value));
      await session.send("Tracing.start", {
        categories: "devtools.timeline,blink.user_timing",
        transferMode: "ReportEvents",
      });
      await page.evaluate(async () => {
        const start = performance.now();
        await new Promise<void>((resolve) => {
          const frame = (now: number) => {
            const phase = Math.min(1, (now - start) / 3000);
            void window.__jamCanvas?.setViewport({
              x: 20 - phase * 440,
              y: 20 - phase * 120,
              zoom: 0.2 + 0.06 * Math.sin(phase * Math.PI * 2),
            });
            if (phase < 1) requestAnimationFrame(frame);
            else resolve();
          };
          requestAnimationFrame(frame);
        });
      });
      const done = new Promise<void>((r) =>
        session.once("Tracing.tracingComplete", () => r()),
      );
      await session.send("Tracing.end");
      await done;
      await mkdir("../../.dev-data/perf-traces", { recursive: true });
      await writeFile(
        "../../.dev-data/perf-traces/canvas-pan.json",
        JSON.stringify({ traceEvents }),
      );
    }
    const directory =
      process.env.JAM_CANVAS_PERF_OUTPUT ?? "../../docs/media/v2.3";
    await mkdir(directory, { recursive: true });
    await writeFile(
      `${directory}/canvas-${scenario}.json`,
      JSON.stringify(
        {
          ...result,
          count: 500,
          framesCount: 40,
          edges: 300,
          production: true,
          warmupMs: 1000,
          measurementMs: 3000,
        },
        null,
        2,
      ),
    );
    if (scenario === "pan-zoom")
      expect(result.longFrameShare).toBeLessThanOrEqual(0.05);
    else expect(result.p95Ms).toBeLessThanOrEqual(display * 2);
  });
