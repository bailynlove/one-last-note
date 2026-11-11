---
name: verify-viewer-authorization
description: Exhaustively checks Viewer authorization in the web-app prototype. Use when changing role controls, click dispatch, Note upload/Trash/sharing, membership, App Extension administration, or prototypes/web-app/app.js.
---

# Verify Viewer authorization

Property: after **Acting as = Viewer** is selected, no Manager-only click can change Manager-owned product state. A violation could let a read-only User upload, delete, share, invite, or change extensions despite the role shown in the UI.

This check executes the real `prototypes/web-app/app.js`; it does not use a hand-written model of the authorization logic. Node's `vm` supplies only the small DOM surface the script needs. Synthetic clicks deliberately include hidden controls, because hiding a button is not authorization.

## Run

From the repository root:

```bash
node .agents/skills/verify-viewer-authorization/scripts/verify.mjs
```

Use Node.js 24 LTS or newer; no packages, network, or browser are required. Last run with Node.js v26.3.0; the 1,463 sequences take about two seconds. Exit 0 means the bounded property passed. Exit 1 means at least one counterexample was found.

The checker starts a fresh Viewer session for every sequence and exhaustively tries every Manager-action sequence of length 1–3 over these 11 operations: Upload, Share, Invite, Generate Join Link, Review new package, Review update, Toggle extension, and Trash for each of four Notes. It compares all product state after every click, ignoring only the informational `state.message`. A pass is bounded to those sessions and sequences, not a proof for other roles, inputs, or components.

## Expected result at the sync commit

At `ec6eae28baefef067d620ac32fc05f6ce37b1774`, the check **fails**: 1,424 of 1,463 sequences mutate Manager-owned state. Its eight one-click counterexamples are Upload, Share, Invite, Toggle extension, and Trash for each Note. For example:

1. Select **Acting as = Viewer**.
2. Dispatch the Upload Note click, even though the control is hidden.
3. `state.notes.0.id` changes from `n1` to `n5`.

The click listener in `prototypes/web-app/app.js` performs these mutations without checking `state.role`. This is a product finding, not a verifier failure. Do not weaken the property or exclude the counterexamples to obtain a pass. The prototype's role selector itself is a demonstration control and is not treated as an authentication boundary.

## Interpret a result

- Read the shortest counterexample and its `state.*` before/after values. Reproduce that exact click through the document's click listener.
- If the clicked operation is still Manager-only, the code has an authorization bug. Keep the finding visible until the product code is fixed.
- If the check crashes after a legitimate DOM refactor, extend the harness's DOM shim to support the new API. Do not bypass the real listener or copy its logic into the harness.
- If an intentional product decision changes which operations are Manager-only, update `operations` and this property to match that decision. Record the reason in the change.
- After an authorization fix, update the expected-result section and remove stale findings. A pass covers only the stated bound and exclusions.

## Coverage and synchronization

Covered code at sync commit `ec6eae28baefef067d620ac32fc05f6ce37b1774`:

- `prototypes/web-app/app.js`: `state`, `libraryActions`, `noteRows`, `membersView`, `extensionsView`, `render`, and the document `click`/`change` listeners.
- `prototypes/web-app/index.html`: the `#app` and state elements used by `render`.

Not covered: server-side authorization, durable storage, real DOM event dispatch, browser extensions, MCP, other prototypes, anonymous Users, Owners, role escalation through the demonstration selector, and sequences longer than three actions. This is an in-memory UI prototype with no backend; a pass here must never be presented as proof that the deployed product is authorized correctly.

When any covered file changes after the sync commit, treat this skill as stale until the harness is reviewed against that code. Move the sync commit forward only after confirming that the operations, state comparison, DOM shim, expected result, and exclusions describe the new commit.
