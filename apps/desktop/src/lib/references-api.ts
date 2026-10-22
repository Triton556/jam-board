import type {
  AddReference,
  CanvasArchive,
  CanvasGeometry,
  FramePatch_Serialize,
  RefEdge,
  ReferenceCanvas,
  ReferencePatch_Serialize,
  RefFrame,
  RefItem,
} from "../bindings";

export type { RefEdge, ReferenceCanvas, RefFrame, RefItem };
export type ReferenceInput = Pick<AddReference, "kind"> & Partial<AddReference>;
export type ReferenceContentExpectation = { title: string; caption: string };
export interface ReferencesApi {
  referenceCanvas(): Promise<ReferenceCanvas>;
  addReference(input: ReferenceInput, untitled?: boolean): Promise<RefItem>;
  updateReference(
    id: string,
    patch: ReferencePatch_Serialize,
    expected?: ReferenceContentExpectation,
  ): Promise<RefItem>;
  linkReference(id: string, key: string): Promise<RefItem>;
  canvasGeometry(input: CanvasGeometry): Promise<RefItem>;
  canvasArchive(input: CanvasArchive): Promise<void>;
  createRefFrame(
    input: Partial<RefFrame> & Pick<RefFrame, "title" | "x" | "y">,
  ): Promise<RefFrame>;
  updateRefFrame(id: string, patch: FramePatch_Serialize): Promise<RefFrame>;
  createRefEdge(from: string, to: string, label: string): Promise<RefEdge>;
  updateRefEdge(id: string, label: string): Promise<RefEdge>;
  referenceMetadata(id: string, metadata: string): Promise<RefItem>;
  referenceMedia(id: string): Promise<string | null>;
  clipboardReference(bytes: number[], x: number, y: number): Promise<RefItem>;
  fetchReferencePreview(id: string): Promise<RefItem>;
  clearReferencePreview(id: string): Promise<RefItem>;
  canvasViewport(value?: string): Promise<string | null>;
}
