// background.js — MV3 service worker
// Handles: context menus, badge, downloads, network media capture,
// universal file download, platform extraction via Supabase edge function,
// and messaging bridge between popup/options and content scripts.

import { detectPlatform, isMediaUrl, extFromUrl } from "./lib/platforms.js";

const DEFAULT_SETTINGS = {
  defaultQuality: "best",
  autoDetect: true,
  theme: "aurora",
  // Optional Supabase edge function that runs yt-dlp server-side.
  // If empty, platform videos fall back to the external helper URL.
  extractionEndpoint: "",
  externalHelper: "https://cobalt.tools/api/", // user-configurable fallback
  saveHistory: true,
  maxHistory: 100,
};

// --- Settings helpers -------------------------------------------------------
async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...s };
}

async function saveSettings(partial) {
  const cur = await getSettings();
  const next = { ...cur, ...partial };
  await chrome.storage.sync.set(next);
  return next;
}

// --- History helpers --------------------------------------------------------
async function getHistory() {
  const { history = [] } = await chrome.storage.local.get("history");
  return history;
}

async function addHistory(entry) {
  const settings = await getSettings();
  if (!settings.saveHistory) return;
  const history = await getHistory();
  history.unshift({ ...entry, ts: Date.now() });
  if (history.length > settings.maxHistory) history.length = settings.maxHistory;
  await chrome.storage.local.set({ history });
}

async function clearHistory() {
  await chrome.storage.local.set({ history: [] });
}

// --- Detected cache (persisted to session storage to survive SW restarts) ---
async function getDetectedCache() {
  const { detected = {} } = await chrome.storage.session.get("detected");
  return detected;
}

async function setDetectedForTab(tabId, videos) {
  const detected = await getDetectedCache();
  detected[String(tabId)] = videos;
  await chrome.storage.session.set({ detected });
}

async function getDetectedForTab(tabId) {
  const detected = await getDetectedCache();
  return detected[String(tabId)] || [];
}

async function clearDetectedForTab(tabId) {
  const detected = await getDetectedCache();
  delete detected[String(tabId)];
  await chrome.storage.session.set({ detected });
}

async function mergeDetectedForTab(tabId, newVideos, source) {
  const existing = await getDetectedForTab(tabId);
  const seen = new Set(existing.map((v) => v.url));
  for (const v of newVideos) {
    if (!seen.has(v.url)) {
      existing.push(v);
      seen.add(v.url);
    }
  }
  await setDetectedForTab(tabId, existing);
  return existing;
}

// --- Badge ------------------------------------------------------------------
async function updateBadgeForTab(tabId) {
  try {
    const settings = await getSettings();
    if (!settings.autoDetect) {
      await chrome.action.setBadgeText({ tabId, text: "" });
      return;
    }
    const videos = await getDetectedForTab(tabId);
    const count = videos.length;
    if (count > 0) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#22d3ee" });
      await chrome.action.setBadgeText({ tabId, text: String(count) });
    } else {
      await chrome.action.setBadgeText({ tabId, text: "" });
    }
  } catch {
    // tab may be gone
  }
}

// --- Network media capture (webRequest, observational) ----------------------
const MEDIA_TYPE_RE = /^video\/|application\/vnd\.apple\.mpegurl|application\/dash\+xml|application\/x-mpegurl|audio\//i;

chrome.webRequest.onHeadersReceived.addListener(
  async (details) => {
    if (details.tabId < 0) return;
    const ct = details.responseHeaders?.find((h) => h.name.toLowerCase() === "content-type");
    const ctMedia = ct && MEDIA_TYPE_RE.test(ct.value || "");
    const urlMedia = isMediaUrl(details.url);
    if (!ctMedia && !urlMedia) return;
    const ext = extFromUrl(details.url);
    const existing = await getDetectedForTab(details.tabId);
    if (existing.some((v) => v.url === details.url)) return;
    const entry = {
      id: "n_" + Math.random().toString(36).slice(2, 8),
      url: details.url,
      type: "network",
      platform: detectPlatform(details.url),
      quality: "unknown",
      ext,
      format: ext ? ext.toUpperCase() : "media",
      isStream: /m3u8|mpd/.test(details.url),
      title: "network media",
    };
    await mergeDetectedForTab(details.tabId, [entry], "network");
    updateBadgeForTab(details.tabId);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// --- Context menu -----------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "gvd-detect-page", title: "Detect videos on this page", contexts: ["page", "frame"] });
  chrome.contextMenus.create({ id: "gvd-dl-link", title: "Download this link (video/file)", contexts: ["link"] });
  chrome.contextMenus.create({ id: "gvd-dl-video", title: "Download this video", contexts: ["video"] });
  chrome.contextMenus.create({ id: "gvd-dl-any", title: "Download this file", contexts: ["link", "image", "video", "audio"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "gvd-detect-page") {
    chrome.tabs.sendMessage(tab.id, { type: "GVD_DETECT_NOW" }).catch(() => {});
  } else if (info.menuItemId === "gvd-dl-link" && info.linkUrl) {
    startDownloadFromUrl(tab.id, info.linkUrl, "link");
  } else if (info.menuItemId === "gvd-dl-video" && info.srcUrl) {
    startDownloadFromUrl(tab.id, info.srcUrl, "video");
  } else if (info.menuItemId === "gvd-dl-any") {
    const url = info.linkUrl || info.srcUrl;
    if (url) startDownloadFromUrl(tab.id, url, "file");
  }
});

async function startDownloadFromUrl(tabId, url, source) {
  const ext = extFromUrl(url) || "bin";
  const filename = `download_${Date.now()}.${ext}`;
  chrome.downloads.download({ url, filename, saveAs: true }, (id) => {
    if (chrome.runtime.lastError) {
      console.warn("[GVD] download failed:", chrome.runtime.lastError.message);
      return;
    }
    addHistory({ url, filename, source, status: "started", id });
  });
}

// --- Download progress tracking --------------------------------------------
chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.state?.current === "complete") {
    const d = await chrome.downloads.search({ id: delta.id });
    const item = d?.[0];
    addHistory({
      url: item?.url || "",
      filename: item?.filename || "",
      source: "download",
      status: "complete",
      id: delta.id,
      fileSize: item?.fileSize || 0,
    });
  }
});

