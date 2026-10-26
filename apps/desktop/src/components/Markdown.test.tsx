import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Markdown } from "./Markdown";

const parse = vi.hoisted(() => vi.fn());
vi.mock("react-markdown", async (original) => {
  const actual = await original<typeof import("react-markdown")>();
  return {
    ...actual,
    default: (props: Parameters<typeof actual.default>[0]) => {
      parse(props.children);
      return <actual.default {...props} />;
    },
  };
});
it("Markdown retains content on parent updates and renders revised text", async () => {
  await import("./MarkdownContent");
  const view = (zoom: number, text = "## Original") => (
    <div data-zoom={zoom}>
      <Markdown>{text}</Markdown>
    </div>
  );
  const { rerender } = render(view(1));
  await screen.findByRole("heading", { name: "Original" });
  parse.mockClear();
  rerender(view(1.01));
  rerender(view(1.02));
  expect(screen.getByRole("heading", { name: "Original" })).toBeVisible();
  parse.mockClear();
  rerender(view(1.02, "## Revised"));
  await screen.findByRole("heading", { name: "Revised" });
  expect(parse).toHaveBeenCalledExactlyOnceWith("## Revised");
});
