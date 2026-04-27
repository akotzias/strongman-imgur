# Notes for Claude

This file is for AI assistants working on this repo. Read [`README.md`](./README.md) first for the actual architecture; this file is for things that aren't obvious from the code or README.

## Status: frozen static page

As of 2026-04-27 the Cloudflare Worker that scraped Reddit and pushed `public/data.json` was deleted, along with its KV namespace and the `sync-from-worker.yml` fallback workflow. The site is now a pure static page; `public/data.json` is a frozen snapshot. README has the historical architecture and revival notes.

If the user asks why the page is "stale" — that's expected. It's not broken. Don't try to "fix" it by hitting a Worker URL or re-running a sync workflow; both are gone.

## Where to start

- Page entry point: `public/index.html` → `public/app.js` → `fetch('./data.json')`.
- Data the page renders: `public/data.json` (frozen).
- Curated thread list: `public/threads.json` (first entry is the featured/expanded thread).
- Only workflow left: `.github/workflows/update.yml` — uploads `public/` to GitHub Pages on push.

## Page UI conventions

- The first thread in `public/threads.json` is the active/featured one — it renders as a plain `<section>` (always visible). Every subsequent thread renders as a `<details>` (collapsed by default). Keep the active thread first if anything is ever re-prioritised.
- An opt-in "Show images and videos inline" toggle (checkbox above the donate button) flips between a text-only links view (default) and an inline-media view that lazy-loads imgur images/videos/albums. Choice persists via `localStorage[strongman-imgur:media-mode]`. The default-off behavior is intentional — the page must work with zero third-party requests by default.
- Cloudflare Web Analytics is wired in both `public/index.html` and `public/soph/index.html` via the `static.cloudflareinsights.com/beacon.min.js` script with token `2b8dcc8b20854fc58d0a9b4b3397ff98`. Dashboard: https://dash.cloudflare.com/cf98d411f226fa47cfa34d6f77c8f2fb/web-analytics

## Common gotchas

- **Browser cache after `public/*` changes.** When the user reports the page still shows old UI/text after a deploy, it's almost always their browser caching `app.js`. Verify with a cache-busted curl, then tell them to hard-refresh (Cmd+Shift+R).
- **Rejected tool calls don't undo file writes.** If the user rejects a commit, the modified file is still on disk. Avoid `git add -A` blindly afterwards — prefer `git add <specific paths>` and `git status --short` to verify.

## Reviving the Worker (if asked)

Source is in git history under `worker/`. To bring it back:

1. `git checkout <pre-2026-04-27-commit> -- worker .github/workflows/sync-from-worker.yml`
2. `cd worker && wrangler kv namespace create IMGUR_KV` → paste new id into `wrangler.toml` (the old id `8dbddb7408e543828a0fad2ff2e99339` is gone).
3. Mint a new fine-grained PAT (Contents: read+write, scoped to `akotzias/strongman-imgur`) and `wrangler secret put GH_TOKEN`.
4. `wrangler deploy`. Optionally seed with one `/trigger` call.

The original cron was `*/30 * * * *`; bumping it lower than `*/5` risks Reddit 429s on the shared CF egress.

## Auth state on the user's machine (as of 2026-04-25)

- `gh`: authed to `akotzias` on github.com.
- `wrangler`: authed to Cloudflare account `akotzias-dev` (account id `cf98d411f226fa47cfa34d6f77c8f2fb`). Still relevant for the Web Analytics dashboard even with the Worker gone.

## What's *not* set up

- No CI tests.
- No favicon. (Low priority.)
