import rough from "roughjs";

const generator = rough.generator(),
  cache = new Map<string, string[]>();
export function roughFramePaths(width: number, height: number) {
  const key = `frame:${width}:${height}`;
  let paths = cache.get(key);
  if (!paths) {
    paths = generator
      .toPaths(
        generator.rectangle(2, 2, width - 4, height - 4, {
          roughness: 1.2,
          bowing: 1,
          seed: 14,
          strokeWidth: 1.5,
        }),
      )
      .map((p) => p.d);
    if (cache.size > 1500) cache.clear();
    cache.set(key, paths);
  }
  return paths;
}
export function roughPaths(path: string) {
  let paths = cache.get(path);
  if (!paths) {
    paths = generator
      .toPaths(
        generator.path(path, {
          roughness: 1.2,
          bowing: 1,
          seed: 14,
          strokeWidth: 1.3,
          fill: "none",
        }),
      )
      .map((p) => p.d);
    if (cache.size > 1500) cache.clear();
    cache.set(path, paths);
  }
  return paths;
}
