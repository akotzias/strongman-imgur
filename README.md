# strongman-imgur

Static site that lists every Reddit comment containing an imgur link from a curated set of threads.

**Live:** https://akotzias.github.io/strongman-imgur/

## Architecture

```
                                          Reddit JSON API (anonymous, ~10 req/min)
                                                     ▲
                                                     │ once every 5 min
                                                     │ (cron only)
                                                     │
   ┌────────────────────────────────────────────────────────────────────────────┐
   │                       Cloudflare Worker                                    │
   │  ┌─────────────────┐    ┌────────────────────────┐    ┌─────────────────┐  │
   │  │ scheduled tick  │ ─► │  Workers KV            │ ◄─ │ GET /data.json  │  │
   │  │ (cron */5 * *)  │    │  • state (full)        │    │ GET /state.json │  │
   │  │  fetch + expand │    │  • data  (page-facing) │    └─────────────────┘  │
   │  │  + push to GH   │    └────────────────────────┘                         │
   │  └────────┬────────┘                                                       │
   └───────────│────────────────────────────────────────────────────────────────┘
               │ PUT /repos/akotzias/strongman-imgur/contents/...
               │ (using GH_TOKEN secret = fine-grained PAT)
               ▼
   ┌─────────────────────────────────────────────┐
   │  GitHub repo (akotzias/strongman-imgur)     │
   │  • public/data.json     ← every cron tick   │
   │  • backups/state.json   ← every cron tick   │
   │                                              │
   │  Fallback: sync-from-worker.yml runs every  │
   │  5 min and pulls the same JSON from the      │
   │  Worker if the push ever fails. Most ticks  │
   │  it sees no diff and exits silently.        │
   └────────────────────┬─────────────────────────┘
                        │ push triggers update.yml
                        ▼
   ┌─────────────────────────────────────────┐    ┌──────────────────────────────┐
   │      Visitor                            │ ─► │  GitHub Pages                │
   │      one fetch on load,                 │    │  serves public/* incl.       │
   │      no polling (reload to refresh)     │ ◄─ │  data.json (committed file)  │
   └─────────────────────────────────────────┘    └──────────────────────────────┘
```

Six things to know:

