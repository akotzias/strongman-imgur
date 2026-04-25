# Notes for Claude

This file is for AI assistants working on this repo. Read [`README.md`](./README.md) first for the actual architecture; this file is for things that aren't obvious from the code or README.

## Where to start

- Architecture, ops, restore: `README.md`.
- Live data the page uses: `public/data.json` (committed every 5 min — primarily by the Worker pushing directly to GitHub via the Contents API; `sync-from-worker.yml` is a fallback).
- Worker source: `worker/src/index.js`. Wrangler config: `worker/wrangler.toml`. Deploy: `cd worker && wrangler deploy`.
- The Worker URL is `https://strongman-imgur.akotzias-dev.workers.dev`. KV namespace `IMGUR_KV` id `8dbddb7408e543828a0fad2ff2e99339`.
- Worker secret: `GH_TOKEN` is a fine-grained GitHub PAT (Contents: read+write, scoped to `akotzias/strongman-imgur`).

## Common gotchas

- **Always `cd worker && wrangler deploy`, never just `wrangler deploy` from the repo root.** Wrangler can't find a config at the root, so it runs an interactive init that auto-creates a `wrangler.jsonc` pointing `assets.directory` at `public/` and deploys a static-assets worker — which silently overwrites the real cron worker because both share the name `strongman-imgur`. Recovery: delete the stray `wrangler.jsonc` (and any `.gitignore` lines wrangler added), `cd worker`, redeploy.
- **Cloudflare free-tier Worker has a 50-subrequest cap per invocation** (HTTP and cron). `tick()` uses `TIME_BUDGET_MS = 8_000` to keep morechildren expansions to ~12 per tick. The GitHub push uses cached SHAs in KV (`gh-sha:<path>`) to PUT directly, falling back to GET-then-PUT only on 422. Don't raise the budget or remove the SHA cache without recounting subrequests.
- **Don't hit `/trigger` more than once per user request.** Each call makes ~30 anonymous Reddit requests. Repeated calls during debugging will cause Reddit to 403 the entire Cloudflare egress IP for ~30 min, stalling the cron too. To inspect data, read `/data.json` (KV-backed, no Reddit traffic). Only call `/trigger` if the user explicitly asks.
- **Browser cache after `public/*` changes.** When the user reports the page still shows old UI/text after a deploy, it's almost always their browser caching `app.js`. Verify with a cache-busted curl, then tell them to hard-refresh (Cmd+Shift+R).
- **Rejected tool calls don't undo file writes.** If the user rejects a commit, the modified file is still on disk. Avoid `git add -A` blindly afterwards — prefer `git add <specific paths>` and `git status --short` to verify.
- **GITHUB_TOKEN doesn't trigger downstream workflows.** When `sync-from-worker.yml` commits, it must explicitly dispatch `update.yml` via `gh workflow run` (using `actions: write` permission). This is intentional GitHub behavior; don't try to "fix" it by removing the dispatch step.
- **Reddit OAuth was tried and is currently unavailable.** The user attempted to register a "script" app at https://www.reddit.com/prefs/apps and got HTTP 500. Don't suggest OAuth as a quick fix — propose only as a multi-step path the user opts into.
- **`backfill_pending` can grow even when scanning is converging.** Expanding a `morechildren` batch can return more `more` stubs (deeper subtrees). The meaningful progress metric is `total_comments_loaded / total_comments_reported`, not the queue size.
- **GitHub Pages free tier soft-limits builds at ~10/hour.** `public/data.json` only commits when content actually changed, so we stay under in practice — but be aware if adding more cron-driven commit sources.
- **Cloudflare Workers cron has a ~30s wall-time limit.** The scrape uses `TIME_BUDGET_MS = 20_000` to leave room for the GitHub push, and the push itself runs under `ctx.waitUntil` so it can finish past the main handler return. If you raise the scrape budget you'll likely break the cron-driven push silently — the data still lands in KV but the GitHub commit gets killed.
- **The `data.json` heartbeat is intentional.** `data.json` includes `generated_at`, so every successful cron tick produces a different blob and therefore a commit. We rely on this as a liveness signal — if you see no `Sync ... from Worker (data)` commit in 10+ minutes, automation is broken. Don't normalize `generated_at` out of the diff without replacing it with another heartbeat.
- **The state push under `ctx.waitUntil` is best-effort.** The data commit is reliable; the state commit may occasionally be killed by the runtime ending the worker. Acceptable because `state.json` is a backup, not consumed by the page.
- **Storing a secret with `wrangler secret put`:** the argument is the variable NAME (e.g. `GH_TOKEN`), the prompt asks for the VALUE. Pasting the token into the name field leaks it (names appear in `wrangler secret list`, the dashboard, and shell history). If this happens: revoke the PAT immediately, regenerate, re-add via the prompt.

## Page UI conventions

- The first thread in `public/threads.json` is the active/featured one — it renders as a plain `<section>` (always visible). Every subsequent thread renders as a `<details>` (collapsed by default). Keep the active thread first.
- An opt-in "Show images and videos inline" toggle (checkbox above the donate button) flips between a text-only links view (default) and an inline-media view that lazy-loads imgur images/videos/albums. Choice persists via `localStorage[strongman-imgur:media-mode]`. The default-off behavior is intentional — the page must work with zero third-party requests by default.
- Cloudflare Web Analytics is wired in both `public/index.html` and `public/soph/index.html` via the `static.cloudflareinsights.com/beacon.min.js` script with token `2b8dcc8b20854fc58d0a9b4b3397ff98`. Dashboard: https://dash.cloudflare.com/cf98d411f226fa47cfa34d6f77c8f2fb/web-analytics

## Ops cheatsheet

- Force-deploy the page: `gh workflow run update.yml --repo akotzias/strongman-imgur`
- Force-sync from Worker: `gh workflow run sync-from-worker.yml --repo akotzias/strongman-imgur`
- Inspect KV: `cd worker && wrangler kv key get --binding=IMGUR_KV data` (or `state`)
- Live worker logs: `cd worker && wrangler tail`
- Restore KV from backup: `cd worker && wrangler kv key put --binding=IMGUR_KV state "$(cat ../backups/state.json)"` then `curl https://strongman-imgur.akotzias-dev.workers.dev/trigger` once.

## Auth state on the user's machine (as of 2026-04-25)

- `gh`: authed to `akotzias` on github.com. Earlier BMW GHE entries were removed.
- `wrangler`: authed to Cloudflare account `akotzias-dev` (account id `cf98d411f226fa47cfa34d6f77c8f2fb`).

## What's *not* set up

- No CI tests. The Worker has no automated tests.
- No alerting if cron fails or Reddit changes its API.
- No Reddit OAuth — see gotcha above.
- No favicon. (Low priority.)
