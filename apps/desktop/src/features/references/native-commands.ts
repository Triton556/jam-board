import { openPath } from "@tauri-apps/plugin-opener";
import {
  type ApiError_Serialize,
  commands,
  type ReferenceVerdict,
} from "../../bindings";
import { JamError } from "../../lib/types";

async function result<T>(
  promise: Promise<
    { status: "ok"; data: T } | { status: "error"; error: ApiError_Serialize }
  >,
): Promise<T> {
  const value = await promise;
  if (value.status === "error")
    throw new JamError(
      value.error.code,
      value.error.message,
      value.error.field,
    );
  return value.data;
}
export const openReferenceFile = openPath;
export const setReferenceVerdict = (
  itemId: string,
  verdict: ReferenceVerdict | null,
) => result(commands.setReferenceVerdict({ itemId, verdict }));
export const linkRefFrame = (frameId: string, targetKey: string) =>
  result(commands.linkRefFrame({ frameId, targetKey }));
export const unlinkRefFrame = (frameId: string, targetKey: string) =>
  result(commands.unlinkRefFrame({ frameId, targetKey }));
export const unlinkReference = (itemId: string, targetKey: string) =>
  result(commands.unlinkReference({ itemId, targetKey }));
export const nativeReferenceApi = {
  openReferenceFile,
  setReferenceVerdict,
  linkRefFrame,
  unlinkRefFrame,
  unlinkReference,
};
