import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { DateTimeInput, formatDue } from "./controls";

it("formats Due in English with a 24-hour clock regardless of OS locale", () => {
  expect(formatDue(new Date(2026, 9, 21, 18, 0).toISOString())).toBe(
    "Oct 21, 18:00",
  );
});
it("hides the localized empty input, opens native editing and clears a date", () => {
  function Field() {
    const [value, set] = useState<string | null>(null);
    return <DateTimeInput aria-label="Due date" value={value} onChange={set} />;
  }
  render(<Field />);
  expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Set due date" }));
  const input = screen.getByLabelText("Due date");
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "2026-10-21T18:00" } });
  fireEvent.blur(input);
  expect(screen.getByRole("button", { name: "Oct 21, 18:00" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Clear due date" }));
  expect(screen.getByRole("button", { name: "Set due date" })).toBeVisible();
});
