# Working on Jam Board

Start with [docs/agents/README.md](docs/agents/README.md) before changing a user
interaction or agent workflow. The map distinguishes current behavior, known
limitations, planned work and the evidence needed to accept a change.

- Update the affected human interaction IDs, agent actions/states and acceptance
  rows in the same change as the feature. Follow the
  [feature checklist](docs/agents/feature-checklist.md).
- Preserve project isolation, captured intent/revisions, execution grants and
  retained human drafts. A prompt, Ready state, answer or heartbeat is not a
  launched agent or permission to begin work.
- Test actual behavior, interruption/recovery and affected hidden surfaces.
  Separate DOM/mock, hosted browser, native package and human observations;
  builds and hashes alone do not establish usability.
- Keep release-style versions, changelog and verification records consistent.
  Record unrun or blocked checks honestly; never transfer a previous build's
  acceptance to changed code without checking the affected behavior.
