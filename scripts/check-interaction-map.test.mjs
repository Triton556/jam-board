import assert from "node:assert/strict";
import test from "node:test";
import { checkInteractionMaps, validateInteractionMap } from "./check-interaction-map.mjs";

test("canonical human, agent and acceptance definitions have no reused IDs", () => {
  assert.equal(checkInteractionMaps().length, 3);
});
test("a duplicate definition fails even when its new label differs", () => {
  assert.throws(() => validateInteractionMap("acceptance", "| AC12 | References |\n| AC12 | Human summary |"), /duplicate stable ID AC12/);
});
test("prose references and separate sub-actions do not redefine parent IDs", () => {
  assert.deepEqual(validateInteractionMap("agent", "| AG02 | Refine |\n| AG02.setup | Setup |\n| AG02.continue | Continue |\nAG02 and AG02.setup remain relevant."), ["AG02", "AG02.setup", "AG02.continue"]);
});
test("retired definitions retain their identity and an empty inventory fails", () => {
  assert.deepEqual(validateInteractionMap("human", "| P07 | Retired; replaced elsewhere |"), ["P07"]);
  assert.throws(() => validateInteractionMap("empty", "# Nothing"), /no stable/);
});
