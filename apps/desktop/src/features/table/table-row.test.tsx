import { act, render, renderHook, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import fixture from "../../lib/demo-fixture.json";
import type { TaskSummary } from "../../lib/types";
import { sameTableRow, TableRow, type TableRowProps } from "./TableRow";
import { tableTime } from "./table-time";
import { tableRange, useTableVirtualizer } from "./use-table-virtualizer";

const props: TableRowProps = {
  task: fixture.details[0] as TaskSummary,
  initials: "",
  highlightUntil: 0,
  selected: false,
  tabStop: true,
  timeLabel: "2 hr. ago",
  exactTime: "Oct 21",
};
it("memo compares version, key, highlight and selection while accepting stable data copies", () => {
  expect(sameTableRow(props, { ...props, task: { ...props.task } })).toBe(true);
  for (const changed of [
    { task: { ...props.task, key: "JB-999" } },
    { task: { ...props.task, updatedAt: "2026-10-21T00:00:00Z" } },
    { highlightUntil: 4000 },
    { selected: true },
    { timeLabel: "3 hr. ago" },
  ]) {
    expect(sameTableRow(props, { ...props, ...changed })).toBe(false);
  }
});
it("memo skips unchanged versions and refreshes a changed task", () => {
  const row = (value: TableRowProps) => (
    <table>
      <tbody>
        <TableRow {...value} />
      </tbody>
    </table>
  );
  const { rerender } = render(row(props));
  rerender(
    row({ ...props, task: { ...props.task, title: "Unversioned copy" } }),
  );
  expect(screen.queryByText("Unversioned copy")).not.toBeInTheDocument();
  rerender(
    row({
      ...props,
      task: {
        ...props.task,
        title: "New version",
        updatedAt: "2026-10-21T00:00:00Z",
      },
    }),
  );
  expect(screen.getByText("New version")).toBeVisible();
});
it("block windows retain ten overscan rows and fewer than sixty desktop rows", () => {
  for (let start = 0; start < 1980; start++) {
    const indexes = tableRange({
      startIndex: start,
      endIndex: start + 14,
      overscan: 10,
      count: 2000,
    });
    expect(indexes.length).toBeLessThanOrEqual(60);
    expect(indexes[0]).toBeLessThanOrEqual(Math.max(0, start - 10));
    expect(indexes.at(-1)).toBeGreaterThanOrEqual(Math.min(1999, start + 24));
  }
});
it("table time caches English relative and exact labels outside rows", () => {
  const iso = "2026-10-19T00:00:00Z";
  const tick = Date.parse(iso) + 7200000;
  expect(tableTime(iso, tick).label).toContain("2 hr.");
  expect(tableTime(iso, tick)).toBe(tableTime(iso, tick));
  expect(tableTime(iso, tick + 3600000).label).toContain("3 hr.");
});

it("commits only when a virtual block changes and cleans up scroll listeners", () => {
  const element = document.createElement("div");
  Object.defineProperties(element, {
    clientHeight: { value: 623 },
    clientWidth: { value: 1200 },
    scrollHeight: { value: 88040 },
    scrollWidth: { value: 1200 },
  });
  element.scrollTo = vi.fn();
  document.body.append(element);
  const ref = { current: element };
  let renders = 0;
  const key = (index: number) => `JB-${index}`;
  const { result, unmount } = renderHook(() => {
    renders++;
    return useTableVirtualizer(ref, 2000, key);
  });
  expect(result.current.getVirtualItems().length).toBeLessThanOrEqual(60);
  const initial = renders;
  act(() => {
    element.scrollTop = 44;
    element.dispatchEvent(new Event("scroll"));
  });
  expect(renders).toBe(initial);
  act(() => {
    element.scrollTop = 880;
    element.dispatchEvent(new Event("scroll"));
  });
  expect(renders).toBe(initial + 1);
  expect(result.current.getVirtualItems()[0]?.index).toBe(10);
  unmount();
  const last = renders;
  act(() => {
    element.scrollTop = 1100;
    element.dispatchEvent(new Event("scroll"));
  });
  expect(renders).toBe(last);
  element.remove();
});
