const DATA_URL = "./data.json";
const MEDIA_MODE_KEY = "strongman-imgur:media-mode";
const LAZY_MARGIN = "600px 0px";

let mediaMode = localStorage.getItem(MEDIA_MODE_KEY) === "1";
let lastData = null;

const fmtDate = (utc) => new Date(utc * 1000).toLocaleString();
const escapeHTML = (s) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const escapeAttr = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function linkify(body) {
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|https?:\/\/[^\s\])]+/g;
  const out = [];
  let i = 0;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push(escapeHTML(body.slice(i, m.index)));
    let text, url;
    if (m[1] !== undefined) {
      text = m[1];
      url = m[2].replace(/[).,]+$/, "");
    } else {
      url = m[0].replace(/[).,]+$/, "");
      text = url;
    }
    out.push(
      `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHTML(text)}</a>`
    );
    i = m.index + m[0].length;
  }
  out.push(escapeHTML(body.slice(i)));
  return out.join("");
}

function scanStatus(t) {
  const n = t.entries.length;
  const noun = n === 1 ? "imgur post" : "imgur posts";
  const fmt = (x) => x.toLocaleString();
  const loaded = t.total_comments_loaded;
  const reported = t.total_comments_reported;
  const fullyScanned = !t.backfill_pending || (reported && loaded >= reported);
  if (!fullyScanned && reported) {
    const pct = Math.min(100, Math.round((loaded / reported) * 100));
    return `${n} ${noun} · ${pct}% scanned (${fmt(loaded)} out of ${fmt(reported)} comments) — older comments may still be missing.`;
  }
  return `${n} ${noun} · all ${fmt(loaded)} comments scanned.`;
}

// --- imgur classification + media building (used only when media mode is on) ---

const IMGUR_CLASSIFY_RE =
  /^https?:\/\/(?:www\.|m\.)?imgur\.com\/(a|gallery)\/([A-Za-z0-9]+)|^https?:\/\/(?:www\.|m\.)?imgur\.com\/([A-Za-z0-9]{5,8})(?:\.[a-z]+)?(?:[/?#]|$)|^https?:\/\/i\.imgur\.com\/([A-Za-z0-9]+)\.([a-z0-9]+)/;

function classifyImgur(url) {
  const m = url.match(IMGUR_CLASSIFY_RE);
  if (!m) return null;
  if (m[1]) return { kind: "album", id: m[2], url };
  if (m[3]) return { kind: "single", id: m[3], url };
  if (m[4]) {
    const ext = m[5].toLowerCase();
    if (ext === "gifv" || ext === "mp4" || ext === "webm") {
      return { kind: "video", id: m[4], url };
    }
    return { kind: "direct", id: m[4], ext, url };
  }
  return null;
}

function buildMediaItem(parsed) {
  const fallback = `<a href="${escapeAttr(parsed.url)}" target="_blank" rel="noopener">View on imgur</a>`;
  if (parsed.kind === "direct") {
    const src = `https://i.imgur.com/${escapeAttr(parsed.id)}.${escapeAttr(parsed.ext)}`;
    return `<a class="media direct" href="${escapeAttr(parsed.url)}" target="_blank" rel="noopener">
      <img class="lazy-img" decoding="async" data-src="${escapeAttr(src)}" alt="" />
    </a>`;
  }
  if (parsed.kind === "video") {
    return `<video class="media direct" controls preload="none" playsinline loop muted
      poster="https://i.imgur.com/${escapeAttr(parsed.id)}h.jpg"
      src="https://i.imgur.com/${escapeAttr(parsed.id)}.mp4"></video>`;
  }
  if (parsed.kind === "single") {
    const jpeg = `https://i.imgur.com/${escapeAttr(parsed.id)}.jpeg`;
    const png = `https://i.imgur.com/${escapeAttr(parsed.id)}.png`;
    return `<a class="media single" href="${escapeAttr(parsed.url)}" target="_blank" rel="noopener">
      <img class="lazy-img" decoding="async"
        data-src="${escapeAttr(jpeg)}"
        data-fallback="${escapeAttr(png)}"
        alt="" />
    </a>`;
  }
  if (parsed.kind === "album") {
    return `<div class="media album" data-album-id="${escapeAttr(parsed.id)}" data-album-url="${escapeAttr(parsed.url)}">
      <div class="album-placeholder">${fallback}</div>
    </div>`;
  }
  return fallback;
}

let imgurEmbedScriptLoaded = false;
function ensureImgurEmbedScript() {
  if (imgurEmbedScriptLoaded) return;
  imgurEmbedScriptLoaded = true;
  const s = document.createElement("script");
  s.async = true;
  s.charset = "utf-8";
  s.src = "https://s.imgur.com/min/embed.js";
  s.onload = () => {
    if (window.imgurEmbed && typeof window.imgurEmbed.createIframe === "function") {
      try { window.imgurEmbed.createIframe(); } catch (_) {}
    }
  };
  document.body.appendChild(s);
}

function hydrateAlbum(el) {
  if (el.dataset.hydrated === "1") return;
  el.dataset.hydrated = "1";
  const id = el.dataset.albumId;
  const url = el.dataset.albumUrl;
  el.innerHTML = `<blockquote class="imgur-embed-pub" lang="en" data-id="a/${escapeAttr(id)}" data-context="false">
    <a href="${escapeAttr(url)}" target="_blank" rel="noopener">View album on imgur</a>
  </blockquote>`;
  ensureImgurEmbedScript();
  if (window.imgurEmbed && typeof window.imgurEmbed.createIframe === "function") {
    try { window.imgurEmbed.createIframe(); } catch (_) {}
  }
}

function hydrateImage(img) {
  if (img.dataset.hydrated === "1") return;
  img.dataset.hydrated = "1";
  const src = img.dataset.src;
  const fallback = img.dataset.fallback;
  if (fallback) {
    img.onerror = () => {
      img.onerror = null;
      img.src = fallback;
    };
  }
  if (src) img.src = src;
}

function setupLazyHydration(root) {
  const albums = [...root.querySelectorAll(".media.album")];
  const images = [...root.querySelectorAll("img.lazy-img")];
  const supported = "IntersectionObserver" in window;
  if (!supported) {
    albums.forEach(hydrateAlbum);
    images.forEach(hydrateImage);
    return;
  }
  const marginPx = parseInt(LAZY_MARGIN, 10) || 800;
  const isNearViewport = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return r.bottom > -marginPx && r.top < vh + marginPx;
  };
  const albumIO = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        hydrateAlbum(entry.target);
        albumIO.unobserve(entry.target);
      }
    }
  }, { rootMargin: LAZY_MARGIN });
  const imgIO = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        hydrateImage(entry.target);
        imgIO.unobserve(entry.target);
      }
    }
  }, { rootMargin: LAZY_MARGIN });
  for (const el of albums) {
    if (isNearViewport(el)) hydrateAlbum(el);
    else albumIO.observe(el);
  }
  for (const el of images) {
    if (isNearViewport(el)) hydrateImage(el);
    else imgIO.observe(el);
  }
}

