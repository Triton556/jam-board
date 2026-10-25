import type * as Opener from "@tauri-apps/plugin-opener";
import { vi } from "vitest";

export const openUrl = vi
  .fn<typeof Opener.openUrl>()
  .mockResolvedValue(undefined);
export const openPath = vi
  .fn<typeof Opener.openPath>()
  .mockResolvedValue(undefined);
export const revealItemInDir = vi
  .fn<typeof Opener.revealItemInDir>()
  .mockResolvedValue(undefined);
