const IMGUR_RE = /https?:\/\/(?:i\.|m\.)?imgur\.com\/[A-Za-z0-9./?=#&_-]+/gi;
const POLL_MS = 60_000;

const fmtDate = (utc) => new Date(utc * 1000).toLocaleString();
const escapeHTML = (s) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function* walkComments(listing) {
  if (!listing || listing.kind !== "Listing") return;
  for (const child of listing.data.children) {
    if (child.kind !== "t1") continue;
    yield child.data;
    if (child.data.replies) yield* walkComments(child.data.replies);
  }
}

function extractEntries(redditJson) {
  const entries = [];
  for (const c of walkComments(redditJson[1])) {
    if (!c.body) continue;
    const found = c.body.match(IMGUR_RE) || [];
    if (!found.length) continue;
    const links = [...new Set(found.map((u) => u.replace(/[).,]+$/, "")))];
    entries.push({
      author: c.author,
      created_utc: c.created_utc,
      permalink: `https://www.reddit.com${c.permalink}`,
      body: c.body,
      links,
    });
  }
  entries.sort((a, b) => a.created_utc - b.created_utc);
  return entries;
}

function linkify(body, imgurLinks) {
  const set = new Set(imgurLinks);
  return escapeHTML(body).replace(/https?:\/\/[^\s)]+/g, (url) => {
    const clean = url.replace(/[).,]+$/, "");
    if (set.has(clean)) return `<a href="${clean}" target="_blank" rel="noopener">${clean}</a>`;
    return url;
  });
}

function renderEntry(e) {
  const div = document.createElement("div");
  div.className = "entry";
  div.innerHTML = `
    <div class="meta">
      <strong>${escapeHTML(e.author)}</strong> · ${fmtDate(e.created_utc)} ·
      <a href="${e.permalink}" target="_blank" rel="noopener">on reddit</a>
    </div>
    <div class="body">${linkify(e.body, e.links)}</div>
  `;
  return div;
}

async function fetchThread(id) {
  const url = `https://www.reddit.com/comments/${id}.json?raw_json=1&limit=500`;
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`reddit ${id}: ${res.status} ${res.statusText}`);
  return res.json();
}

async function refresh(threads) {
  const root = document.getElementById("threads");
  root.innerHTML = "";
  for (const t of threads) {
    const section = document.createElement("section");
    const h2 = document.createElement("h2");
    h2.innerHTML = `<a href="${t.url}" target="_blank" rel="noopener">${escapeHTML(t.title)}</a>`;
    section.appendChild(h2);
    const status = document.createElement("p");
    status.className = "empty";
    status.textContent = "Loading…";
    section.appendChild(status);
    root.appendChild(section);

    try {
      const json = await fetchThread(t.id);
      const entries = extractEntries(json);
      section.removeChild(status);
      if (!entries.length) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No imgur links found in comments.";
        section.appendChild(p);
      } else {
        for (const e of entries) section.appendChild(renderEntry(e));
      }
    } catch (err) {
      status.textContent = `Failed to load: ${err.message}`;
    }
  }
  document.getElementById("generated").textContent =
    `Last updated: ${new Date().toLocaleString()} (auto-refresh every 60s)`;
}

async function main() {
  const threads = await (await fetch("./threads.json", { cache: "no-cache" })).json();
  await refresh(threads);
  setInterval(() => refresh(threads), POLL_MS);
}

main();
