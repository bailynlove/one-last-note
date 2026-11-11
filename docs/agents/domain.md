# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary for note management (Note, Knowledge Base, Manager, Viewer, Comment, Mark, Highlight, Saver, App Extension).
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

This is a **single-context** repo: one `CONTEXT.md`, one `docs/adr/`.

If either doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── AGENTS.md
├── CONTEXT.md
├── docs/
│   ├── adr/
│   │   └── 0001-....md
│   └── agents/          ← this setup: issue-tracker, triage-labels, domain
└── .scratch/            ← frozen v1 drafting record; not a live tracker
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids — notably:

- **Knowledge Base**, not "folder" or "workspace".
- **Mark**, not "comment" (a Mark carries no text). **Comment** always means the annotated one.
- **App Extension**, not "browser extension". **Saver** is the Chrome extension that creates Notes from web pages — a distinct thing.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
