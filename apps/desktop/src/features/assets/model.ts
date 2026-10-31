import { z } from "zod";
export const assetKinds = [
  "sprite",
  "audio",
  "level",
  "font",
  "model",
  "document",
  "other",
] as const;
export function assetKind(location: string) {
  const ext = location.split(/[?#]/)[0]?.split(".").at(-1)?.toLowerCase();
  return ["png", "jpg", "jpeg", "webp", "gif", "aseprite"].includes(ext ?? "")
    ? "sprite"
    : ["wav", "ogg", "mp3"].includes(ext ?? "")
      ? "audio"
      : ["ttf", "otf", "woff2"].includes(ext ?? "")
        ? "font"
        : ["tmx", "ldtk"].includes(ext ?? "")
          ? "level"
          : [
                "glb",
                "gltf",
                "obj",
                "fbx",
                "blend",
                "stl",
                "ply",
                "dae",
                "3mf",
                "usd",
                "usda",
                "usdc",
                "usdz",
              ].includes(ext ?? "")
            ? "model"
            : [
                  "md",
                  "txt",
                  "pdf",
                  "doc",
                  "docx",
                  "rtf",
                  "odt",
                  "csv",
                  "yaml",
                  "yml",
                ].includes(ext ?? "")
              ? "document"
              : "other";
}
export function assetName(location: string) {
  return (
    location
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.[^.]+$/, "") ?? "Untitled asset"
  );
}
export const assetSchema = z
  .object({
    mode: z.enum(["File", "URL"]),
    kind: z.enum(assetKinds),
    name: z.string().trim().min(1, "Give the asset a name").max(140),
    location: z.string().trim().min(1, "Choose a file or enter a URL"),
    notes: z.string().max(4000),
  })
  .refine((v) => v.mode !== "URL" || /^https?:\/\/[^\s]+$/i.test(v.location), {
    path: ["location"],
    message: "Use an http:// or https:// URL",
  });
