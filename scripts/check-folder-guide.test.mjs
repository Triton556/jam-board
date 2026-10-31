import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const skill = read("integrations/agent-skill/jam-board/SKILL.md");
const operations = read("integrations/agent-skill/jam-board/references/operations.md");
const guide = `${skill}\n${operations}`;
const tools = new Map(readContract().map((tool) => [tool.name, tool]));
function readContract() {
  return JSON.parse(read("test-visuals/round11/r11-c/mcp-tools.json"));
}

// Validate the schema features exercised by these examples without a dependency
// or a running MCP server; this is not a general JSON Schema implementation.
function validate(value, schema, root = schema) {
  if (schema.$ref) return validate(value, root.$defs[schema.$ref.split("/").at(-1)], root);
  if (schema.anyOf) {
    assert.ok(schema.anyOf.some((option) => {
      try { validate(value, option, root); return true; } catch { return false; }
    }), "no anyOf branch matches");
    return;
  }
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const types = [].concat(schema.type ?? []);
  assert.ok(types.includes(type) || (type === "number" && Number.isInteger(value) && types.includes("integer")), `unexpected type ${type}`);
  if (schema.enum) assert.ok(schema.enum.includes(value), `unknown enum ${value}`);
  if (type === "object") {
    for (const field of schema.required ?? []) assert.ok(Object.hasOwn(value, field), `missing ${field}`);
    for (const [field, item] of Object.entries(value)) {
      const child = schema.properties?.[field];
      assert.ok(child || schema.additionalProperties !== false, `unknown argument ${field}`);
      if (child) validate(item, child, root);
    }
  }
  if (type === "array") {
    if (schema.minItems) assert.ok(value.length >= schema.minItems);
    if (schema.maxItems) assert.ok(value.length <= schema.maxItems);
    for (const item of value) validate(item, schema.items, root);
  }
  if (type === "string") {
    if (schema.minLength) assert.ok(value.length >= schema.minLength);
    if (schema.maxLength) assert.ok(value.length <= schema.maxLength);
  }
}
function validateCall(name, args) {
  assert.ok(tools.has(name), `unknown tool ${name}`);
  validate(args, tools.get(name).inputSchema);
}

test("guide tool names, inline arguments and all JSON examples match the frozen contract", () => {
  // These are server prompts, not callable tools. Every other snake_case name
  // appearing in either document must belong to the frozen tool inventory.
  const prompts = new Set(["plan_epic", "work_on_next_task", "review_task"]);
  for (const name of new Set(guide.match(/\b[a-z]+(?:_[a-z]+)+\b/g))) {
    assert.ok(tools.has(name) || prompts.has(name) || ["board_file", "linked_file", "to_edit"].includes(name), `unknown guide name ${name}`);
  }
  const aliases = { epic: "create_epic", story: "create_story", task: "create_task", claim: "claim_task", report: "submit_report", review: "review_task" };
  let calls = 0;
  for (const [, source] of guide.matchAll(/```json\s*([\s\S]*?)```/g)) {
    const example = JSON.parse(source);
    const entries = Array.isArray(example) ? example : Object.entries(example).map(([alias, args]) => ({ tool: aliases[alias], arguments: args }));
    for (const entry of entries) { validateCall(entry.tool, entry.arguments); calls++; }
  }
  assert.ok(calls >= 13, "examples were removed");
  for (const [, name, args] of guide.matchAll(/\b([a-z]+(?:_[a-z]+)+)\s+\{([^{}]+)\}/g)) {
    const schema = tools.get(name)?.inputSchema;
    assert.ok(schema, `unknown inline tool ${name}`);
    const fields = args.split(",").map((field) => field.trim().split(":")[0]);
    for (const field of fields) assert.ok(schema.properties[field], `${name}: unknown ${field}`);
    for (const field of schema.required ?? []) assert.ok(fields.includes(field), `${name}: missing ${field}`);
  }
  // Guard the validator itself against the failures this check is intended to catch.
  assert.throws(() => validateCall("resolve_file", {}), /missing assetId/);
  assert.throws(() => validateCall("resolve_file", { assetId: "x", cwd: "x" }), /unknown argument cwd/);
  assert.throws(() => validateCall("register_file", { storageType: "board", requestId: "x" }), /unknown enum/);
});

test("folder context and copy/link guidance use real fields and manifest rules", () => {
  const fields = tools.get("get_session_context").outputSchema.properties;
  for (const field of ["projectFolder", "repositoryRoot", "workingDirectory", "folderRules", "manifestRevision"]) {
    assert.ok(fields[field]);
    assert.ok(guide.includes(`\x60${field}\x60`));
  }
  for (const text of ["jamboard.json", "board.json", ".state/", "Never edit", "generated", "board_file", "linked_file", "pathBase", "absolute", "storageType", "future copies only", "sprite→images", "model→models"]) assert.ok(guide.includes(text), text);
});

test("roles retain CAS, request identity and unlink safety", () => {
  for (const name of ["link_task_file", "set_task_file_role", "unlink_task_file"]) {
    const schema = tools.get(name).inputSchema;
    for (const field of ["taskKey", "assetId", "expectedClaimGeneration", "expectedUpdatedAt", "requestId"]) assert.ok(schema.required.includes(field));
  }
  for (const text of ["change this file", "do not change it", "attach what you produced", "never deletes bytes", "identical payload", "reread/reconcile", "claimGeneration", "updatedAt"]) assert.ok(guide.includes(text), text);
});

test("boat example resolves before registering and linking a result; failures stay explicit", () => {
  const example = JSON.parse(operations.match(/### Worked example[\s\S]*?```json\s*([\s\S]*?)```/)[1]);
  assert.deepEqual(example.map((call) => call.tool), ["get_task", "resolve_file", "register_file", "get_task", "link_task_file"]);
  assert.equal(example[1].arguments.workingDirectory, "$workingDirectory");
  assert.equal(example[2].arguments.storageType, "board_file");
  assert.equal(example[4].arguments.role, "result");
  for (const text of ["canonical board anchor", "same Git common-dir", "unrelated repository is refused", "resolutionBasis", "status:\"missing\"", "status:\"unreadable\"", "status:\"unknown\"", "not an availability status", "ask if outside"]) assert.ok(operations.includes(text), text);
});

test("guide preserves human execution and client lifecycle boundaries", () => {
  for (const text of ["does not start work", "does not launch or wake", "is not Start", "never filesystem access or execution permission", "do not stop them on the user", "do not grant Start or create agent sessions"]) assert.ok(guide.includes(text), text);
  // Detect affirmative instructions; existing descriptions of human Start and
  // client ownership are intentional, not instructions to launch anything.
  assert.doesNotMatch(guide, /(?:^|\n)\s*(?:\d+\.\s*|-\s*)?(?:install|launch|start|run)\s+(?:an?\s+|the\s+)?(?:agent|adapter|session|installer|codex|claude)\b/im);
  assert.doesNotMatch(guide, /\bnpx\b|npm install|pnpm add|codex exec|claude -p/);
});
