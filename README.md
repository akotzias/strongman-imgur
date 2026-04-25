# strongman-imgur

Static site that lists every Reddit comment containing an imgur link from a curated set of threads. Fetching happens **client-side in the visitor's browser** (Reddit blocks GitHub Actions runner IPs), so the data is always live and refreshes every 60 seconds.

## Layout

- `public/threads.json` — the list of threads to render: `{id, title, url}` per entry.
- `public/app.js` — fetches `https://www.reddit.com/comments/<id>.json` for each thread, walks the comment tree, extracts imgur URLs, renders one section per thread.
- `public/index.html` + `style.css` — the page.
- `.github/workflows/update.yml` — deploys `public/` to GitHub Pages on push.

## Add another thread

Edit `public/threads.json` and append:

```json
{
  "id": "abc123",
  "title": "Some other thread",
  "url": "https://www.reddit.com/r/.../comments/abc123/..."
}
```

The `id` is the alphanumeric segment after `/comments/` in the URL. Push to `main` and Pages redeploys.

## Local

Open `public/index.html` directly in a browser, or:

```sh
python3 -m http.server -d public 8080
```
