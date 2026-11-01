import { invoke } from "@tauri-apps/api/core";
import type {
  CollectKeptInput,
  CollectKeptResult,
  ReferencePatch_Serialize,
  ReferenceVerdictInput,
  RefFrame,
  RefItem,
} from "../bindings";
import { api } from "./api";
export interface MoodboardApi {
  feedback(input: ReferenceVerdictInput): Promise<RefItem>;
  update(id: string, patch: ReferencePatch_Serialize): Promise<RefItem>;
  send(frameId: string): Promise<RefFrame>;
  collect(input: CollectKeptInput): Promise<CollectKeptResult>;
}
export const nativeMoodboardApi: MoodboardApi = {
  feedback: (input) => invoke("set_reference_verdict", { input }),
  update: (itemId, patch) =>
    invoke("update_reference", { input: { itemId, ...patch } }),
  send: (frameId) => invoke("send_reference_review", { input: { frameId } }),
  collect: (input) => invoke("collect_kept_references", { input }),
};
async function backend() {
  return api.moodboard();
}
export const moodboardApi: MoodboardApi = {
  feedback: async (input) => (await backend()).feedback(input),
  update: async (id, patch) => (await backend()).update(id, patch),
  send: async (id) => (await backend()).send(id),
  collect: async (input) => (await backend()).collect(input),
};
