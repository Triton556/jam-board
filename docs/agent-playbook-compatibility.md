# Standalone board skill and migration — alpha41

Jam Board now owns `integrations/agent-skill/jam-board`. The exact bundled files
are also MCP resources `jam://guide` and `jam://guide/operations`. The skill has no
agent-playbook, dev-plan or you-are-brain dependency. Universal orchestration can
use this board like another integration; board hierarchy and execution rules stay
here. The JSON example in operations is exercised through disposable real stdio.

Settings installs the selected project-scoped skill for Codex or Claude. It does
not download a repository, execute Python, change global agent configuration,
launch models or grant board execution. The source version follows the app.

## Existing installations

- New app-owned installation: review target/client and confirm. Verify reads back
  managed content against the installed receipt and private app ownership record.
- App-owned upgrade: unchanged owned files can update with an outside-catalog
  backup; user neighbors remain. Modified files or missing/mismatched ownership
  stop before overwrite. Preserve backups and review before manual recovery.
- Legacy playbook-owned skill: migrate/remove using its original trusted installer
  receipt first. Do not delete all client settings, overwrite modified files, or
  adopt a foreign skill under the app's ownership. An old and a new global/project
  skill can both be discovered by the client; inspect its actual catalog.
- Moving machines or losing private app receipts requires explicit reconciliation;
  a directory name alone is not evidence of ownership.

Refresh MCP schemas after upgrades. The current connection prompt verifies exact
project identity before reads. Installation alone does not appoint a role or
prove a model followed the guide. Native installation, model compliance and
browser/mock results are separate evidence classes.

## Historical audit, 2026-10-21 (superseded, not current installation advice)

# Optional agent-playbook guidance and current MCP — 2026-10-21

Jam Board's live MCP schemas, server instructions and current [MCP contract](mcp.md)
are authoritative for calls to this version. The optional playbook teaches a broader
workflow. Installing it verifies local files, not compatibility with every board
version, and does not connect MCP, appoint an Epic Brain or authorize execution.

## Observed upstream snapshot

A read-only audit of public agent-playbook's default branch on 2026-10-21 found:

| Source | Observation | Required adaptation for Jam Board 0.3 |
|---|---|---|
| [README](https://github.com/Triton556/agent-playbook/blob/main/README.md) | Describes version 1.6.0 and an optional `jam-board` profile; explicit local target and Python 3.12+ | Use its acquisition/install instructions only after inspecting the source and intended target. No auto-install is implied. |
| [Jam Board skill](https://github.com/Triton556/agent-playbook/blob/main/payload/skills/jam-board/SKILL.md) | Identifies its mapping as v2.1 and correctly tells agents to reconcile differing live schemas | Retain that fail-closed rule. This older mapping alone is not current protocol verification. |
| [Connection guide](https://github.com/Triton556/agent-playbook/blob/main/payload/skills/jam-board/references/connect.md) | Example snippets omit explicit project binding | Prefer this app's captured configuration and exact-project read-only check; never assume the UI selection retargets a session. |
| [Worker loop](https://github.com/Triton556/agent-playbook/blob/main/payload/skills/jam-board/references/worker-loop.md) | Claim/report examples omit the new validators; no recorded Story/Epic gate | Read `get_execution`; require an authorized scope. Capture claim generation/revision from inspected task data and retain the returned generation for reports/releases. |
| [Brain loop](https://github.com/Triton556/agent-playbook/blob/main/payload/skills/jam-board/references/brain-loop.md) | Refers to 39 tools and shows legacy Ready/review calls | Current server exposes 44 tools. Ready/task writes and review use required captured context. Chat Start requests need typed Inbox approval, not a generic question answer. |

Read source blob identities (not a promise about a future default branch): README
`cbf04c51c8492aa205e006292ef724352babaa3d`; skill
`34e431435536ef7ba6a7a9f1eeeac780566e05dc`; connection guide
`6d70ea2c7f19efe88801981e529c57f103faadb1`; worker loop
`306f73d6499ef4aba9525db20368c4821b6677d1`; brain loop
`bd215ac9f273b111a88aebb43d3561357ab8a2b4`.

These are concrete example gaps, not a claim that the entire playbook is unusable.
Its schema-reconciliation and no-self-review rules remain useful. The independent
repository was **not modified** by this Jam Board change. Updating those call
examples and testing them against the current server is an upstream follow-up,
not completed integration evidence.

## Safe use now

- Configure the intended project using Settings → Agents; run its read-only check.
- Restart/reconnect after upgrading and refresh the client's cached schemas.
- Use the in-app planning prompt and server prompts/resources for current calls.
- Read the relevant task, exact report and ancestor criteria before preparing a
  mutation. Preserve that captured context until submission.
- On `conflict`/`stale_claim`/stale review, retain the draft and reconcile explicitly
  with fresh evidence. Do not fetch replacement validators and replay old intent.
- Keep planning, per-Epic appointment and Story/Epic execution authorization distinct.
- A successful file-install verification is not a live client smoke test. No model
  compliance, OS worker launch, user environment setup or spending permission is
  established by installing the optional skill.

### Alpha41 session schema refresh

`get_session_context` adds nullable `projectFolder`, scoped to the session's pinned project. Reconnect and refresh cached output schemas; strict clients
using an older schema can reject the added property. It is a path hint, not a
permission to create or modify files. No other project settings are exposed.
