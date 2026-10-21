import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { roughFramePaths } from "./references/rough";
import { ChangesEditor } from "./task/BriefEditor";

it("the required change field uses an accessible marker rather than a redundant stamp", () => {
  const { container } = render(
    <ChangesEditor
      value={[
        {
          title: "Keep the board readable",
          required: "Use one visible requirement marker",
          now: "",
          cause: "",
          where: "",
          follow: "",
          keep: "",
        },
      ]}
      onChange={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("textbox", { name: "Change 1 required" }),
  ).toHaveAttribute("aria-required", "true");
  expect(container.querySelector(".stamp")).toBeNull();
});

it("frame outlines use cached rough curves keyed by dimensions", () => {
  const outline = roughFramePaths(800, 600);
  expect(outline).toHaveLength(1);
  expect(outline).toBe(roughFramePaths(800, 600));
  expect(outline.join("")).toContain("C");
  expect(roughFramePaths(900, 600)).not.toEqual(outline);
});
