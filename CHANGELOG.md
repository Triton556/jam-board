# Changelog

All notable changes to Jam Board are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-10-21

### Added

- MCP `wait_for_changes`: filtered activity long-poll with cursor recovery,
  bounded waits and presence updates, using the shared cross-process feed.
- A three-level plan: epics, stories and tasks, with interview summaries,
  acceptance criteria and complete worker briefs.
- Plan and Inbox screens, recommended answers, readiness checks and scoped
  agent statuses. The epic journal records planning, work, questions and reviews.
- Labeled project-interview context in Plan journals keeps questions asked
  before an epic exists visible beside its later work.
- Worker reports and separate human/brain reviews, including changes-requested
  rounds and retained evidence. Workers cannot review their own work.
- A References canvas with local images, audio, video, files, notes, links,
  epic frames, hand-drawn connections and session undo/redo.
- Game jam, Gamedev, Web app and Custom templates; optional milestones and
  template-specific tag suggestions.
- Settings → Agents can install and verify a local agent-playbook skill profile
  for Codex or Claude Code. Nothing is downloaded or installed globally.
- Epic/story/readiness/flag filters in the task table and epic filters on the board.

### Changed

- MCP now exposes 39 tools, hierarchy resources and planning/work/review prompts.
- Readable working presence on cards, table rows and task headers, with paper-pencil
  motion, quiet stale status and static reduced-motion graphics.
- Flat paper cards default to epic coloring; estimates remain optional.
  Shared graphite controls, centered questions and unclipped reference links
  improve the existing light and dark paper themes.

### Breaking MCP and task workflow changes

- The task hierarchy is now required:
  `create_task` requires `storyKey`; tasks always belong to a story and an epic.
- `todo` becomes `backlog` during migration. Columns are Backlog, Ready,
  In progress, Review and Done. Legacy descriptions remain editable Notes.
- Ready requires a complete brief. Workers claim Ready work and submit reports;
  humans or an appointed brain accept it. Overrides require a recorded reason.
- `needsInfo` means an open question on that task only. Ancestor questions remain
  visible in task context without flagging every descendant.
- JSON export version 2 retains hierarchy, briefs, reports, questions and
  references. Version-1 imports remain supported.

### Fixed

- Returning submitted work to In progress allocates a usable successor report
  round, preserving earlier reports and reviews. Repeated same-status moves do
  not allocate extra rounds; rejected transitions leave state and history intact.
- Live epic/story updates preserve unsaved title and worker-model drafts.
  Same-field conflicts offer explicit local/remote choices; queued saves remain
  attached to the original entity.
- Unsaved story acceptance criteria survive drawer close and navigation during
  the current app session. Validation, failed-save retry and overlapping saves
  retain the correct story and newer input.
- Workers cannot bypass claim/report or holder rules through generic moves,
  release or direct working-status creation. Human/appointed-brain planning and
  recorded Ready overrides remain available.
- MCP initialization now describes Ready → claim → `submit_report` → separate
  human/appointed-brain review.
- Release checksum generation uses actual uploaded installer filenames and
  verifies their bytes against the local build, including space/dot name changes.

See the [MCP contract](docs/mcp.md#breaking-changes-in-v02) for integration changes.

## [0.1.0] - 2026-10-20

### Added

- Local Windows task board, virtual task table, Markdown editing, comments,
  assets, team presence, activity and light/dark paper themes.
- SQLite WAL storage, live MCP changes, stdio/loopback HTTP transports,
  JSON import/export and non-destructive task/project archival.
- Unsigned per-user NSIS installer with the MCP sidecar.
