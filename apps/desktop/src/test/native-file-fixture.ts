import type { Asset, FileAsset } from "../bindings";

/** Contract fixture for legacy external files, without a filesystem or native opener. */
export function nativeFileFixture(asset: Asset): FileAsset {
  return {
    ...asset,
    storageType: "linked_file",
    pathBase: "absolute",
    storedPath: asset.location,
    originalName: asset.name,
    mimeType: null,
    byteSize: null,
    contentHash: null,
    contentRevision: 1,
    metadata: {},
    resolution: {
      storageType: "linked_file",
      pathBase: "absolute",
      storedPath: asset.location,
      resolvedPath: asset.location,
      worktreeRoot: null,
      resolutionBasis: "absolute",
      status: "available",
      checkedAt: "2026-10-31T00:00:00Z",
    },
  };
}
