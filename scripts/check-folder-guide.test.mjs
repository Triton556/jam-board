import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const skill = read("integrations/agent-skill/jam-board/SKILL.md");
const operations = read(
  "integrations/agent-skill/jam-board/references/operations.md",
);
const guide = `${skill}\n${operations}`;
const catalogCounts = new Map();
const tools = new Map(readContract().map((tool) => [tool.name, tool]));
function readContract() {
  const merged = new Map();
  for (const path of [
    "test-visuals/round12/R12-C/mcp-tools.json",
    "test-visuals/round12/R12-M/mcp-tools.json",
  ]) {
    const catalog = JSON.parse(read(path));
    const entries = catalog.tools ?? catalog;
    catalogCounts.set(path, entries.length);
    for (const tool of entries) {
      const previous = merged.get(tool.name);
      merged.set(
        tool.name,
        previous
          ? {
              ...tool,
              inputSchema: {
                ...previous.inputSchema,
                ...tool.inputSchema,
                properties: {
                  ...previous.inputSchema.properties,
                  ...tool.inputSchema.properties,
                },
                $defs: {
                  ...previous.inputSchema.$defs,
                  ...tool.inputSchema.$defs,
                },
              },
            }
          : tool,
      );
    }
  }
  assert.ok(merged.size, "missing generated tool catalogs");
  return [...merged.values()];
}