// --- Platform extraction via Supabase edge function -------------------------
// Calls the user-configured extraction endpoint (yt-dlp backend) to resolve
// direct download URLs for platform-restricted videos.
async function extractPlatformVideo(url, requestedQuality) {
  const settings = await getSettings();
  if (!settings.extractionEndpoint) {
    return { ok: false, error: "no_backend", helper: settings.externalHelper };
  }
  try {
    const res = await fetch(settings.extractionEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, quality: requestedQuality || "best" }),
    });
    if (!res.ok) {
      return { ok: false, error: `backend_${res.status}`, helper: settings.externalHelper };
    }
    const data = await res.json();
    if (data && Array.isArray(data.formats) && data.formats.length) {
      return { ok: true, formats: data.formats, title: data.title };
    }
    return { ok: false, error: data?.error || "no_formats", helper: settings.externalHelper };
  } catch (e) {
    return { ok: false, error: "network", helper: settings.externalHelper };
  }
}

// --- Messaging bridge -------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  switch (msg.type) {
    case "GVD_GET_DETECTED": {
      (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return sendResponse({ videos: [] });
        let dom = [];
        try {
          dom = await chrome.tabs.sendMessage(tab.id, { type: "GVD_GET_VIDEOS" });
          if (!Array.isArray(dom)) dom = [];
        } catch { dom = []; }
        const net = await getDetectedForTab(tab.id);
        // Merge, dedupe by url, prefer DOM (has richer metadata) then network
        const seen = new Set();
        const merged = [];
        for (const v of [...dom, ...net]) {
          if (!v || seen.has(v.url)) continue;
          seen.add(v.url);
          merged.push(v);
        }
        await setDetectedForTab(tab.id, merged);
        sendResponse({ videos: merged, tabId: tab.id });
      })();
      return true;
    }

    case "GVD_DOWNLOAD": {
      const { url, filename } = msg;
      chrome.downloads.download({ url, filename: filename || undefined, saveAs: true }, (id) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          addHistory({ url, filename, source: "popup", status: "started", id });
          sendResponse({ ok: true, id });
        }
      });
      return true;
    }

    case "GVD_EXTRACT_PLATFORM": {
      (async () => {
        const result = await extractPlatformVideo(msg.url, msg.quality);
        sendResponse(result);
      })();
      return true;
    }

    case "GVD_OPEN_HELPER": {
      (async () => {
        const settings = await getSettings();
        const helper = settings.externalHelper || "";
        const target = helper + encodeURIComponent(msg.url);
        chrome.tabs.create({ url: target });
        sendResponse({ ok: true });
      })();
      return true;
    }

    case "GVD_GET_SETTINGS":
      getSettings().then(sendResponse);
      return true;

    case "GVD_SAVE_SETTINGS":
      saveSettings(msg.settings || {}).then(sendResponse);
      return true;

    case "GVD_GET_HISTORY":
      getHistory().then(sendResponse);
      return true;

    case "GVD_CLEAR_HISTORY":
      clearHistory().then(() => sendResponse({ ok: true }));
      return true;

    case "GVD_REPORT_DETECTED": {
      if (sender.tab?.id != null) {
        mergeDetectedForTab(sender.tab.id, msg.videos || [], "dom").then(() => {
          updateBadgeForTab(sender.tab.id);
        });
      }
      return false;
    }

    default:
      return false;
  }
});

// --- Tab lifecycle ----------------------------------------------------------
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (change.status === "complete") {
    // Clear network-captured entries (page reloaded); DOM will repopulate.
    const existing = await getDetectedForTab(tabId);
    const domOnly = existing.filter((v) => v.type !== "network");
    await setDetectedForTab(tabId, domOnly);
    updateBadgeForTab(tabId);
  }
});

chrome.tabs.onActivated.addListener((info) => updateBadgeForTab(info.tabId));
chrome.tabs.onRemoved.addListener((tabId) => clearDetectedForTab(tabId));
