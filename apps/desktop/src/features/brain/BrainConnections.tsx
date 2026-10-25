import type { ComponentProps } from "react";
import { Dialog } from "../../components/ui";
import { BrainLoadState, createBrainSurface } from "./BrainLazy";
import { retryBrainImport } from "./brain-import";

const loadConnections = retryBrainImport(
  () => import("./BrainConnectionsPanel"),
);

export const BrainConnections = createBrainSurface<Record<string, never>>(
  () =>
    loadConnections().then((module) => ({
      default: module.BrainConnections,
    })),
  "connections",
);
export const ConnectionEditor = createBrainSurface<
  ComponentProps<typeof import("./BrainConnectionsPanel").ConnectionEditor>
>(
  () =>
    loadConnections().then((module) => ({
      default: module.ConnectionEditor,
    })),
  "connection editor",
  (props, retry) => (
    <Dialog title="Connection" onClose={props.close}>
      <BrainLoadState
        label="connection editor"
        retry={retry}
        close={props.close}
      />
    </Dialog>
  ),
);
