# Issue tracker: GitHub

Issues and PRDs for this project live as GitHub issues in **`bailynlove/one-last-note`**. Use the `gh` CLI for all operations.

This directory is not a git clone, so `gh` has no remote to infer — **pass `-R bailynlove/one-last-note` on every command.**

## Conventions

- **Create an issue**: `gh issue create -R bailynlove/one-last-note --title "..." --body "..."`. Use `--body-file` with a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> -R bailynlove/one-last-note --comments`.
- **List issues**: `gh issue list -R bailynlove/one-last-note --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` / `--state` filters.
- **Comment on an issue**: `gh issue comment <number> -R bailynlove/one-last-note --body "..."`
- **Apply / remove labels**: `gh issue edit <number> -R bailynlove/one-last-note --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> -R bailynlove/one-last-note --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents with the same `-R` flag:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## History

The v1 specification effort was first drafted as markdown under `.scratch/note-management-v1/` (`map.md` + `issues/NN-*.md`). That tree is **frozen** — it is the origin record, not a live tracker. Everything now lives in GitHub:

- map `.scratch/note-management-v1/map.md` → issue #1 (label `wayfinder:map`)
- tickets `01`–`12` → issues #2–#13, one-to-one, in the same numbering
- `Blocked by: NN` lines → GitHub native issue dependencies

When you resolve a ticket, write to GitHub. Don't mirror back into `.scratch`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `bailynlove/one-last-note`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> -R bailynlove/one-last-note --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: issue #1, label `wayfinder:map`, holding the Destination / Notes / Decisions-so-far / Tickets / Not yet specified / Out of scope body.
- **Child ticket**: an issue labelled `wayfinder:<type>` (`research` / `prototype` / `grilling` / `task`) with `Part of #1` at the top of the body, and listed in the map's `## Tickets` task list. Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**. Add an edge with `gh api --method POST repos/bailynlove/one-last-note/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/bailynlove/one-last-note/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list -R bailynlove/one-last-note --state open`), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> -R bailynlove/one-last-note --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> -R bailynlove/one-last-note --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's `## Decisions so far`.
