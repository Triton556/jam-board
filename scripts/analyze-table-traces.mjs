import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const output = new URL("../docs/media/m4.1/", import.meta.url);
await mkdir(output, { recursive: true });
const report = { scope: "Separate 4-second trace passes: 1s warmup plus 3s scroll, production mock; timings are supporting diagnostics, not the untraced acceptance metrics.", forcedLayoutDefinition: "Layout contained in a same-thread FunctionCall / FireAnimationFrame / TimerFire / EventDispatch span", traces: [] };
for (const phase of ["before", "after"]) {
  for (const scenario of ["A", "B", "C"]) {
    const bytes = await readFile(new URL(`../.dev-data/perf-traces/${phase}-${scenario}.json`, import.meta.url));
    const { traceEvents } = JSON.parse(bytes);
    const spans = traceEvents.filter((event) => event.ph === "X" && event.dur);
    const javascript = spans.filter((event) => ["FunctionCall", "FireAnimationFrame", "TimerFire", "EventDispatch"].includes(event.name));
    const groups = {};
    for (const name of ["FunctionCall", "UpdateLayoutTree", "Layout", "Paint", "PrePaint", "Layerize", "HitTest"]) {
      const events = spans.filter((event) => event.name === name);
      groups[name] = { count: events.length, sumMs: events.reduce((sum, event) => sum + event.dur / 1000, 0), maxMs: Math.max(0, ...events.map((event) => event.dur / 1000)) };
    }
    const forced = spans.filter((event) => event.name === "Layout" && javascript.some((call) => call.pid === event.pid && call.tid === event.tid && call.ts <= event.ts && call.ts + call.dur >= event.ts + event.dur));
    const attribution = { applicationCallback: 0, testDriver: 0, browserFrameWithoutFunctionCall: 0 };
    for (const layout of forced) {
      const functions = javascript.filter((call) => call.name === "FunctionCall" && call.pid === layout.pid && call.tid === layout.tid && call.ts <= layout.ts && call.ts + call.dur >= layout.ts + layout.dur);
      if (functions.some((call) => call.args?.data?.url?.includes("/assets/"))) attribution.applicationCallback++;
      else if (functions.length) attribution.testDriver++;
      else attribution.browserFrameWithoutFunctionCall++;
    }
    report.traces.push({ phase, scenario, groups, forcedLayoutInJavaScriptCount: forced.length, synchronousLayoutAttribution: attribution, largestStyleRecalculationElements: Math.max(0, ...spans.filter((event) => event.name === "UpdateLayoutTree").map((event) => event.args?.elementCount ?? 0)), largestLayoutObjectCount: Math.max(0, ...spans.filter((event) => event.name === "Layout").map((event) => event.args?.beginData?.totalObjects ?? 0)), file: `trace-${phase}-${scenario}.json.gz` });
    await writeFile(new URL(`trace-${phase}-${scenario}.json.gz`, output), gzipSync(bytes));
  }
}
await writeFile(new URL("trace-analysis.json", output), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.traces.map(({ phase, scenario, groups, forcedLayoutInJavaScriptCount, largestStyleRecalculationElements }) => ({ phase, scenario, javascriptMs: groups.FunctionCall.sumMs, styleMs: groups.UpdateLayoutTree.sumMs, layoutMs: groups.Layout.sumMs, paintMs: groups.Paint.sumMs, forcedLayoutInJavaScriptCount, largestStyleRecalculationElements })), null, 2));
