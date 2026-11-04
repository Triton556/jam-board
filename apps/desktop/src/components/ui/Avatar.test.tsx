import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import chatgptIcon from "../../assets/providers/chatgpt.png";
import claudeIcon from "../../assets/providers/claude.png";
import { Avatar, AvatarMembersContext } from "./index";

const worker = {
  id: "worker",
  kind: "agent",
  handle: "coddx-worker-jb-12",
  name: "coddx-worker-jb-12",
  color: "#5B8DEF",
};
const customPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4J2j8HwAFlQJC8Q1l3gAAAABJRU5ErkJggg==";

describe("M03 avatars", () => {
  it("uses the reported provider for old members without a custom avatar", () => {
    const { rerender } = render(
      <Avatar member={{ ...worker, client: "codex" }} />,
    );
    const image = () => screen.getByRole("img").querySelector("img");
    expect(image()).toHaveAttribute("src", chatgptIcon);
    rerender(<Avatar member={{ ...worker, client: "claude-code" }} />);
    expect(image()).toHaveAttribute("src", claudeIcon);
    rerender(<Avatar member={{ ...worker, client: "other" }} />);
    expect(image()).toBeNull();
    expect(
      within(screen.getByRole("img")).getByTestId("agent-badge"),
    ).toBeVisible();
  });

  it("shows a custom image on a compact member reference and restores the default on clear", () => {
    const avatar = (value: string | null) => (
      <AvatarMembersContext
        value={[{ ...worker, client: "codex", avatar: value }]}
      >
        <Avatar member={worker} />
      </AvatarMembersContext>
    );
    const { rerender } = render(avatar(customPng));
    const image = () => screen.getByRole("img").querySelector("img");
    expect(image()).toHaveAttribute("src", customPng);
    rerender(avatar(null));
    expect(image()).toHaveAttribute("src", chatgptIcon);
  });

  it("keeps a human emoji and never assigns a provider image to a human", () => {
    render(
      <Avatar
        member={{ ...worker, kind: "human", client: "codex", avatar: "🪴" }}
      />,
    );
    expect(screen.getByRole("img")).toHaveTextContent("🪴");
    expect(screen.getByRole("img").querySelector("img")).toBeNull();
  });
});
