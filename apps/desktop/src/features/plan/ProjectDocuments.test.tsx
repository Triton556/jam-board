import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProjectDocuments } from "./ProjectDocuments";

vi.mock("../files/ScopeDocuments", () => ({
  DocumentStrip: ({ scope }: { scope: { type: string } }) => (
    <div>{scope.type} documents</div>
  ),
}));
it("mounts the shared document strip at project scope without a key", () => {
  render(<ProjectDocuments />);
  screen.getByText("project documents");
  expect(screen.queryByText("epic documents")).not.toBeInTheDocument();
});
