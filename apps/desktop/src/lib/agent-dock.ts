import { mockDockApi } from "./agent-dock-mock";
import { tauriDockApi } from "./agent-dock-tauri";

export const agentDockApi =
  import.meta.env.VITE_MOCK_BRIDGE === "1" ? mockDockApi : tauriDockApi;
