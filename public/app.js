const IMGUR_RE = /https?:\/\/(?:i\.|m\.)?imgur\.com\/[A-Za-z0-9./?=#&_-]+/gi;
const POLL_MS = 60_000;
const MORECHILDREN_BATCH = 100;

const fmtDate = (utc) => new Date(utc * 1000).toLocaleString();
const escapeHTML = (s) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function collectInto(listing, comments, moreQueue) {
  if (!listing || listing.kind !== "Listing") return;
  for (const c of listing.data.children) {
    if (c.kind === "t1") {
      comments.push(c.data);
      if (c.data.replies) collectInto(c.data.replies, comments, moreQueue);
    } else if (c.kind === "more") {
      if (c.data.children && c.data.children.length) {
        moreQueue.push({ kind: "ids", ids: [...c.data.children] });
      } else if (c.data.parent_id) {
        moreQueue.push({ kind: "continue", parentId: c.data.parent_id });
      }
    }
  }
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchAllComments(threadId, onProgress) {
  const data = await fetchJSON(
    `https://www.reddit.com/comments/${threadId}.json?raw_json=1&limit=500`
  );
  const totalReported = data[0]?.data?.children?.[0]?.data?.num_comments ?? null;

  const comments = [];
  const moreQueue = [];
  collectInto(data[1], comments, moreQueue);

  while (moreQueue.length) {
    onProgress?.(comments.length, totalReported, moreQueue.length);
    const item = moreQueue.shift();
    try {
      const things = [];
      if (item.kind === "ids") {
        for (let j = 0; j < item.ids.length; j += MORECHILDREN_BATCH) {
          const slice = item.ids.slice(j, j + MORECHILDREN_BATCH);
          const u =
            `https://www.reddit.com/api/morechildren.json?api_type=json&raw_json=1` +
            `&link_id=t3_${threadId}&children=${slice.join(",")}`;
          const j2 = await fetchJSON(u);
          things.push(...(j2.json?.data?.things || []));
        }
      } else if (item.kind === "continue") {
        const parentBase = item.parentId.replace(/^t1_/, "");
        const u = `https://www.reddit.com/comments/${threadId}/_/${parentBase}.json?raw_json=1&limit=500`;
        const j2 = await fetchJSON(u);
        const root = j2[1]?.data?.children?.[0];
        if (root?.kind === "t1") {
          comments.push(root.data);
          if (root.data.replies) collectInto(root.data.replies, comments, moreQueue);
        }
      }
      for (const t of things) {
        if (t.kind === "t1") {
          comments.push(t.data);
          if (t.data.replies) collectInto(t.data.replies, comments, moreQueue);
        } else if (t.kind === "more") {
          if (t.data.children?.length) moreQueue.push({ kind: "ids", ids: [...t.data.children] });
          else if (t.data.parent_id) moreQueue.push({ kind: "continue", parentId: t.data.parent_id });
        }
      }
    } catch (err) {
      console.warn("expand failed", err);
    }
  }

  // Dedupe by id (continue-thread fetches can overlap with morechildren).
  const byId = new Map();
  for (const c of comments) byId.set(c.id, c);
  return { comments: [...byId.values()], totalReported };
}

function extractEntries(comments) {
  const entries = [];
  for (const c of comments) {
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
      const { comments, totalReported } = await fetchAllComments(t.id, (loaded, total, queued) => {
        status.textContent = `Loading… ${loaded}${total ? ` / ${total}` : ""} comments, ${queued} batches queued`;
      });
      const entries = extractEntries(comments);
      section.removeChild(status);
      const summary = document.createElement("p");
      summary.className = "empty";
      summary.textContent = `${entries.length} imgur posts in ${comments.length}${totalReported ? ` / ${totalReported}` : ""} comments.`;
      section.appendChild(summary);
      for (const e of entries) section.appendChild(renderEntry(e));
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
