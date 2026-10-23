import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const maps = ["human-interactions", "agent-actions", "acceptance-matrix"];
/** Definition rows only; references in prose may repeat an existing stable ID. */
export function validateInteractionMap(name, source) {
  const ids = [];
  for (const line of source.split("\n")) {
    const id = line.match(/^\|\s*([A-Z]{1,2}\d{2}(?:\.[a-z]+)?)\s*\|/)?.[1];
    if (!id) continue;
    if (ids.includes(id)) throw new Error(`${name}: duplicate stable ID ${id}`);
    ids.push(id);
  }
  if (!ids.length) throw new Error(`${name}: no stable action/acceptance definitions`);
  return ids;
}
export function checkInteractionMaps(root = new URL("../", import.meta.url)) {
  return maps.map((name) => ({
    name,
    count: validateInteractionMap(name, readFileSync(new URL(`docs/agents/${name}.md`, root), "utf8")).length,
  }));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  for (const result of checkInteractionMaps()) console.log(`${result.name}: ${result.count} unique definitions`);
}