// --- entry rendering ---

function renderEntry(e) {
  const div = document.createElement("div");
  div.className = "entry";
  let mediaHTML = "";
  if (mediaMode) {
    const parsedLinks = (e.links || []).map(classifyImgur).filter(Boolean);
    if (parsedLinks.length) {
      mediaHTML = `<div class="media-grid${parsedLinks.length > 1 ? " multi" : ""}">${parsedLinks.map(buildMediaItem).join("")}</div>`;
    }
  }
  div.innerHTML = `
    <div class="meta">
      <strong>${escapeHTML(e.author)}</strong> · ${fmtDate(e.created_utc)} ·
      <a href="${e.permalink}" target="_blank" rel="noopener">on reddit</a>
    </div>
    <div class="body">${linkify(e.body)}</div>
    ${mediaHTML}
  `;
  return div;
}

function renderData(data) {
  const generated = document.getElementById("generated");
  const root = document.getElementById("threads");
  generated.textContent =
    `Last server update: ${new Date(data.generated_at).toLocaleString()}`;
  root.innerHTML = "";
  for (const t of data.threads) {
    const details = document.createElement("details");
    details.className = "thread";
    const summary = document.createElement("summary");
    summary.innerHTML = `
      <h2><a href="${t.url}" target="_blank" rel="noopener">${escapeHTML(t.title)}</a></h2>
      <span class="thread-status">${escapeHTML(scanStatus(t))}</span>
    `;
    details.appendChild(summary);
    const newestFirst = [...t.entries].sort((a, b) => b.created_utc - a.created_utc);
    for (const e of newestFirst) details.appendChild(renderEntry(e));
    root.appendChild(details);
  }
  if (mediaMode) setupLazyHydration(root);
}

// --- toggle wiring ---

function initToggle() {
  const toggle = document.getElementById("media-toggle");
  if (!toggle) return;
  toggle.checked = mediaMode;
  toggle.addEventListener("change", (e) => {
    mediaMode = e.target.checked;
    localStorage.setItem(MEDIA_MODE_KEY, mediaMode ? "1" : "0");
    if (lastData) renderData(lastData);
  });
}

async function refresh() {
  const res = await fetch(DATA_URL);
  if (!res.ok) {
    document.getElementById("generated").textContent =
      `Couldn't load data.json (${res.status} ${res.statusText}).`;
    return;
  }
  lastData = await res.json();
  renderData(lastData);
}

initToggle();
refresh();