1. **Cloudflare Worker** (`worker/`) — runs a `*/5 * * * *` cron. The cron is the **only** thing that talks to Reddit. The Worker holds `state` (internal accumulator) and `data` (page-facing JSON) in Workers KV.
2. **Worker pushes directly to GitHub** — at the end of every cron tick, the Worker calls the GitHub Contents API to update `public/data.json` and `backups/state.json` (skipped if the content hasn't changed). Uses a fine-grained PAT stored as the `GH_TOKEN` Worker secret. This is the **primary update path** and is the reason the page is fresh within ~30s of every scrape.
3. **Sync GitHub Action** (`.github/workflows/sync-from-worker.yml`) — also runs every 5 min and does the same thing via `curl`. Almost always a no-op now (Worker beat it to the punch). Kept as a fallback in case the Worker push fails or GH_TOKEN expires.
4. **Deploy workflow** (`.github/workflows/update.yml`) — fires on every push that touches `public/**`. Uploads `public/` to GitHub Pages. Worker-authored pushes (under your PAT identity) trigger this normally.
5. **GitHub Pages site** (`public/`) — a fully static page. On load, it does **one** `fetch('./data.json')` against the same origin. No live dependency on the Worker, no polling. Visitors must reload to see updates.
6. **Worker is replaceable** — if Cloudflare disappears, the page keeps working with the last committed `data.json`. The cron + scrape + push logic could be moved elsewhere (Fly.io, a home server, etc.) and aimed at the same GitHub Contents API endpoint.

### Why this shape

- **Reddit blocks GitHub Actions runner IPs** (HTTP 403). Cloudflare's IPs aren't blocked, so the Reddit-facing scraper has to live there.
- **Reddit's anonymous rate limit is ~10 req/min.** A single page-load worth of recursive `morechildren` expansion can exceed that, so we don't expose page reads to Reddit at all — the scrape is decoupled from page traffic.
- **Persistent state** in KV means we converge to full coverage of huge threads (4k+ comments) over many cron ticks instead of trying to fit a 30-second-budget scan into a single request.
- **Data in the repo** means: free static hosting (GitHub Pages), git history of every state, no live dependency on Cloudflare from the visitor's browser, easy disaster recovery.

### How a cron tick works

For each thread in `public/threads.json`:

1. **Incremental fetch** — `GET /comments/<id>.json?sort=new&limit=500`. Walk the listing; for any comment id not in `seen_ids`, extract imgur links and add to entries. New `more` stubs go into the expansion queue.
2. **Drain backfill** — pop items off `expansion_queue` and call `morechildren` (or fetch the parent subtree for "continue this thread" stubs) until **~20s** of wall time is used. Whatever's left stays in the queue for next tick.
3. Save `state` and `data` back to KV.
4. **Push to GitHub** under `ctx.waitUntil` — the GitHub Contents API roundtrips run as background work so they don't compete with the scrape budget. Cloudflare Workers' scheduled handler caps at ~30s wall-time total, so the 20s scrape + ~5s push + small overhead leaves headroom.

Net effect: a fresh thread converges to 100% comment coverage over ~1 hour of cron ticks. Once converged, each tick is essentially free — just the incremental check.

**Heartbeat:** `data.json` includes `generated_at`, so even a tick with no new comments produces a different blob and therefore a commit. That's deliberate — if `Sync ... from Worker (data)` commits stop appearing every 5 min, automation is broken and worth investigating.

### Where the data is saved

- **`public/data.json`** — committed to the repo by the Worker on every cron tick (and by the sync workflow as fallback). This is what the page actually reads. **Source of truth from the visitor's perspective.**
- **`backups/state.json`** — committed alongside; full internal state, used to restore KV if needed.
- **Cloudflare Workers KV**, namespace `IMGUR_KV` (id `8dbddb7408e543828a0fad2ff2e99339`) — under keys `data` and `state`. The cron writes here, then pushes the same content to GitHub. Considered transient — losable.

KV write budget on the free tier (1k/day) caps cron frequency at ~500 ticks/day; 288/day at 5-min is well under.

## Repo layout

```
strongman-imgur/
├── public/                    GitHub Pages root
│   ├── index.html
│   ├── style.css
│   ├── app.js                 fetches ./data.json, renders
│   ├── threads.json           curated list of threads to scrape
│   └── data.json              committed every 5 min by sync workflow
├── worker/                    Cloudflare Worker source
│   ├── src/index.js           cron + HTTP handlers
│   └── wrangler.toml          worker config (cron, KV binding)
├── backups/
│   └── state.json             committed every 5 min; full state for KV restore
└── .github/workflows/
    ├── update.yml             GH Pages deploy on push to public/
    └── sync-from-worker.yml   pulls Worker JSON and commits every 5 min
```

## Worker endpoints

- `GET /data.json` — page-facing JSON. Read by the sync workflow.
- `GET /state.json` — full internal state. Read by the sync workflow.
- `GET /trigger` — runs a tick immediately (manual seed/refresh). Use sparingly — each call makes ~30 Reddit requests and risks 429s on the shared CF egress.
- `GET /trigger?push=1` — same, but also pushes the resulting `data.json` and `state.json` to GitHub immediately (uses `GH_TOKEN`).
- `GET /reset` — wipes both KV keys. Debugging only.
- `GET /` — status banner.

## Worker secrets

- `GH_TOKEN` — fine-grained GitHub PAT scoped to `akotzias/strongman-imgur` with **Contents: Read and write**. Used by the Worker to push commits directly. Set with:

  ```sh
  cd worker
  wrangler secret put GH_TOKEN
  # paste the token at the "Enter a secret value:" prompt
  ```

  ⚠ **The argument after `put` is the variable name (`GH_TOKEN`), not the token value.** Pasting the token as the name leaks it (secret names are not masked). If that happens: revoke the PAT at https://github.com/settings/personal-access-tokens, regenerate, and re-add via the prompt.

  If `GH_TOKEN` is missing or invalid, the Worker silently skips the push; the sync workflow then catches up at its next run.

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

Push to `main`. The Worker fetches `threads.json` from the live Pages URL on every cron tick, so the next tick (≤5 min later) will start scanning the new thread. No Worker redeploy needed.

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

Then open http://localhost:8080. Reads the committed `public/data.json` directly.

### Local Worker development

```sh
cd worker
wrangler dev
```

Spins up a local edge runtime with KV emulation. Hit `http://localhost:8787/trigger` to test.

### Restore KV from backup

If KV is ever wiped:

```sh
cd worker
wrangler kv key put --binding=IMGUR_KV state "$(cat ../backups/state.json)"
```

Then hit `/trigger` to regenerate `data` from `state`.

### Trigger sync manually

```sh
gh workflow run sync-from-worker.yml --repo akotzias/strongman-imgur
```

## Deploy

- **Page**: pushing to `main` (with changes under `public/**`) triggers `.github/workflows/update.yml`, which uploads `public/` to GitHub Pages. Worker pushes (under your PAT identity) and sync-workflow commits both re-trigger this — that's how new data lands on the site.
- **Worker**: deployed manually with `wrangler deploy` from `worker/`. Cron tick is `*/5 * * * *`. Cloudflare account: `akotzias-dev`. Requires the `GH_TOKEN` secret (see above).
