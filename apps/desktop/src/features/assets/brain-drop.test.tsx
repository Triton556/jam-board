import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockApi } from "../../lib/mock-bridge";
import { tauriApi } from "../../lib/tauri-bridge";
import { AssetsPage } from "./AssetsPage";

const native = vi.hoisted(() => ({
  drop: null as
    | null
    | ((event: {
        payload: {
          type: "drop";
          paths: string[];
          position: { x: number; y: number };
        };
      }) => void),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (drop: typeof native.drop) => {
      native.drop = drop;
      return () => {};
    },
  }),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({}),
}));
beforeEach(async () => {
  mockApi.setLatency(0);
  await mockApi.resetDemo();
});
afterEach(() => {
  document.querySelectorAll("[data-native-drop-test]").forEach((node) => {
    node.remove();
  });
  vi.restoreAllMocks();
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 1,
  });
});
it.each([1, 1.5, 2])(
  "H-BD14 Assets ignores dock/composer drops at DPR %s and still imports its own drops",
  async (dpr) => {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: dpr,
    });
    vi.spyOn(mockApi, "onFileDrop").mockImplementation(tauriApi.onFileDrop);
    const create = vi.spyOn(mockApi, "createAsset");
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <AssetsPage openTask={() => {}} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Assets" });
    await waitFor(() => expect(native.drop).not.toBeNull());
    for (const [index, [attribute, value]] of (
      [
        ["id", "brain-dock"],
        ["data-brain-dock", ""],
        ["data-board-ref-drop", "brain-composer"],
      ] as const
    ).entries()) {
      const node = document.createElement("aside");
      node.dataset.nativeDropTest = "";
      node.setAttribute(attribute, value);
      document.body.append(node);
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect({
          x: 500 + index * 200,
          y: 0,
          width: 200,
          height: 700,
        }),
      );
      await act(async () =>
        native.drop?.({
          payload: {
            type: "drop",
            paths: ["C:/mock/brain.png"],
            position: { x: (600 + index * 200) * dpr, y: 300 * dpr },
          },
        }),
      );
    }
    expect(create).not.toHaveBeenCalled();
    await act(async () =>
      native.drop?.({
        payload: {
          type: "drop",
          paths: ["C:/mock/asset.png"],
          position: { x: 100 * dpr, y: 100 * dpr },
        },
      }),
    );
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ location: "C:/mock/asset.png" }),
    );
  },
);
