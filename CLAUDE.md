# Notes for Claude

This file is for AI assistants working on this repo. Read [`README.md`](./README.md) first for the actual architecture; this file is for things that aren't obvious from the code or README.

## Where to start

- Architecture, ops, restore: `README.md`.
- Live data the page uses: `public/data.json` (committed every 5 min by the sync workflow).
- Worker source: `worker/src/index.js`. Wrangler config: `worker/wrangler.toml`. Deploy: `cd worker && wrangler deploy`.
- The Worker URL is `https://strongman-imgur.akotzias-dev.workers.dev`. KV namespace `IMGUR_KV` id `8dbddb7408e543828a0fad2ff2e99339`.

## Common gotchas

- **Don't hit `/trigger` more than once per user request.** Each call makes ~30 anonymous Reddit requests. Repeated calls during debugging will cause Reddit to 403 the entire Cloudflare egress IP for ~30 min, stalling the cron too. To inspect data, read `/data.json` (KV-backed, no Reddit traffic). Only call `/trigger` if the user explicitly asks.
- **Browser cache after `public/*` changes.** When the user reports the page still shows old UI/text after a deploy, it's almost always their browser caching `app.js`. Verify with a cache-busted curl, then tell them to hard-refresh (Cmd+Shift+R).
- **Rejected tool calls don't undo file writes.** If the user rejects a commit, the modified file is still on disk. Avoid `git add -A` blindly afterwards — prefer `git add <specific paths>` and `git status --short` to verify.
- **GITHUB_TOKEN doesn't trigger downstream workflows.** When `sync-from-worker.yml` commits, it must explicitly dispatch `update.yml` via `gh workflow run` (using `actions: write` permission). This is intentional GitHub behavior; don't try to "fix" it by removing the dispatch step.
- **Reddit OAuth was tried and is currently unavailable.** The user attempted to register a "script" app at https://www.reddit.com/prefs/apps and got HTTP 500. Don't suggest OAuth as a quick fix — propose only as a multi-step path the user opts into.
- **`backfill_pending` can grow even when scanning is converging.** Expanding a `morechildren` batch can return more `more` stubs (deeper subtrees). The meaningful progress metric is `total_comments_loaded / total_comments_reported`, not the queue size.
- **GitHub Pages free tier soft-limits builds at ~10/hour.** `public/data.json` only commits when content actually changed, so we stay under in practice — but be aware if adding more cron-driven commit sources.

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
