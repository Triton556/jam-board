# Standalone board skill and migration

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
- Skill installed by agent-playbook 2.0 or older (its `jam-board` profile): the
  app refuses to overwrite it. Playbook 2.1 moved the skill here and 3.0 no longer
  ships it, so the current playbook cannot remove that installation. Remove it with
  the playbook version that installed it, or save any edits and move the folder
  aside yourself, then install from Settings. Do not delete all client settings or
  adopt a foreign skill under the app's ownership. An old and a new global/project
  skill can both be discovered; inspect the client's catalog.
- Moving machines or losing private app receipts requires explicit reconciliation;
  a directory name alone is not evidence of ownership.

Refresh MCP schemas after upgrades. The current connection prompt verifies exact
project identity before reads. Installation alone does not appoint a role or
prove a model followed the guide. Native installation, model compliance and
browser/mock results are separate evidence classes.

## History

Until alpha41 the board skill shipped with agent-playbook. A read-only audit of
that playbook's Jam Board examples on 2026-10-21 (gaps and source blob identities,
cited by [alpha.9 verification](verification/0.3.0-alpha.9.md)) is kept in this
file's git history: `git show b3fb11b:docs/agent-playbook-compatibility.md`.
Those playbook files no longer exist upstream.

### Alpha41 session schema refresh

`get_session_context` adds nullable `projectFolder`, scoped to the session's pinned project. Reconnect and refresh cached output schemas; strict clients
using an older schema can reject the added property. It is a path hint, not a
permission to create or modify files. No other project settings are exposed.
