import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { expect, it } from "vitest";

const dockCss = readFileSync("src/features/brain/brain-dock.css", "utf8");
it("BDW-06 board-key buttons retain small type with at least 28px padded targets", () => {
  const style = document.createElement("style");
  style.textContent = dockCss;
  document.head.append(style);
  const view = render(
    <button type="button" className="brain-board-key">
      JB-12
    </button>,
  );
  try {
    const css = getComputedStyle(view.getByRole("button", { name: "JB-12" }));
    expect(css.minHeight).toBe("28px");
    expect(css.minWidth).toBe("28px");
    expect(css.paddingTop).toBe("5px");
    expect(css.fontSize).toBe("11px");
  } finally {
    style.remove();
  }
});
const controlsCss = readFileSync(
  "src/features/brain/brain-controls.css",
  "utf8",
);
it("empty attachment portals reserve no space before, during or after a take", () => {
  const style = document.createElement("style");
  style.textContent = dockCss + controlsCss;
  document.head.append(style);
  const view = render(
    <div className="brain-composer">
      <textarea aria-label="Draft" />
      <div className="brain-composer-actions">
        <button type="button">Send</button>
      </div>
      <div className="brain-attachment-row" data-testid="attachments" />
    </div>,
  );
  const row = view.getByTestId("attachments");
  const composer = row.parentElement as HTMLElement;
  try {
    expect(getComputedStyle(row).display).toBe("none");
    const take = document.createElement("div");
    take.className = "brain-voice-take";
    take.textContent = "01:50 · 10s left";
    composer.append(take);
    expect(getComputedStyle(row).display).toBe("none");
    expect(composer.lastElementChild).toBe(take);
    const tile = document.createElement("div");
    tile.className = "brain-attachment";
    row.append(tile);
    expect(getComputedStyle(row).display).toBe("grid");
    tile.remove();
    take.remove();
    expect(getComputedStyle(row).display).toBe("none");
  } finally {
    style.remove();
  }
});
it("Access keeps its full intrinsic width while Model absorbs toolbar compression", () => {
  const style = document.createElement("style");
  style.textContent = dockCss + controlsCss;
  document.head.append(style);
  const view = render(
    <div className="brain-composer-actions">
      <div className="brain-session-controls">
        <div
          className="brain-control-anchor brain-model-anchor"
          data-testid="model-anchor"
        >
          <span className="tooltip-wrap">
            <button type="button" className="brain-control-chip">
              Claude Sonnet 4.6 · High
            </button>
          </span>
        </div>
        <div
          className="brain-control-anchor brain-access-anchor"
          data-testid="access-anchor"
        >
          <span className="tooltip-wrap">
            <button
              type="button"
              className="brain-control-chip brain-access-chip"
            >
              Ask first
            </button>
          </span>
        </div>
      </div>
    </div>,
  );
  try {
    expect(getComputedStyle(view.getByTestId("access-anchor")).flexShrink).toBe(
      "0",
    );
    expect(
      getComputedStyle(view.getByRole("button", { name: "Ask first" }))
        .maxWidth,
    ).toBe("none");
    expect(getComputedStyle(view.getByTestId("model-anchor")).flexShrink).toBe(
      "1",
    );
    expect(controlsCss).toMatch(/@container brain-dock \(max-width: 379px\)/);
    expect(controlsCss).toMatch(
      /\.brain-access-chip > span\s*\{\s*display: none;/,
    );
  } finally {
    style.remove();
  }
});
it("docked task drawers start below the top bar and stop at the dock; overlay has no top offset", () => {
  expect(dockCss).toMatch(
    /:root\[data-brain-docked="true"\] body \.drawer-backdrop\s*\{\s*top: 56px;/,
  );
  expect(dockCss).toMatch(
    /body \.drawer-backdrop\s*\{\s*right: var\(--dock-width, 0px\);/,
  );
  const style = document.createElement("style");
  style.textContent = `.drawer-backdrop { position: fixed; top: 0; right: 0; bottom: 0; left: 0; }\n${dockCss}`;
  document.head.append(style);
  const view = render(<div className="drawer-backdrop" data-testid="offset" />);
  try {
    document.documentElement.dataset.brainDocked = "true";
    expect(getComputedStyle(view.getByTestId("offset")).top).toBe("56px");
    document.documentElement.dataset.brainDocked = "false";
    expect(getComputedStyle(view.getByTestId("offset")).top).toBe("0px");
  } finally {
    style.remove();
    delete document.documentElement.dataset.brainDocked;
  }
});
it("restores markdown markers and themes the xterm viewport and unused terminal area", () => {
  expect(dockCss).toMatch(
    /\.brain-markdown ul\s*\{\s*list-style: disc outside;/,
  );
  expect(dockCss).toMatch(
    /\.brain-markdown ol\s*\{\s*list-style: decimal outside;/,
  );
  expect(dockCss).toMatch(
    /\.brain-terminal-host \.xterm \.xterm-viewport[\s\S]*?background-color: var\(--paper\)/,
  );
  expect(dockCss).toMatch(
    /\.brain-terminal-host \.xterm \.xterm-scrollable-element > \.shadow\s*\{\s*box-shadow: none;/,
  );
});
it("permission content uses intrinsic wrapping at 520px without shrinking pill, counts or action", () => {
  const style = document.createElement("style");
  style.textContent =
    readFileSync("src/styles/workflow.css", "utf8") +
    readFileSync("src/features/execution/execution-controls.css", "utf8");
  document.head.append(style);
  const view = render(
    <section
      className="execution-controls"
      data-state="paused"
      style={{ width: 520 }}
      data-testid="permission"
    >
      <div className="execution-heading">
        <span className="small">Worker permission</span>
        <span className="stamp">NEW WORK PAUSED</span>
        <span className="small" data-testid="counts">
          9 Ready · 3 In progress
        </span>
      </div>
      <div className="execution-actions" data-testid="actions">
        <button type="button">Start epic</button>
        <span className="small" data-testid="explanation">
          Start lets agents take Ready tasks; it does not launch them.
        </span>
      </div>
    </section>,
  );
  try {
    expect(getComputedStyle(view.getByTestId("permission")).display).toBe(
      "flex",
    );
    expect(getComputedStyle(view.getByTestId("permission")).flexWrap).toBe(
      "wrap",
    );
    expect(getComputedStyle(view.getByTestId("counts")).whiteSpace).toBe(
      "nowrap",
    );
    expect(getComputedStyle(view.getByTestId("explanation")).flexBasis).toBe(
      "100%",
    );
  } finally {
    style.remove();
  }
});
it.each(["Start chat", "Open terminal"])(
  "empty-state primary action %s retains the shared 40px height without flex shrinking",
  (text) => {
    const style = document.createElement("style");
    style.textContent = `.button { height: 40px; }\n${dockCss}`;
    document.head.append(style);
    const view = render(
      <div className="brain-empty" style={{ height: 180 }}>
        <p>Connection choices occupy the scroll container</p>
        <button type="button" className="button primary">
          {text}
        </button>
      </div>,
    );
    try {
      const computed = getComputedStyle(
        view.getByRole("button", { name: text }),
      );
      expect(computed.height).toBe("40px");
      expect(computed.minHeight).toBe("40px");
      expect(computed.flexShrink).toBe("0");
    } finally {
      style.remove();
    }
  },
);
it("connection fields keep helper/status spacing together and section labels separate from rows", () => {
  const style = document.createElement("style");
  style.textContent = dockCss;
  document.head.append(style);
  const view = render(
    <>
      <div className="brain-connection-dialog">
        <form className="brain-connection-form" data-testid="form">
          <div className="brain-field" data-testid="field">
            <label>
              API key
              <input type="password" />
            </label>
            <small>No key</small>
          </div>
        </form>
      </div>
      <div className="brain-connection-group">
        <h3>Chat</h3>
        <h4>API</h4>
        <div className="brain-connection-row">
          <div>
            <small data-testid="status">Ready</small>
          </div>
          <button type="button" className="brain-visibility-action">
            Hide
          </button>
        </div>
      </div>
    </>,
  );
  try {
    expect(getComputedStyle(view.getByTestId("form")).gap).toBe("16px");
    expect(getComputedStyle(view.getByTestId("field")).gap).toBe("5px");
    expect(
      getComputedStyle(view.getByRole("heading", { name: "Chat" }))
        .textTransform,
    ).toBe("uppercase");
    expect(
      parseFloat(
        getComputedStyle(view.getByRole("heading", { name: "API" }))
          .letterSpacing,
      ),
    ).toBeGreaterThan(0);
    expect(getComputedStyle(view.getByTestId("status")).fontWeight).toBe("400");
    expect(
      getComputedStyle(view.getByRole("button", { name: "Hide" })).fontWeight,
    ).toBe("400");
  } finally {
    style.remove();
  }
});
