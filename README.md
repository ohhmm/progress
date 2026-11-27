# Taskflow

A shared Kanban task tracker on Cloudflare Workers. Tasks persist in a SQLite-backed Durable Object shared by visitors to the board.

## Run

Install Node.js 22 or newer, then run:

```sh
npm ci
printf 'BOARD_PASSWORD=local-sync-test\n' > .dev.vars
npm run dev -- --local-protocol https
```

Open the displayed URL in Chrome, Edge, Firefox, or Safari. Choose **Editor sign-in** and use the username `taskflow` with the password from `.dev.vars`.

With the local HTTPS Worker running, run `npm run test:browser`.

## Deploy

```sh
npx wrangler login
npx wrangler secret put BOARD_PASSWORD
npm run deploy
```

The Worker name is `taskflow`. Deployment creates its durable board storage and packages the browser assets. The public landing page at `/` links to the source and accepts $100 deployment requests through GitHub Issues. The editor at `/board` and the task API require the configured board password. Use the same deployed URL and sign in as `taskflow` on every device. Use HTTPS in production.

### Social sign-in

On the Taskflow custom hostname, create a Cloudflare Access self-hosted application for `/view`. Enable the social identity providers viewers can choose from, such as GitHub or Google, and allow sign-in through those providers. Everyone admitted by that policy can read the shared board, including task notes.

Set `VIEWER_ACCESS_ISSUER` to your Access team URL (for example, `https://your-team.cloudflareaccess.com`) and `VIEWER_ACCESS_AUD` to the application's audience tag in the Worker environment. Keep the landing page, editor, and task API outside the viewer Access application. **New task** and **Edit** in the viewer open the existing editor sign-in.

## Synchronization

Task changes save to the server and appear on other devices within three seconds, or when the page regains focus. The save indicator confirms successful server writes and shows connection failures. Unsent changes persist in browser storage and retry automatically.

Existing browser tasks migrate on first connection. Server values take precedence when another device already migrated the same task. The original local snapshot is retained under `taskflow:legacy:v1` in localStorage. Deleted tasks stay deleted when a stale device reconnects.

## Test synchronization

With `npm run dev` running:

```sh
npm run test:sync
```

These tests use isolated client storage against the local Worker for cross-device moves, concurrent edits, offline recovery, retries, and deletion protection.

For desktop Chromium and iPhone WebKit verification:

```sh
npx playwright install chromium webkit
npm run test:browser
```

## Test with Safari WebDriver

Close Safari, then:

```sh
npm run dev -- --port 8123 &
safaridriver -p 4444 &
BASE=http://taskflow:local-sync-test@127.0.0.1:8123/index.html python3 -m tests.browser.smoke
BASE=http://taskflow:local-sync-test@127.0.0.1:8123/index.html python3 -m tests.browser.journey
```

## Features

- create, edit, and delete tasks
- three statuses: Backlog, Doing, Done
- priority, due date, tag, and notes
- shared durable persistence, automatic cross-device updates, and offline retry
- search, filtering, sorting, and project statistics
- JSON textarea import/export
- drag and drop between columns
- keyboard shortcuts: `/` focus search, `N` new task, `Esc` close modal
