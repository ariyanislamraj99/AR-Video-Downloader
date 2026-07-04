// options.js — settings + history management for the options page.

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const canvas = $("#bg-canvas");
  const animator = new GradientAnimator(canvas, { palette: "aurora", speed: 0.0004 });
  animator.start();

  let currentTheme = "aurora";

  // --- Tabs -----------------------------------------------------------------
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => t.classList.remove("tab--active"));
      tab.classList.add("tab--active");
      $$(".panel").forEach((p) => p.classList.remove("panel--active"));
      $("#tab-" + tab.dataset.tab).classList.add("panel--active");
      if (tab.dataset.tab === "history") loadHistory();
    });
  });

  // --- Toast ----------------------------------------------------------------
  const toastEl = $("#toast");
  let toastTimer = null;
  function toast(msg, kind = "info") {
    toastEl.textContent = msg;
    toastEl.className = "toast toast--show toast--" + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = "toast"; }, 2400);
  }

  // --- Messaging ------------------------------------------------------------
  function send(type, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(res);
      });
    });
  }

  // --- Load settings --------------------------------------------------------
  async function loadSettings() {
    const s = await send("GVD_GET_SETTINGS");
    if (!s) return;
    $("#default-quality").value = s.defaultQuality || "best";
    $("#external-helper").value = s.externalHelper || "";
    $("#extraction-endpoint").value = s.extractionEndpoint || "";
    $("#auto-detect").checked = s.autoDetect !== false;
    $("#save-history").checked = s.saveHistory !== false;
    $("#max-history").value = s.maxHistory || 100;
    setTheme(s.theme || "aurora");
  }

  function setTheme(name) {
    currentTheme = name;
    animator.setPalette(name);
    $$(".theme-chip").forEach((c) => {
      c.setAttribute("aria-pressed", String(c.dataset.theme === name));
    });
  }

  $$(".theme-chip").forEach((chip) => {
    chip.addEventListener("click", () => setTheme(chip.dataset.theme));
  });

  // --- Save settings --------------------------------------------------------
  $("#save-btn").addEventListener("click", async () => {
    const settings = {
      defaultQuality: $("#default-quality").value,
      externalHelper: $("#external-helper").value.trim(),
      extractionEndpoint: $("#extraction-endpoint").value.trim(),
      autoDetect: $("#auto-detect").checked,
      saveHistory: $("#save-history").checked,
      maxHistory: parseInt($("#max-history").value, 10) || 100,
      theme: currentTheme,
    };
    await send("GVD_SAVE_SETTINGS", { settings });
    const status = $("#save-status");
    status.textContent = "Saved";
    status.classList.add("save-status--show");
    setTimeout(() => status.classList.remove("save-status--show"), 1800);
    toast("Settings saved", "success");
  });

  // --- History --------------------------------------------------------------
  function formatBytes(n) {
    if (!n) return "—";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v < 10 && i > 0 ? 1 : 0) + " " + u[i];
  }

  function timeAgo(ts) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24);
    return d + "d ago";
  }

  async function loadHistory() {
    const list = $("#history-list");
    list.innerHTML = `<div class="skeleton-list"><div class="skeleton"></div><div class="skeleton"></div></div>`;
    const res = await send("GVD_GET_HISTORY");
    const history = res?.history || [];
    if (history.length === 0) {
      list.innerHTML = `<div class="history-empty">No downloads yet. Detected videos will appear here after you download them.</div>`;
      return;
    }
    list.innerHTML = "";
    history.forEach((h, i) => {
      const item = document.createElement("div");
      item.className = "history-item";
      item.style.animationDelay = `${i * 0.04}s`;
      const name = (h.filename || "").split(/[\\/]/).pop() || "video";
      const statusClass = h.status === "complete" ? "history-item__status--complete" : "history-item__status--started";
      item.innerHTML = `
        <div class="history-item__thumb">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>
          </svg>
        </div>
        <div class="history-item__body">
          <div class="history-item__name">${escapeHtml(name)}</div>
          <div class="history-item__meta">
            <span class="history-item__status ${statusClass}">${escapeHtml(h.status || "started")}</span>
            <span>${formatBytes(h.fileSize)}</span>
            <span>${timeAgo(h.ts)}</span>
          </div>
        </div>
      `;
      list.appendChild(item);
    });
  }

  $("#clear-history").addEventListener("click", async () => {
    if (!confirm("Clear all download history?")) return;
    await send("GVD_CLEAR_HISTORY");
    loadHistory();
    toast("History cleared", "success");
  });

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // --- Init -----------------------------------------------------------------
  loadSettings();
})();