// Validate the schema features exercised by these examples without a dependency
// or a running MCP server; this is not a general JSON Schema implementation.
function validate(value, schema, root = schema) {
  if (schema.$ref)
    return validate(value, root.$defs[schema.$ref.split("/").at(-1)], root);
  if (schema.anyOf || schema.oneOf) {
    assert.ok(
      (schema.anyOf ?? schema.oneOf).some((option) => {
        try {
          validate(value, option, root);
          return true;
        } catch {
          return false;
        }
      }),
      "no schema branch matches",
    );
    return;
  }
  const type =
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const types = [].concat(schema.type ?? []);
  assert.ok(
    !schema.type ||
      types.includes(type) ||
      (type === "number" &&
        Number.isInteger(value) &&
        types.includes("integer")),
    `unexpected type ${type}`,
  );
  if (Object.hasOwn(schema, "const")) assert.equal(value, schema.const);
  if (schema.enum)
    assert.ok(schema.enum.includes(value), `unknown enum ${value}`);
  if (type === "object") {
    for (const field of schema.required ?? [])
      assert.ok(Object.hasOwn(value, field), `missing ${field}`);
    for (const [field, item] of Object.entries(value)) {
      const child = schema.properties?.[field];
      assert.ok(
        child || schema.additionalProperties !== false,
        `unknown argument ${field}`,
      );
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

test("guide tool names, inline arguments and all JSON examples match the frozen contract", (context) => {
  context.diagnostic(
    `${[...catalogCounts].map(([path, count]) => `${path}: ${count} tools`).join("; ")}; union: ${tools.size}; no pending exemptions`,
  );
  // These are server prompts, not callable tools. Every other snake_case name
  // appearing in either document must belong to the frozen tool inventory.
  const prompts = new Set(["plan_epic", "work_on_next_task", "review_task"]);
  const missing = [];
  for (const name of new Set(guide.match(/\b[a-z]+(?:_[a-z]+)+\b/g))) {
    if (
      !(
        tools.has(name) ||
        prompts.has(name) ||
        [
          "board_file",
          "linked_file",
          "to_edit",
          "idempotency_conflict",
          "already_undone",
          "review_sent",
        ].includes(name)
      )
    )
      missing.push(name);
  }
  const aliases = {
    epic: "create_epic",
    story: "create_story",
    task: "create_task",
    claim: "claim_task",
    report: "submit_report",
    review: "review_task",
  };
  let calls = 0;
  for (const [, source] of guide.matchAll(/```json\s*([\s\S]*?)```/g)) {
    const example = JSON.parse(source);
    const entries = Array.isArray(example)
      ? example
      : Object.entries(example).map(([alias, args]) => ({
          tool: aliases[alias],
          arguments: args,
        }));
    for (const entry of entries) {
      validateCall(entry.tool, entry.arguments);
      calls++;
    }
  }
  assert.ok(calls >= 13, "examples were removed");
  for (const [, name, args] of guide.matchAll(
    /\b([a-z]+(?:_[a-z]+)+)\s+\{([^{}]+)\}/g,
  )) {
    const schema = tools.get(name)?.inputSchema;
    assert.ok(schema, `unknown inline tool ${name}`);
    const fields = args.split(",").map((field) => field.trim().split(":")[0]);
    for (const field of fields)
      assert.ok(schema.properties[field], `${name}: unknown ${field}`);
    for (const field of schema.required ?? [])
      assert.ok(fields.includes(field), `${name}: missing ${field}`);
  }
  // Guard the validator itself against the failures this check is intended to catch.
  assert.throws(() => validateCall("resolve_file", {}), /missing assetId/);
  assert.throws(
    () => validateCall("resolve_file", { assetId: "x", cwd: "x" }),
    /unknown argument cwd/,
  );
  assert.throws(
    () =>
      validateCall("register_file", { storageType: "board", requestId: "x" }),
    /no schema branch matches/,
  );
  assert.deepEqual(missing, [], `missing tools: ${missing.join(", ")}`);
});

test("folder context and copy/link guidance use real fields and manifest rules", () => {
  const fields = tools.get("get_session_context").outputSchema.properties;
  for (const field of [
    "projectFolder",
    "repositoryRoot",
    "workingDirectory",
    "folderRules",
    "manifestRevision",
  ]) {
    assert.ok(fields[field]);
    assert.ok(guide.includes(`\x60${field}\x60`));
  }
  for (const text of [
    "jamboard.json",
    "board.json",
    ".state/",
    "Never edit",
    "generated",
    "board_file",
    "linked_file",
    "pathBase",
    "absolute",
    "storageType",
    "future copies only",
    "sprite→images",
    "model→models",
  ])
    assert.ok(guide.includes(text), text);
});

test("roles retain CAS, request identity and unlink safety", () => {
  for (const name of [
    "link_task_file",
    "set_task_file_role",
    "unlink_task_file",
  ]) {
    const schema = tools.get(name).inputSchema;
    for (const field of [
      "taskKey",
      "assetId",
      "expectedClaimGeneration",
      "expectedUpdatedAt",
      "requestId",
    ])
      assert.ok(schema.required.includes(field));
  }
  for (const text of [
    "change this file",
    "do not change it",
    "attach what you produced",
    "never deletes bytes",
    "identical payload",
    "reread/reconcile",
    "claimGeneration",
    "updatedAt",
  ])
    assert.ok(guide.includes(text), text);
});

test("boat example resolves before registering and linking a result; failures stay explicit", () => {
  const example = JSON.parse(
    operations.match(/### Worked example[\s\S]*?```json\s*([\s\S]*?)```/)[1],
  );
  assert.deepEqual(
    example.map((call) => call.tool),
    ["get_task", "resolve_file", "register_file", "get_task", "link_task_file"],
  );
  assert.equal(example[1].arguments.workingDirectory, "$workingDirectory");
  assert.equal(example[2].arguments.storageType, "board_file");
  assert.equal(example[4].arguments.role, "result");
  for (const text of [
    "canonical board anchor",
    "same Git common-dir",
    "unrelated repository is refused",
    "resolutionBasis",
    'status:"missing"',
    'status:"unreadable"',
    'status:"unknown"',
    "not an availability status",
    "ask if outside",
  ])
    assert.ok(operations.includes(text), text);
});

test("guide preserves human execution and client lifecycle boundaries", () => {
  for (const text of [
    "does not start work",
    "does not launch or wake",
    "is not Start",
    "never filesystem access or execution permission",
    "do not stop them on the user",
    "do not grant Start or create agent sessions",
  ])
    assert.ok(guide.includes(text), text);
  // Detect affirmative instructions; existing descriptions of human Start and
  // client ownership are intentional, not instructions to launch anything.
  assert.doesNotMatch(
    guide,
    /(?:^|\n)\s*(?:\d+\.\s*|-\s*)?(?:install|launch|start|run)\s+(?:an?\s+|the\s+)?(?:agent|adapter|session|installer|codex|claude)\b/im,
  );
  assert.doesNotMatch(
    guide,
    /\bnpx\b|npm install|pnpm add|codex exec|claude -p/,
  );
});

function propertyNames(schema, names = new Set()) {
  if (!schema || typeof schema !== "object") return names;
  for (const name of Object.keys(schema.properties ?? {})) names.add(name);
  for (const child of Object.values(schema)) {
    if (Array.isArray(child))
      for (const entry of child) propertyNames(entry, names);
    else propertyNames(child, names);
  }
  return names;
}

test("every prose field exists in generated schemas or documented untyped outputs", () => {
  const fields = new Set();
  const documentedOutputs = new Set();
  for (const tool of tools.values()) {
    propertyNames(tool.inputSchema, fields);
    propertyNames(tool.outputSchema, fields);
    // Some generated output rows deliberately use JSON Schema true. Their
    // field contract is described in the generated tool description instead.
    // Derive names from that catalog text; never maintain field exemptions.
    if (JSON.stringify(tool.outputSchema)?.includes('"items":true')) {
      for (const name of tool.description.match(
        /\b[a-z]+(?:[A-Z][a-zA-Z]*)+\b/g,
      ) ?? [])
        documentedOutputs.add(name);
    }
  }
  for (const [, token] of guide.matchAll(/`([a-z][A-Za-z0-9]*)(?::[^`]+)?`/g)) {
    if (!/[A-Z]/.test(token)) continue;
    assert.ok(
      fields.has(token) || documentedOutputs.has(token),
      `missing field ${token}`,
    );
  }
  assert.ok(!fields.has("inventedGuideField"), "negative field control");
});

test("compact read and move prose uses exact tool-specific inputs", () => {
  for (const [name, fields] of Object.entries({
    find: ["kind", "externalRefs", "keys"],
    get_epic: ["depth", "include", "journalLimit"],
    get_task: ["include", "activityLimit"],
    list_tasks: ["fields"],
    import_plan: ["requestId", "epics", "dryRun", "overwrite"],
    undo_import: ["batchId", "requestId"],
    list_import_batches: ["limit"],
    move_story: ["key", "toEpicKey", "requestId"],
    move_task_to_story: [
      "key",
      "toStoryKey",
      "expectedUpdatedAt",
      "expectedClaimGeneration",
      "requestId",
    ],
  })) {
    for (const field of fields)
      assert.ok(
        tools.get(name)?.inputSchema.properties[field],
        `missing input ${name}.${field}`,
      );
  }
  for (const field of ["serverVersion", "schemaVersion", "capabilities"]) {
    assert.ok(
      tools.get("get_session_context").outputSchema.properties[field],
      `missing session field ${field}`,
    );
    assert.ok(
      guide.includes(`\x60${field}\x60`),
      `missing session guidance ${field}`,
    );
  }
  for (const uri of [
    "jam://prompts/plan_epic",
    "jam://prompts/work_on_next_task",
  ])
    assert.ok(guide.includes(uri), uri);
  for (const [name, fields] of Object.entries({
    import_plan: ["noChanges", "batchId", "conflicts", "skipped"],
    undo_import: ["batchId", "undone", "kept"],
  })) {
    for (const field of fields)
      assert.ok(
        tools.get(name)?.outputSchema.properties[field],
        `missing output ${name}.${field}`,
      );
  }
  for (const text of [
    "import.v1",
    "human's explicit decision",
    "noChanges:true",
    "link-only",
    "already_undone",
  ])
    assert.ok(guide.includes(text), `missing import guidance ${text}`);
  assert.ok(
    skill.includes("archivedBy"),
    "missing moodboard archive attribution",
  );
  assert.ok(
    guide.includes("idempotency.all"),
    "missing advertised receipt capability guidance",
  );
});

test("moodboard loop preserves capability gates, partial retry and human feedback", () => {
  for (const text of [
    "references.batch",
    "references.collect",
    "Partial success",
    "Retry only failed",
    "new `requestId`",
    "reference.review_sent",
    "verdictNote",
    "attachedTo",
    "rejected `sourceUrl`",
    "derivedFrom",
    "sourceFrameIds",
  ])
    assert.ok(guide.includes(text), text);
  for (const [name, fields] of Object.entries({
    add_references: ["requestId", "frameId", "items"],
    collect_kept_references: ["requestId", "sourceFrameIds", "title", "linkTo"],
    get_canvas: ["frameId", "verdict"],
  })) {
    for (const field of fields)
      assert.ok(
        tools.get(name)?.inputSchema.properties[field],
        `missing input ${name}.${field}`,
      );
  }
  const itemFields = propertyNames(tools.get("add_references").inputSchema);
  for (const field of [
    "kind",
    "filePath",
    "copy",
    "sourceUrl",
    "origin",
    "derivedFrom",
    "caption",
  ])
    assert.ok(
      itemFields.has(field),
      `missing input add_references.items.${field}`,
    );
  assert.ok(
    JSON.stringify(tools.get("wait_for_changes").inputSchema).includes(
      '"reference.review_sent"',
    ),
    "missing action reference.review_sent",
  );
  const batchOutput = tools.get("add_references").outputSchema;
  assert.ok(
    batchOutput.required.includes("failed"),
    "missing required output add_references.failed",
  );
  const failure =
    batchOutput.$defs[
      batchOutput.properties.failed.items.$ref.split("/").at(-1)
    ];
  for (const field of ["index", "field", "message"])
    assert.ok(
      failure.required.includes(field),
      `missing output add_references.failed.${field}`,
    );
  assert.ok(
    propertyNames(tools.get("get_task").outputSchema).has("verdictNote"),
    "missing reference output verdictNote",
  );
  assert.ok(
    guide.includes("Agents cannot rate references or send the human review"),
    "missing human-only review boundary",
  );
  for (const text of [
    "unique per",
    "per tool",
    "Old file request IDs",
    "earlier successfully",
    "#0",
  ])
    assert.ok(
      guide.includes(text),
      `missing retry/derivation guidance ${text}`,
    );
});
