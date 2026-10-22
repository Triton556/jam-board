import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { PlanPage } from "./PlanPage";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => "/plan/JB-E1",
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  vi.restoreAllMocks();
  await mockApi.resetDemo();
});
const choices = [
  { label: "Participation", field: "participation", last: "autonomous" },
  { label: "Separate reviewer", field: "reviewer", last: "stages" },
] as const;
function view() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PlanPage
        epicKey="JB-E1"
        search={{}}
        openTask={vi.fn()}
        openStory={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
it.each(choices)(
  "$label labels only its trigger; each choice keeps its own name and pointer value",
  async ({ label, field, last }) => {
    const user = userEvent.setup(),
      update = vi.spyOn(mockApi, "updateEpic");
    view();
    const trigger = await screen.findByRole("combobox", { name: label });
    const associatedLabel = screen.getByText(label, { selector: "label" });
    expect(associatedLabel).toHaveAttribute("for", trigger.id);
    await user.click(trigger);
    const list = screen.getByRole("listbox", { name: `${label} options` });
    expect(list.closest("label")).toBeNull();
    for (const option of within(list).getAllByRole("option")) {
      expect(option).toHaveAccessibleName(option.textContent?.trim());
    }
    await user.click(within(list).getByRole("option", { name: last }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("JB-E1", {
        [field]: last,
      }),
    );
    await waitFor(() => expect(trigger).toHaveTextContent(last));
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect((await mockApi.getEpic("JB-E1")).epic[field]).toBe(last);
  },
);
it.each(choices)(
  "$label retains Space/End/Enter choice and Escape cancellation with trigger focus",
  async ({ label, field, last }) => {
    const user = userEvent.setup(),
      update = vi.spyOn(mockApi, "updateEpic");
    view();
    const trigger = await screen.findByRole("combobox", { name: label });
    trigger.focus();
    await user.keyboard(" {End}{Enter}");
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("JB-E1", {
        [field]: last,
      }),
    );
    expect(trigger).toHaveFocus();
    await user.keyboard(" {Home}{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(update).toHaveBeenCalledTimes(1);
    expect((await mockApi.getEpic("JB-E1")).epic[field]).toBe(last);
  },
);
