# strongman-imgur

Static site that lists every Reddit comment containing an imgur link from a curated set of threads.

**Live:** https://akotzias.github.io/strongman-imgur/

> **Status: frozen.** This page is no longer being updated. The Cloudflare Worker that scraped Reddit and pushed fresh `data.json` commits was decommissioned on 2026-04-27; the page now serves whatever was committed last (see `public/data.json`). The static site itself, including the inline-media toggle and the Duke Nukem easter egg, still works.

## Architecture (current — static only)

```
   ┌─────────────────────────────┐    push to main (public/**)
   │  GitHub repo                │ ───────────────┐
   │  • public/data.json         │                ▼
   │    (frozen snapshot)        │     ┌──────────────────────┐
   │  • public/{index,app,…}     │     │ .github/workflows/   │
   └─────────────────────────────┘     │ update.yml           │
                                       │ uploads public/ to   │
                                       │ GitHub Pages         │
                                       └──────────┬───────────┘
                                                  ▼
   ┌─────────────────────────────┐     ┌──────────────────────┐
   │  Visitor                    │ ──► │  GitHub Pages        │
   │  one fetch on load          │ ◄── │  serves public/*     │
   └─────────────────────────────┘     └──────────────────────┘
```

The page does **one** `fetch('./data.json')` on load. No polling, no third-party requests by default. Data is whatever the last commit to `public/data.json` contains.

## What was removed (2026-04-27)

For history / future revival:

- **Cloudflare Worker** `strongman-imgur` (account `akotzias-dev`) — ran a `*/30 * * * *` cron that scraped Reddit and pushed `public/data.json` + `backups/state.json` directly to this repo via the GitHub Contents API.
- **Workers KV namespace** `IMGUR_KV` (id `8dbddb7408e543828a0fad2ff2e99339`) — held `state` (full accumulator), `data` (page-facing JSON), and `gh-sha:<path>` cache entries.
- **Sync GitHub Action** `.github/workflows/sync-from-worker.yml` — fallback cron that pulled the same JSON via `curl` if the Worker push failed.
- **Fine-grained PAT** `GH_TOKEN` (Contents: read+write, scoped to `akotzias/strongman-imgur`) — Worker secret used for the direct push. Should be revoked at https://github.com/settings/personal-access-tokens.

The Worker source lived at `worker/src/index.js` with `worker/wrangler.toml`. To revive: re-add the directory from git history (`git log -- worker/`), recreate the KV namespace (`wrangler kv namespace create IMGUR_KV` — new id, paste into `wrangler.toml`), re-add `GH_TOKEN` (`wrangler secret put GH_TOKEN`), `cd worker && wrangler deploy`. Reddit blocks GitHub Actions runner IPs but not Cloudflare's, which is the original reason scraping had to live on a Worker.

## Page UI

- **Featured-thread convention.** The first entry in `public/threads.json` renders as a plain expanded `<section>`. Every thread after it renders as a `<details>` (collapsed by default, click the title row to expand). Order threads with the active/most-relevant one first.
- **Inline-media toggle.** A checkbox above the donate button labelled "Show images and videos inline" flips between the default text-only view and an inline-media view that lazy-loads imgur images, videos, and albums (the last via imgur's official `embed.js`). The choice is persisted in `localStorage` under `strongman-imgur:media-mode`, default off, so a fresh visitor sees the lightweight version with no third-party requests.
- **Cloudflare Web Analytics** is loaded on every page (`static.cloudflareinsights.com/beacon.min.js`). Stats at https://dash.cloudflare.com/cf98d411f226fa47cfa34d6f77c8f2fb/web-analytics — filter by path `/strongman-imgur/` to scope to this site.
- **Easter egg page** at `/strongman-imgur/soph/` reuses the same `app.js`/`style.css` (via `<base href>`) and adds a small randomised gallery of Duke Nukem 1991 images from Wikipedia and the Internet Archive.

## Repo layout

```
strongman-imgur/
├── public/                    GitHub Pages root
│   ├── index.html
│   ├── style.css
│   ├── app.js                 fetches ./data.json, renders
│   ├── threads.json           curated list of threads (1st = featured/expanded)
│   └── data.json              frozen snapshot — last write 2026-04-27
├── backups/
│   └── state.json             last full state from the Worker (frozen)
└── .github/workflows/
    └── update.yml             GH Pages deploy on push to public/
```

## Operations

### Local site preview

```sh
python3 -m http.server -d public 8080
```

Then open http://localhost:8080. Reads the committed `public/data.json` directly.

### Force-deploy

```sh
gh workflow run update.yml --repo akotzias/strongman-imgur
```

### Edit the page

Push to `main` with changes under `public/**` and `update.yml` will redeploy GitHub Pages. The featured-thread convention and the inline-media toggle are documented above.
