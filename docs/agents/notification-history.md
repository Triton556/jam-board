# Project notification history — feature action map

Status: implementation candidate on alpha29 baseline `f1fab10`; integration/release owner assigns final version. This is **project notifications**, not a renamed Activity page or proof that a toast was delivered. Activity remains the full audit view.

## Person's goal and retained data

Find an earlier actionable agent update after its five-second toast disappeared; open its original destination without changing projects or granting work permission. The topbar bell is present on the home Board and other shell pages.

- Reconstruct from existing project-bound `api.listActivity` / `Store::activity_page` persisted rows, including updates while the app was closed. No schema migration or copied event-payload storage.
- Seven existing agent-toast kinds: task.created/moved/claimed, comment.added, report.submitted, review.recorded, question.asked. Only records with a task key or exact question ID qualify. Human updates, presence, references, arbitrary errors, file receipt paths/details and other local notices are excluded. Existing toast expiry/receipt dismissal is unchanged.
- Read 100 **agent activity rows** per request, filter locally, offer Load older even if a full scanned page has no eligible rows. Deduplicate seq inside the explicitly scoped project. No new TTL; availability follows underlying activity retention. Partial pages are not called complete history. Rows are fetched afresh after remount/restart; a backend dataset replacement is outside this feature's identity contract.
- Local storage `jam.notification-read.v1` contains only up to 100 `{project, member, seq}` read-watermark records; no text, payloads, paths or receipts. Corrupt/denied storage does not break reads. A failed write retains the watermark in component memory until project/member remount or app close, with a visible explanation.
- No badge before a baseline exists. Afterwards, the count means new **in the fetched recent history**, not an exhaustive unread count. Explicit “Mark current updates as read” advances through highest displayed confirmed seq, including older unloaded events. Opening, View and toast dismiss never mark read. Withheld incoming events stay new until revealed and explicitly marked.

## Human interaction map (H-G03 / NT01)

1. Board/topbar → bell (accessible Project notifications name, expanded/dialog semantics) → titled modal with project name and scope/retention explanation.
2. Dialog → loading → recent rows / empty scanned page / error with explicit retry. Row contains summary, timestamp, optional New marker and View. Load older advances raw pagination cursor, not filtered-row cursor.
3. Arrival while reading → New notifications button, no automatic row reordering/focus theft. Reveal merges/deduplicates and rewinds pagination to cover any arrival gap. Refresh is read-only.
4. Mark current updates as read → metadata-only watermark; failure warning without discarding history. Older pages remain read; subsequent arrivals remain new.
5. View → pending read validation → exact Board task or exact Inbox question. Missing/archived task and missing question explain unavailability inside history. Service failures remain errors rather than false deletion claims. Task verifies original key and project; question verifies immutable ID and project, using current answered/withdrawn/open state.
6. Question destination → matching Inbox tab and focused card. Later refetch does not steal focus/reset a manually selected tab. Target vanished after initial validation → explicit unavailable message, never silently pretending generic Inbox is the requested item.
7. Escape/close/backdrop → existing modal focus return. Closing during pending View cancels late navigation. Project switch closes/clears history; A→B→A advances selection epoch even if same project ID returns. Router Back/Forward retains normal task/question URL behavior; reopening the bell reads current persisted rows.

## Agent action/state map

AG04 (question) and AG10 (persisted history) evidence is display-only. No MCP tools, Start approval, assignment, claims, project retargeting, answers or execution state changes are added. Read markers do not communicate that a human approved or processed an agent request. `board-changed` has no project ID: it is an invalidation signal only, never an ingested notification source. Scoped page and destination reads check app state before/after and caller selection epoch around awaits; cache project changes invalidate pending intent.

## Acceptance evidence

DOM/mock tests: `apps/desktop/src/features/notifications/{model,read-state,NotificationBell,InboxNotification}.test.*` — **25 passed** before final commit; includes persisted reconstruction without toast memory, dedup/allowlist, filtered-empty pagination, failed-fetch retry, stale A→B→A, missing/archived/wrong-project View, close-during-View, question status/focus/refetch, bounded/corrupt/denied read metadata, older-page watermark and arrival-during-marking.

TypeScript app + E2E checks and touched-file Biome: PASS. Earlier whole-suite run: 542 passed / 4 failed (two test timeouts, two file-drop delayed-navigation expectations); isolated rerun of all three affected files: 20 passed. This is not a clean whole-suite acceptance claim. Subsequent small fixes rerun affected notification tests, not the whole suite, because owner paused heavy jobs during native compilation.

`e2e/notification-history.spec.ts`: two light/dark hosted-browser scenarios added and typechecked; **NOT RUN** (sanctioned browser route pending; no launch/security workaround attempted). They exercise toast expiry → bell → Escape/focus return → exact View and capture open screenshots.

Visual/human/native gaps **NOT RUN**: inspect open modal in light/dark at 100%/200% zoom, narrow viewport and OS DPI; long rows/large history, error/pending/empty and live arrival; screen-reader announcements and full keyboard trap/return; original human's ease-of-use assessment; exact packaged Windows/macOS/Linux persistence and IPC project-switch races. DOM tests do not establish these. No user's live DB was opened.

## Applied sources

- [IBM Carbon notifications](https://www.carbondesignsystem.com/building-blocks/core/patterns/notifications): contextual feedback and user-opened notification panels support later reading; not proof this implementation is usable. Kept existing transient toasts as a separate surface.
- [WAI-ARIA dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): initial focus, contained keyboard navigation, Escape and focus return. Uses existing Dialog machinery; hosted/native verification remains pending.

## Shared-map integration handoff (owner)

- README: link this per-feature map and replace “no notification history implementation” with candidate/evidence boundary.
- human-interactions H-G03: add topbar bell → scoped history → pagination/read watermark → exact View paths; keep receipts distinct.
- agent-actions: link display-only notification behavior to existing questions/history; no tool count change.
- acceptance NT01: source tests/evidence above; browser/native NOT RUN.
- known-gaps F04: mark implementation candidate, remaining visual/native/actual-human checks, not unconditionally resolved.
- ux-evidence UX05: link implemented candidate and its retention/read policy; source remains rationale, not acceptance.

Owned source files: app.tsx topbar/search integration, InboxPage.tsx question landing, new features/notifications directory, dedicated E2E spec and this map. No TaskDrawer/StoryDrawer, manifests, changelog, shared maps, backend or live-data edits.
