import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { expect, it } from "vitest";

it("file card ghost action aligns its content and compact button to the left", () => {
  const { getByRole } = render(
    <>
      <style>
        {readFileSync("src/features/references/references.css", "utf8")}
      </style>
      <article className="reference-card">
        <div className="reference-file">
          <button type="button" className="button ghost reference-text-action">
            Show in folder
          </button>
        </div>
      </article>
    </>,
  );
  const action = getByRole("button", { name: "Show in folder" });
  expect(getComputedStyle(action).justifyContent).toBe("flex-start");
  expect(getComputedStyle(action).justifySelf).toBe("start");
  expect(getComputedStyle(action).textAlign).toBe("left");
});

it("promotes only the viewport during a gesture and leaves live content unpromoted at rest", () => {
  const { container } = render(
    <>
      <style>
        {readFileSync("src/features/references/references.css", "utf8")}
      </style>
      <section className="references-page">
        <div className="react-flow__viewport">
          <div className="react-flow__node-reference" />
          <div className="react-flow__node-frame" />
          <div className="react-flow__edges" />
          <div className="react-flow__edgelabel-renderer" />
          <div className="react-flow__node-reference">
            <div className="reference-overview-hit" />
          </div>
          <canvas className="reference-overview-scene" />
        </div>
      </section>
    </>,
  );
  const root = container.querySelector(".references-page");
  const viewport = container.querySelector(".react-flow__viewport");
  if (!root || !viewport) throw Error("Missing canvas");
  const live = container.querySelectorAll(
    ".react-flow__node-reference, .react-flow__node-frame, .react-flow__edges, .react-flow__edgelabel-renderer",
  );
  expect(getComputedStyle(viewport).willChange).not.toContain("transform");
  root.classList.add("reference-viewport-moving");
  expect(getComputedStyle(viewport).willChange).toBe("transform");
  for (const element of live)
    expect(getComputedStyle(element).willChange).not.toContain("transform");
  root.classList.remove("reference-viewport-moving");
  expect(getComputedStyle(viewport).willChange).not.toContain("transform");
  expect(
    getComputedStyle(
      container.querySelector(".reference-overview-scene") as Element,
    ).willChange,
  ).toBe("transform");
});
