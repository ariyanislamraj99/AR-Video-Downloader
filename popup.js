// popup.js — popup UI: video list with 1-click download, universal URL bar,
// format/quality selection, platform extraction via backend.

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const listEl = $("#video-list");
  const formatPanel = $("#format-panel");
  const emptyEl = $("#empty");
  const statusEl = $("#status");
  const toastEl = $("#toast");

  let currentVideos = [];
  let selectedItem = null;
  let selectedFormat = null;
  let resolvedFormats = [];
  let defaultQuality = "best";

  // --- Gradient background (guard if lib failed to load) --------------------
  const canvas = $("#bg-canvas");
  if (typeof GradientAnimator !== "undefined" && canvas) {
    const animator = new GradientAnimator(canvas, { palette: "aurora", speed: 0.0005 });
    animator.start();
  }

  // --- Toast ----------------------------------------------------------------
  let toastTimer = null;
  function toast(msg, kind = "info") {
    toastEl.textContent = msg;
    toastEl.className = "toast toast--show toast--" + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = "toast"; }, 2600);
  }

  // --- Ripple on buttons ----------------------------------------------------
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn, .url-btn, .video-card__dl");
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const r = document.createElement("span");
    r.className = "ripple";
    const size = Math.max(rect.width, rect.height);
    r.style.width = r.style.height = size + "px";
    r.style.left = e.clientX - rect.left - size / 2 + "px";
    r.style.top = e.clientY - rect.top - size / 2 + "px";
    btn.appendChild(r);
    setTimeout(() => r.remove(), 600);
  });

  // --- Messaging ------------------------------------------------------------
  function send(type, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(res);
      });
    });
  }

  // --- Escape helper --------------------------------------------------------
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // --- 1-click download (direct media only) ---------------------------------
  function quickDownload(url, btn) {
    send("GVD_DOWNLOAD", { url, filename: undefined }).then((res) => {
      if (res?.ok) {
        toast("Download started", "success");
        if (btn) { btn.innerHTML = checkSvg(); }
      } else {
        toast(res?.error || "Download failed", "error");
        if (btn) { btn.disabled = false; }
      }
    });
  }

  function checkSvg() {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  }

  function dlSvg() {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M5 21h14"/></svg>`;
  }

  // --- Render video list ----------------------------------------------------
  function renderList(videos) {
    currentVideos = videos || [];
    listEl.innerHTML = "";
    if (currentVideos.length === 0) {
      listEl.hidden = true;
      emptyEl.hidden = false;
      statusEl.textContent = "No videos found";
      return;
    }
    listEl.hidden = false;
    emptyEl.hidden = true;
    statusEl.textContent = `${currentVideos.length} item${currentVideos.length > 1 ? "s" : ""} found`;

    currentVideos.forEach((v, i) => {
      const card = document.createElement("div");
      card.className = "video-card";
      card.style.animationDelay = `${i * 0.05}s`;

      const platformName = v.platform?.name || (v.embedOnly ? "Platform" : "Direct");
      const badgeClass = v.isStream ? "badge--stream" : (v.embedOnly ? "badge--platform" : "");
      const badgeText = v.isStream ? "STREAM" : (v.embedOnly ? "PLATFORM" : (v.ext || "FILE").toUpperCase());
      const canDirect = !v.embedOnly && !v.isStream;

      card.innerHTML = `
        <div class="video-card__thumb">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>
          </svg>
        </div>
        <div class="video-card__body">
          <div class="video-card__title">${escapeHtml(platformName)}</div>
          <div class="video-card__meta">
            <span class="badge ${badgeClass}">${badgeText}</span>
            <span>${escapeHtml(v.quality || "")}</span>
          </div>
        </div>
        <button class="video-card__dl ${canDirect ? "" : "video-card__dl--ghost"}" title="${canDirect ? "1-click download" : "Open format options"}" aria-label="Download">${canDirect ? dlSvg() : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'}</button>
      `;

      // 1-click download button
      const dlBtn = card.querySelector(".video-card__dl");
      dlBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (canDirect) {
          dlBtn.disabled = true;
          quickDownload(v.url, dlBtn);
        } else {
          openFormatPanel(v);
        }
      });

      // Click card body → format panel
      card.querySelector(".video-card__body").addEventListener("click", () => openFormatPanel(v));
      card.querySelector(".video-card__thumb").addEventListener("click", () => openFormatPanel(v));

      listEl.appendChild(card);
    });
  }

  // --- Format panel ---------------------------------------------------------
  async function openFormatPanel(item) {
    selectedItem = item;
    selectedFormat = null;
    resolvedFormats = [];
    formatPanel.hidden = false;
    listEl.hidden = true;
    emptyEl.hidden = true;

    const title = item.platform?.name || (item.title ? item.title.slice(0, 40) : "video");
    $("#fmt-title").textContent = title;
    $("#fmt-sub").textContent = "Resolving formats…";
    $("#filename-input").value = "";
    $("#download-btn").disabled = true;
    $("#download-btn").textContent = "Download";
    $("#download-btn").hidden = false;
    $("#extract-btn").hidden = true;
    $("#helper-btn").hidden = true;
    $("#format-list").innerHTML = `<div class="skeleton" style="height:40px"></div>`;

    const result = await VideoExtractor.getFormats(item, defaultQuality);
    resolvedFormats = result.formats || [];
    $("#fmt-sub").textContent = result.note || (resolvedFormats.length ? "Select a format" : "No formats available");

    const fmtList = $("#format-list");
    fmtList.innerHTML = "";
    if (resolvedFormats.length === 0) {
      fmtList.innerHTML = `<div style="padding:10px;font-size:12px;color:var(--text-dim);">${escapeHtml(result.note || "No direct formats.")}</div>`;
    } else {
      resolvedFormats.forEach((f, i) => {
        const row = document.createElement("div");
        row.className = "format-item";
        row.innerHTML = `
          <span class="format-item__label">${escapeHtml(f.label)}</span>
          <span class="format-item__check">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </span>
        `;
        row.addEventListener("click", () => selectFormat(i, row));
        fmtList.appendChild(row);
      });
    }

    const dlBtn = $("#download-btn");
    const extractBtn = $("#extract-btn");
    const helperBtn = $("#helper-btn");

    if (result.needsExtraction) {
      // Platform-restricted: show Extract + Helper buttons
      dlBtn.hidden = true;
      extractBtn.hidden = false;
      helperBtn.hidden = false;
      extractBtn.onclick = () => extractPlatform(item);
      helperBtn.onclick = () => {
        send("GVD_OPEN_HELPER", { url: item.url }).then((res) => {
          if (res?.ok) toast("Opened external helper", "info");
          else toast("Failed to open helper", "error");
        });
      };
    } else if (result.streamable && !result.downloadable) {
      // Stream: copy URL
      dlBtn.hidden = false;
      dlBtn.disabled = false;
      dlBtn.textContent = "Copy stream URL";
      dlBtn.onclick = () => {
        navigator.clipboard.writeText(item.url).then(
          () => toast("Stream URL copied. Use yt-dlp/VLC.", "info"),
          () => toast("Could not copy URL", "error")
        );
      };
      if (resolvedFormats.length > 0) {
        const firstRow = fmtList.querySelector(".format-item");
        if (firstRow) selectFormat(0, firstRow);
      }
    } else if (resolvedFormats.length > 0) {
      // Direct: auto-select best matching quality
      dlBtn.hidden = false;
      const best = VideoExtractor.pickBestFormat(resolvedFormats, defaultQuality);
      const bestIdx = resolvedFormats.indexOf(best);
      const row = fmtList.children[bestIdx >= 0 ? bestIdx : 0];
      if (row) selectFormat(bestIdx >= 0 ? bestIdx : 0, row);
      dlBtn.onclick = onDownloadClick;
    } else {
      dlBtn.disabled = true;
    }
  }

  function selectFormat(idx, rowEl) {
    selectedFormat = resolvedFormats[idx];
    $$(".format-item").forEach((r) => r.classList.remove("format-item--selected"));
    rowEl.classList.add("format-item--selected");
    const defaultName = VideoExtractor.defaultFilename(selectedItem, selectedFormat);
    $("#filename-input").placeholder = defaultName;
    $("#download-btn").disabled = false;
  }

  function onDownloadClick() {
    if (!selectedFormat) return;
    const custom = $("#filename-input").value.trim();
    const filename = custom || VideoExtractor.defaultFilename(selectedItem, selectedFormat);
    const btn = $("#download-btn");
    btn.disabled = true;
    btn.textContent = "Starting…";
    send("GVD_DOWNLOAD", { url: selectedFormat.url, filename }).then((res) => {
      if (res?.ok) {
        toast("Download started", "success");
        btn.textContent = "Started";
        setTimeout(() => window.close(), 800);
      } else {
        toast(res?.error || "Download failed", "error");
        btn.disabled = false;
        btn.textContent = "Download";
      }
    });
  }

  // --- Platform extraction via backend --------------------------------------
  async function extractPlatform(item) {
    const btn = $("#extract-btn");
    btn.disabled = true;
    btn.textContent = "Extracting…";
    $("#fmt-sub").textContent = "Contacting extraction backend…";
    const res = await send("GVD_EXTRACT_PLATFORM", { url: item.url, quality: defaultQuality });
    btn.disabled = false;
    btn.textContent = "Extract formats";

    if (!res?.ok) {
      if (res?.error === "no_backend") {
        $("#fmt-sub").textContent = "No extraction backend configured. Open Settings to set one, or use the helper.";
        toast("No backend — use helper", "info");
      } else {
        $("#fmt-sub").textContent = `Extraction failed: ${res?.error || "unknown"}. Try the helper.`;
        toast("Extraction failed", "error");
      }
      return;
    }

    // Populate format list with backend-resolved formats
    resolvedFormats = (res.formats || []).map((f) => ({
      label: `${f.quality || "Source"} • ${f.ext || "mp4"}`,
      url: f.url,
      quality: f.quality || "Source",
      ext: f.ext || "mp4",
      isStream: false,
    }));
    const fmtList = $("#format-list");
    fmtList.innerHTML = "";
    resolvedFormats.forEach((f, i) => {
      const row = document.createElement("div");
      row.className = "format-item";
      row.innerHTML = `<span class="format-item__label">${escapeHtml(f.label)}</span><span class="format-item__check"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>`;
      row.addEventListener("click", () => selectFormat(i, row));
      fmtList.appendChild(row);
    });
    $("#fmt-sub").textContent = res.title ? `${res.title.slice(0, 50)} — select a format` : "Select a format";
    $("#download-btn").hidden = false;
    $("#download-btn").textContent = "Download";
    $("#download-btn").onclick = onDownloadClick;
    if (resolvedFormats.length > 0) {
      const best = VideoExtractor.pickBestFormat(resolvedFormats, defaultQuality);
      const bestIdx = resolvedFormats.indexOf(best);
      const row = fmtList.children[bestIdx >= 0 ? bestIdx : 0];
      if (row) selectFormat(bestIdx >= 0 ? bestIdx : 0, row);
    }
    toast(`${resolvedFormats.length} formats found`, "success");
  }

  // --- Universal URL bar download -------------------------------------------
  $("#url-download-btn").addEventListener("click", () => {
    const url = $("#url-input").value.trim();
    if (!url) { toast("Enter a URL first", "info"); return; }
    try { new URL(url); } catch { toast("Invalid URL", "error"); return; }
    const btn = $("#url-download-btn");
    btn.disabled = true;
    send("GVD_DOWNLOAD", { url, filename: undefined }).then((res) => {
      btn.disabled = false;
      if (res?.ok) {
        toast("Download started", "success");
        $("#url-input").value = "";
      } else {
        toast(res?.error || "Download failed", "error");
      }
    });
  });

  $("#url-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#url-download-btn").click();
  });

  // --- Navigation -----------------------------------------------------------
  $("#back-btn").addEventListener("click", () => {
    formatPanel.hidden = true;
    listEl.hidden = currentVideos.length === 0;
    emptyEl.hidden = currentVideos.length > 0;
  });

  $("#options-btn").addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open(chrome.runtime.getURL("options.html"));
  });

  $("#rescan-btn").addEventListener("click", loadVideos);

  // --- Initial load ---------------------------------------------------------
  async function loadVideos() {
    statusEl.textContent = "Scanning page…";
    listEl.innerHTML = `<div class="skeleton-list"><div class="skeleton"></div><div class="skeleton"></div></div>`;
    listEl.hidden = false;
    emptyEl.hidden = true;
    formatPanel.hidden = true;

    // Load default quality setting
    const settings = await send("GVD_GET_SETTINGS");
    if (settings?.defaultQuality) defaultQuality = settings.defaultQuality;

    const res = await send("GVD_GET_DETECTED");
    renderList(res?.videos || []);
  }

  loadVideos();
})();
