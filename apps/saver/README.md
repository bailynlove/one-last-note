# One Last Note Chrome Saver

Manifest V3 extension for saving a readable page or a selected passage into a Knowledge Base you own or manage.

## Local setup

1. Start the local services and apps from the repository root: `pnpm services:up`, `pnpm db:migrate`, `pnpm storage:init`, then `pnpm dev`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked** for this directory.
3. If your API or web app is not on the defaults, update `config.js` and the matching `host_permissions` in `manifest.json`.
4. Copy the unpacked extension ID shown on `chrome://extensions` into `SAVER_EXTENSION_ID` in the root `.env` before starting the API; production requires it.
5. Sign in to the web app at `http://localhost:3000`, then open the Saver and choose **Connect to One Last Note**.

## Authentication

The Saver uses an authorization code with PKCE (S256). It never receives a web cookie or password:

1. The popup creates a verifier and challenge and opens the web authorization page with `chrome.identity.launchWebAuthFlow`.
2. The signed-in web session authorizes a short-lived code bound to the challenge.
3. The popup exchanges the code and verifier for a 30-day bearer session and a 90-day rotating refresh token.
4. Tokens are stored in `chrome.storage.local`; a 401 or an expiring bearer refreshes once and retries the request.

Permissions are limited to the active tab, script injection for the current selection, extension storage, identity, and the local API host. The extension requests no broad host access and does not inject persistent content scripts.

## Behavior

- Full-page captures send only the URL. The API fetches and extracts the readable page, so no page code runs in the capture.
- Selected-passage captures send the selected HTML and text; the API sanitizes and freezes them as a Revision.
- A possible duplicate is shown before the second save is confirmed.
- The attempt ID is persisted before submission, so reopening the popup recovers an in-progress or failed attempt; unsent selection HTML is kept only in memory.
- Unsupported browser pages (`chrome://`, file previews, and so on) are rejected before a request is made.

## Manual verification

1. Connect the Saver while signed in; the target list contains only Knowledge Bases where you are Owner or Manager.
2. Save a public article; wait for the capture to become Ready and open the Note.
3. Select a passage and save; the new Note contains only that passage and its source metadata.
4. Save the same page again; the duplicate warning appears and the second click creates the intentional duplicate.
5. Close the popup during processing; reopen it and confirm the same attempt continues.
6. Disconnect and confirm the stored session and refresh token are revoked and the popup returns to the connect screen.

`pnpm test:saver` runs the popup in a real Chromium extension context with the API mocked. `pnpm test:integration` exercises the real PKCE authorization, exchange, refresh, and revocation against PostgreSQL and Redis.
