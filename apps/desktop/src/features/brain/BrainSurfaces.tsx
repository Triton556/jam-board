import type { ComponentProps } from "react";
import { createBrainSurface } from "./BrainLazy";
import { retryBrainImport } from "./brain-import";

const loadChat = retryBrainImport(() => import("./BrainChat"));
const loadTerminal = retryBrainImport(() => import("./BrainTerminal"));

export const LazyBrainChat = createBrainSurface<
  ComponentProps<typeof import("./BrainChat").BrainChat>
>(() => loadChat().then((module) => ({ default: module.BrainChat })), "chat");
export const LazyBrainTerminal = createBrainSurface<
  ComponentProps<typeof import("./BrainTerminal").BrainTerminal>
>(
  () =>
    loadTerminal().then((module) => ({
      default: module.BrainTerminal,
    })),
  "terminal",
);
