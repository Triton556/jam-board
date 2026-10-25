import { retryBrainImport } from "./brain-import";

const loadPanel = retryBrainImport(() => import("./BrainDock"));
/** Panel module boundary; importing the shell never fetches its UI dependencies. */
export function loadDockPanel() {
  return loadPanel().then((module) => ({
    default: module.BrainDock,
  }));
}
