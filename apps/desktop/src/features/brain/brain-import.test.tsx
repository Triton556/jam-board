import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createBrainSurface } from "./BrainLazy";
import { retryBrainImport } from "./brain-import";

it("two rejected chunk requests recover on a third fresh request without losing the surface props", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  const url = new URL("/assets/BrainDock-test.js", location.href).href;
  const failure = () =>
    new TypeError(`Failed to fetch dynamically imported module: ${url}`);
  const original = vi.fn().mockRejectedValue(failure());
  const requests: string[] = [];
  const cached = new Map<
    string,
    Promise<{ default: (props: { draft: string }) => React.ReactNode }>
  >();
  const fresh = vi.fn((url: string) => {
    requests.push(url);
    if (!cached.has(url))
      cached.set(
        url,
        requests.length === 1
          ? Promise.reject(failure())
          : Promise.resolve({
              default: ({ draft }) => (
                <textarea aria-label="Retained draft" defaultValue={draft} />
              ),
            }),
      );
    return cached.get(url) as Promise<{
      default: (props: { draft: string }) => React.ReactNode;
    }>;
  });
  const Surface = createBrainSurface<{ draft: string }>(
    retryBrainImport(original, fresh),
    "brain dock",
  );
  try {
    const view = render(<Surface draft="Keep this draft" />);
    await screen.findByText("Could not load brain dock.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Could not load brain dock.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("textbox", { name: "Retained draft" }),
    ).toHaveValue("Keep this draft");
    expect(original).toHaveBeenCalledOnce();
    expect(fresh).toHaveBeenCalledTimes(2);
    expect(new Set(requests).size).toBe(2);
    for (const request of requests) {
      expect(new URL(request).pathname).toBe("/assets/BrainDock-test.js");
      expect(new URL(request).searchParams.get("jam_retry")).toBeTruthy();
    }
    view.unmount();
    render(<Surface draft="Reopened draft" />);
    expect(
      await screen.findByRole("textbox", { name: "Retained draft" }),
    ).toHaveValue("Reopened draft");
    expect(original).toHaveBeenCalledOnce();
    expect(fresh).toHaveBeenCalledTimes(2);
  } finally {
    report.mockRestore();
  }
});

it("does not import a foreign URL from an exception", async () => {
  const error = TypeError(
    "Failed to fetch dynamically imported module: https://example.invalid/BrainDock.js",
  );
  const original = vi.fn().mockRejectedValue(error),
    fresh = vi.fn();
  const load = retryBrainImport(original, fresh);
  await expect(load()).rejects.toBe(error);
  await expect(load()).rejects.toBe(error);
  expect(original).toHaveBeenCalledTimes(2);
  expect(fresh).not.toHaveBeenCalled();
});
