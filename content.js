// content.js — runs in page context to detect videos/files and inject a floating badge.

const MEDIA_EXT_RE = /\.(mp4|webm|mkv|m3u8|mpd|ogg|mov|m4v|avi|flv|ts|mp3|aac|wav|flac|m4a|pdf|zip|rar|7z|tar|gz|doc|docx|xls|xlsx|ppt|pptx|txt|csv|epub|apk|exe|dmg|iso|img|png|jpg|jpeg|gif|webp|svg|bmp|tiff)(\?|#|$)/i;

const PLATFORMS = [
  { id: "youtube",     re: /(?:youtube\.com|youtu\.be)/i,            name: "YouTube" },
  { id: "vimeo",       re: /vimeo\.com/i,                             name: "Vimeo" },
  { id: "instagram",   re: /instagram\.com/i,                         name: "Instagram" },
  { id: "tiktok",      re: /tiktok\.com/i,                            name: "TikTok" },
  { id: "twitter",     re: /(?:twitter|x)\.com/i,                     name: "Twitter / X" },
  { id: "threads",     re: /threads\.net/i,                           name: "Threads" },
  { id: "facebook",    re: /(?:facebook|fb\.watch)\.com/i,            name: "Facebook" },
  { id: "telegram",    re: /t\.me|telegram\.org/i,                    name: "Telegram" },
  { id: "pinterest",   re: /pinterest\.|pin\.it/i,                    name: "Pinterest" },
  { id: "terabox",     re: /terabox|teraboxapp|1024terabox/i,         name: "Terabox" },
  { id: "dailymotion", re: /dailymotion\.com/i,                       name: "Dailymotion" },
  { id: "reddit",      re: /reddit\.com|i\.redd\.it/i,                name: "Reddit" },
  { id: "twitch",      re: /twitch\.tv/i,                             name: "Twitch" },
];

function platformFromUrl(url) {
  if (!url) return null;
  for (const p of PLATFORMS) if (p.re.test(url)) return p;
  return null;
}

function safeUrl(raw) {
  if (!raw) return null;
  try { return new URL(raw, location.href).href; } catch { return null; }
}

function isDirectMedia(url) {
  if (!url) return false;
  try {
    const u = new URL(url, location.href);
    if (u.protocol === "blob:" || u.protocol === "data:") return false;
    return MEDIA_EXT_RE.test(u.pathname);
  } catch { return false; }
}

function extFromUrl(url) {
  try {
    const u = new URL(url, location.href);
    const m = u.pathname.match(/\.([a-z0-9]{2,4})(?:$|[^a-z0-9])/i);
    return m ? m[1].toLowerCase() : null;
  } catch { return null; }
}

function guessQuality(video) {
  if (!video) return "unknown";
  const w = video.videoWidth || 0;
  if (w >= 1920) return "1080p+";
  if (w >= 1280) return "720p";
  if (w >= 854) return "480p";
  if (w >= 640) return "360p";
  if (w > 0) return `${w}p`;
  return "unknown";
}

function makeId() {
  return "c_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function detect() {
  const results = [];
  const seen = new Set();
  const push = (item) => {
    if (!item || seen.has(item.url)) return;
    seen.add(item.url);
    results.push(item);
  };

  // <video> elements + <source> children
  document.querySelectorAll("video").forEach((v) => {
    const src = v.currentSrc || v.src;
    const url = safeUrl(src);
    if (url && url !== location.href) {
      const ext = extFromUrl(url);
      push({
        id: makeId(), url, type: "video-element",
        platform: platformFromUrl(url) || platformFromUrl(location.href),
        quality: guessQuality(v), ext, format: ext ? ext.toUpperCase() : "video",
        isStream: /m3u8|mpd/.test(url), title: document.title || "video",
      });
    }
    v.querySelectorAll("source").forEach((s) => {
      const u = safeUrl(s.src);
      if (u) {
        const ext = extFromUrl(u);
        const resAttr = s.getAttribute("res") || s.getAttribute("data-res") || s.getAttribute("label");
        push({
          id: makeId(), url: u, type: "source",
          platform: platformFromUrl(u) || platformFromUrl(location.href),
          quality: resAttr || guessQuality(v), ext,
          format: ext ? ext.toUpperCase() : "video",
          isStream: /m3u8|mpd/.test(u), title: document.title || "video",
        });
      }
    });
  });

  // <a> links to direct media/files (universal downloader)
  document.querySelectorAll("a[href]").forEach((a) => {
    const url = safeUrl(a.href);
    if (url && isDirectMedia(url)) {
      const ext = extFromUrl(url);
      push({
        id: makeId(), url, type: "link",
        platform: platformFromUrl(url) || platformFromUrl(location.href),
        quality: "unknown", ext, format: ext ? ext.toUpperCase() : "file",
        isStream: /m3u8|mpd/.test(url),
        title: (a.textContent || "").trim() || document.title || "file",
      });
    }
  });

  // <iframe> embeds (platform only)
  document.querySelectorAll("iframe[src]").forEach((f) => {
    const u = safeUrl(f.src);
    if (!u) return;
    const p = platformFromUrl(u);
    if (p && !results.some((r) => r.platform && r.platform.id === p.id)) {
      results.push({
        id: makeId(), url: u, type: "iframe-embed", platform: p,
        quality: "unknown", ext: null, format: "embed", isStream: false,
        title: document.title || p.name, embedOnly: true,
      });
    }
  });

  // Page itself is a known platform
  const pagePlatform = platformFromUrl(location.href);
  if (pagePlatform && !results.some((r) => r.platform && r.platform.id === pagePlatform.id)) {
    results.push({
      id: makeId(), url: location.href, type: "page", platform: pagePlatform,
      quality: "unknown", ext: null, format: "platform page", isStream: false,
      title: document.title || pagePlatform.name, embedOnly: true,
    });
  }

  return results;
}

// --- Floating badge ---------------------------------------------------------
let badge = null;
let badgeCount = 0;

function createBadge(count) {
  if (badge) { updateBadge(count); return; }
  badge = document.createElement("div");
  badge.id = "gvd-floating-badge";
  badge.className = "gvd-badge";
  badge.innerHTML = `
    <div class="gvd-badge__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M5 21h14"/>
      </svg>
    </div>
    <span class="gvd-badge__count">${count}</span>
  `;
  badge.title = "Glass Downloader: " + count + " item(s) detected. Click to open.";
  badge.addEventListener("click", showInlinePanel);
  document.documentElement.appendChild(badge);
  requestAnimationFrame(() => badge.classList.add("gvd-badge--in"));
}

function updateBadge(count) {
  if (!badge) return;
  badgeCount = count;
  badge.querySelector(".gvd-badge__count").textContent = count;
  badge.title = "Glass Downloader: " + count + " item(s) detected.";
  if (count === 0) {
    badge.classList.remove("gvd-badge--in");
    setTimeout(() => { if (badge && badgeCount === 0) { badge.remove(); badge = null; } }, 300);
  }
}

// --- Inline panel -----------------------------------------------------------
let panel = null;
function showInlinePanel() {
  if (panel) { panel.remove(); panel = null; return; }
  const videos = detect();
  panel = document.createElement("div");
  panel.className = "gvd-panel";
  const items = videos.map((v) => {
    const label = v.platform?.name || (v.title?.slice(0, 40)) || "file";
    const sub = `${v.format || ""} • ${v.quality || ""}`.replace(/^• | •$/,"").trim();
    const canDirect = !v.embedOnly && !v.isStream;
    return `
      <div class="gvd-panel__item" data-url="${encodeURIComponent(v.url)}" data-embed="${v.embedOnly ? "1" : "0"}">
        <div class="gvd-panel__meta">
          <span class="gvd-panel__title">${escapeHtml(label)}</span>
          <span class="gvd-panel__sub">${escapeHtml(sub)}</span>
        </div>
        <button class="gvd-panel__btn" data-act="${canDirect ? "dl" : "help"}">${canDirect ? "Download" : "Open"}</button>
      </div>`;
  }).join("") || `<div class="gvd-panel__empty">No direct media found. Open the extension popup for more options.</div>`;
  panel.innerHTML = `
    <div class="gvd-panel__header">
      <span>Detected items</span>
      <button class="gvd-panel__close" aria-label="Close">&times;</button>
    </div>
    <div class="gvd-panel__list">${items}</div>
  `;
  document.documentElement.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add("gvd-panel--in"));

  panel.querySelector(".gvd-panel__close").addEventListener("click", () => { panel.remove(); panel = null; });
  panel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const row = btn.closest("[data-url]");
    const url = decodeURIComponent(row.dataset.url);
    const act = btn.dataset.act;
    if (act === "dl") {
      chrome.runtime.sendMessage({ type: "GVD_DOWNLOAD", url, filename: undefined }, (res) => {
        if (res?.ok) { btn.textContent = "Started"; btn.disabled = true; }
        else { btn.textContent = "Failed"; btn.disabled = true; }
      });
    } else {
      chrome.runtime.sendMessage({ type: "GVD_OPEN_HELPER", url }, () => {
        btn.textContent = "Opened";
        btn.disabled = true;
      });
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- Run detection (only report on count change) ----------------------------
let lastCount = -1;
function runDetection() {
  const videos = detect();
  badgeCount = videos.length;
  if (videos.length > 0) createBadge(videos.length);
  else if (badge) updateBadge(0);
  if (videos.length !== lastCount) {
    lastCount = videos.length;
    chrome.runtime.sendMessage({ type: "GVD_REPORT_DETECTED", videos }).catch(() => {});
  }
  return videos;
}

let debounce = null;
const observer = new MutationObserver(() => {
  if (debounce) return;
  debounce = setTimeout(() => { debounce = null; runDetection(); }, 600);
});
observer.observe(document.documentElement, { childList: true, subtree: true });

setTimeout(runDetection, 800);

// --- Message handling -------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;
  if (msg.type === "GVD_DETECT_NOW") {
    const videos = runDetection();
    showInlinePanel();
    sendResponse({ ok: true, count: videos.length });
    return false;
  }
  if (msg.type === "GVD_GET_VIDEOS") {
    sendResponse(detect());
    return false;
  }
  return false;
});
