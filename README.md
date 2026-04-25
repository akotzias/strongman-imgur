# strongman-imgur

Static site that lists every Reddit comment containing an imgur link from a curated set of threads.

**Live:** https://akotzias.github.io/strongman-imgur/

## Architecture

```
threads.json  ──►  Cloudflare Worker  ──►  Workers KV  ──►  GitHub Pages site
                   (cron every 5 min)      (data + state)    (polls every 60s)
                            ▲                    │
                            │                    ▼
                            │             /state.json
                            │                    │
                       wrangler            hourly GH Action
                       restore             commits backups/state.json
```

Four moving parts:

1. **GitHub Pages site** (`public/`) — a static page that fetches `data.json` from the Worker and renders the entries. No build step; deployed via `.github/workflows/update.yml` on every push.
2. **Cloudflare Worker** (`worker/`) — runs a 5-minute cron, scrapes Reddit, stores results in KV, serves them as a CORS-enabled JSON endpoint.
3. **Workers KV** — Cloudflare's edge key-value store; this is where the data actually lives between cron ticks.
4. **Hourly state backup** (`.github/workflows/backup-state.yml`) — pulls the Worker's `/state.json`, commits `backups/state.json` so the full state survives even if KV is wiped.

### Why a Worker (and not just GitHub Actions)

Reddit returns HTTP 403 to GitHub Actions runner IPs, so anonymous fetches from there don't work. Cloudflare's edge IPs aren't blocked. A Worker also gives us persistent state between runs, so we can scan a 4,000-comment thread incrementally instead of trying to fit it inside a single 30-second window.

### Where the data is saved

In Cloudflare Workers KV, namespace `IMGUR_KV` (id `8dbddb7408e543828a0fad2ff2e99339`), under two keys:

- **`state`** — internal: per-thread `seen_ids`, the imgur entries collected so far, the queue of unfinished `morechildren` batches, and the last-tick timestamp. The cron reads this, augments it, writes it back.
- **`data`** — public-facing: stripped-down JSON the page reads from `GET /data.json`. Contains entries, comment counts, and `backfill_pending`.

KV values are replicated across Cloudflare's edge and survive restarts/deploys. Free tier comfortably covers our usage (~288 writes/day, well under the 1k/day limit). The 1k/day write limit is the binding constraint on cron frequency: each tick writes 2 keys, so the absolute maximum is ~500 ticks/day (every 3 min). The 5-min schedule was chosen to leave headroom.

As a belt-and-braces measure against KV loss, the full `state` is also mirrored to `backups/state.json` in this repo by an hourly GitHub Action — see [State backup](#state-backup) below.

### How a cron tick works

For each thread in `public/threads.json`:

1. **Incremental fetch** — `GET /comments/<id>.json?sort=new&limit=500`. Walk the listing; for any comment id not in `seen_ids`, extract imgur links and add to entries. New `more` stubs go into the expansion queue.
2. **Drain backfill** — pop items off `expansion_queue` and call `morechildren` (or fetch the parent subtree for "continue this thread" stubs) until ~25s of wall time is used. Whatever's left stays in the queue for next tick.
3. Save `state` and `data` back to KV.

Net effect: a fresh thread converges to 100% comment coverage over ~1 hour of cron ticks. Once converged, each tick is essentially free — just the incremental check.

## Repo layout

```
strongman-imgur/
├── public/                    GitHub Pages root
│   ├── index.html
│   ├── style.css
│   ├── app.js                 fetches WORKER_URL/data.json, renders
│   └── threads.json           curated list of threads to scrape
├── worker/                    Cloudflare Worker source
│   ├── src/index.js           cron + HTTP handlers
│   └── wrangler.toml          worker config (cron, KV binding)
├── backups/
│   └── state.json             hourly snapshot of KV `state` (auto-committed)
└── .github/workflows/
    ├── update.yml             GH Pages deploy on push to public/
    └── backup-state.yml       hourly state snapshot to backups/
```

## Worker endpoints

- `GET /data.json` — returns the cached output for the page. CORS open. Cached at the edge for 30s.
- `GET /state.json` — returns the full internal state JSON. Used by the hourly backup workflow.
- `GET /trigger` — runs a tick immediately (manual seed/refresh). Useful after deploying changes.
- `GET /reset` — wipes both KV keys. Use only for debugging.
- `GET /` — friendly status banner.

## Operations

### Add a thread

Edit `public/threads.json` and append:

```json
{
  "id": "abc123",
  "title": "Some other thread",
  "url": "https://www.reddit.com/r/.../comments/abc123/..."
}
```

The `id` is the alphanumeric segment after `/comments/` in the URL. Push to `main`. The Worker fetches `threads.json` from the live Pages URL on every cron tick, so the next tick (≤5 min later) will start scanning the new thread. No Worker redeploy needed.

### Update the Worker

```sh
cd worker
wrangler deploy
```

If the schema of the persisted `state` changes, hit `https://strongman-imgur.akotzias-dev.workers.dev/reset` once and then `/trigger` to seed fresh.

### Local site preview

```sh
python3 -m http.server -d public 8080
```

Then open http://localhost:8080. The page will hit the live Worker for data — no local Worker needed for UI work.

### Local Worker development

```sh
cd worker
wrangler dev
```

Spins up a local edge runtime with KV emulation. Hit `http://localhost:8787/trigger` to test.

### State backup

`.github/workflows/backup-state.yml` runs every hour at minute `:17` (and on manual dispatch). It does:

1. `curl https://strongman-imgur.akotzias-dev.workers.dev/state.json` → pretty-prints the JSON → writes to `backups/state.json`.
2. Stages the file, commits only if the contents changed, pushes.

The `update.yml` deploy workflow has `paths: ["public/**", ".github/workflows/update.yml"]`, so backup commits don't trigger a Pages redeploy.

**To restore** the Worker's KV from the backup (if KV is ever wiped):

```sh
cd worker
wrangler kv key put --binding=IMGUR_KV state "$(cat ../backups/state.json)"
```

Then hit `/trigger` to regenerate the public-facing `data` key from the restored `state`.

**To trigger a backup manually** (e.g. before doing something risky):

```sh
gh workflow run backup-state.yml --repo akotzias/strongman-imgur
```

## Deploy

- **Page**: pushing to `main` triggers `.github/workflows/update.yml`, which uploads `public/` to GitHub Pages.
- **Worker**: deployed manually with `wrangler deploy` from `worker/`. Cron tick is `*/5 * * * *`. Cloudflare account: `akotzias-dev`.
