# Glass Video & File Downloader — Chrome Extension

A production-ready Chrome extension (Manifest V3) that detects and downloads videos **and any file** from any webpage, with a modern **glassmorphism** UI, animated gradient background, **1-click download** buttons, **quality selection**, and **multi-platform support** via an optional yt-dlp backend.

![icon](assets/images/icon.svg)

---

## Features

### Video downloading
- **Auto-detection** of videos via DOM inspection (`<video>`, `<source>`, `<a>` media links) **and** network request monitoring (`webRequest`).
- **Quality selection**: lists available qualities (1080p/720p/480p/…) and parses HLS master playlists for variant streams. Auto-selects the format closest to your default quality preference.
- **1-click download**: each detected video card has a gradient download button — click it and the file downloads immediately (for direct sources).
- **Multi-platform awareness**: YouTube, Vimeo, Instagram, TikTok, Twitter/X, Threads, Facebook, Telegram, Pinterest, Terabox, Dailymotion, Reddit, Twitch.

### Universal file downloader
- **Paste any URL** into the URL bar at the top of the popup and click the gradient download button — works for any direct file (video, audio, images, PDF, archives, docs, apps).
- **Context menu**: right-click any link, image, video, or audio element → "Download this file".

### Platform video extraction (optional backend)
- For platforms that use signature ciphers / DRM (YouTube, TikTok, Instagram, etc.), the extension can call a **Supabase Edge Function** running `yt-dlp` server-side to resolve real download URLs with quality selection.
- If no backend is configured, the extension hands off to your configured external helper URL.
- A ready-to-deploy edge function is included at `supabase/functions/extract-video/index.ts`.

### UI / UX
- **Glassmorphism**: frosted panels, `backdrop-filter` blur, animated canvas gradient (Aurora / Ocean / Sunset themes).
- **Micro-interactions**: ripple buttons, fade-in animations, hover states, gradient download buttons.
- **Floating badge**: a frosted pill appears on pages where videos are detected.
- **Inline panel**: click the badge for a quick-download panel without opening the popup.
- `@supports` fallbacks for browsers without `backdrop-filter`.

### Management
- **Download history**: stored locally with thumbnails, timestamps, file sizes, and one-click clear.
- **Settings**: default quality, auto-detect toggle, history limits, theme picker, extraction backend URL, external helper URL.

---

## Important: what this extension can and cannot download

Chrome extensions run in a browser sandbox and **cannot execute native binaries** like `yt-dlp` directly. This means:

| Source type | Downloadable in-extension? | How it works |
|---|---|---|
| Direct MP4/WebM/MKV/MOV/OGG/MP3/PDF/ZIP/images | **Yes** | Downloaded directly via `chrome.downloads` — 1-click. |
| `<video>` / `<source>` elements with a real URL | **Yes** | URL extracted and downloaded. |
| HLS / DASH playlists (`.m3u8`, `.mpd`) | **Playlist URL only** | Chrome can't merge segments in-extension. The URL is copied for yt-dlp / VLC / ffmpeg. |
| YouTube, TikTok, Instagram, Facebook, Twitter, Threads, Telegram, Pinterest, Terabox | **Via backend or helper** | These use signature ciphers / DRM requiring server-side extraction. The extension calls your configured extraction backend (yt-dlp edge function) or opens an external helper. |

This is the honest, technically-correct approach. Any extension claiming to download YouTube videos purely client-side is either using a hidden backend or breaking constantly.

---

## Installation (Load Unpacked)

1. **Download / unzip** the extension folder so you have the `video-downloader-extension/` directory on disk.
2. Open Chrome and go to `chrome://extensions/`.
3. Toggle on **Developer mode** (top-right corner).
4. Click **Load unpacked**.
5. Select the `video-downloader-extension/` folder (the one containing `manifest.json`).
6. The **Glass Video & File Downloader** icon will appear in your toolbar. Pin it for easy access.

> Also works in any Chromium-based browser: Edge (`edge://extensions/`), Brave, Opera, Vivaldi.

---

## Usage

### 1-click download (direct files)
1. Navigate to a page containing a video or file.
2. Click the extension icon. The popup lists detected items.
3. Click the **gradient download button** on any card — the file downloads immediately.

### Universal URL download
1. Click the extension icon.
2. Paste any direct file URL into the **URL bar** at the top.
3. Click the **gradient download button** (or press Enter).

### Quality selection
1. Click the **card body** (not the download button) to open the format panel.
2. Pick a quality/format from the list. The extension auto-selects the one closest to your default quality setting.
3. Optionally rename the file, then click **Download**.

### Platform videos (YouTube, TikTok, etc.)
1. Click the platform video card to open the format panel.
2. Click **Extract formats** — the extension calls your configured backend (yt-dlp edge function) and lists real download URLs with qualities.
3. Pick a quality and click **Download**.
4. If no backend is configured, click **Open in helper** to hand off to an external service.

### Context menu
- Right-click anywhere on a page → **Detect videos on this page**.
- Right-click a link → **Download this link (video/file)**.
- Right-click a `<video>` element → **Download this video**.
- Right-click any element → **Download this file**.

### Floating badge
- On pages with detected videos, a frosted pill appears bottom-right showing the count. Click it for an inline quick-download panel.

### Settings & history
- Click the gear icon in the popup to open the full settings page.
- Configure: default quality, extraction backend URL, external helper URL, auto-detect, history limits, theme.
- View and clear download history under the **History** tab.

---

## Optional: Deploy the yt-dlp extraction backend

A Supabase Edge Function is included at `supabase/functions/extract-video/index.ts`. It accepts a POST request with `{ url, quality }` and returns `{ formats: [{url, quality, ext}], title }`.

**Note:** yt-dlp must be installed in the function runtime. Supabase Edge Functions run on Deno and do not have yt-dlp pre-installed. To use this backend:

1. Deploy the function to a host that has `yt-dlp` installed (e.g. a VPS, Fly.io container, or a custom Deno host with yt-dlp in the PATH).
2. Copy the function's public URL.
3. In the extension's Settings page, paste it into **Extraction backend URL**.

If you don't deploy a backend, platform videos fall back to the **External helper URL** (a web-based downloader service you configure).

---

## File structure

```
video-downloader-extension/
├── manifest.json              # MV3 manifest
├── background.js              # Service worker: downloads, context menu, badge, webRequest, extraction
├── content.js                 # Content script: DOM detection + floating badge + inline panel
├── content-overlay.css        # Styles for badge/panel injected into pages
├── popup.html / .css / .js    # Toolbar popup: URL bar, video list, 1-click download, format panel
├── options.html / .css / .js # Settings + history page
├── lib/
│   ├── platforms.js           # Shared platform detection + URL/file helpers (ES module)
│   ├── video-detector.js      # Standalone detection logic (reference)
│   ├── extractor.js           # Format resolution + HLS parsing + quality selection
│   └── gradient-animator.js   # Canvas animated gradient background
├── assets/
│   ├── icons/                 # icon16/32/48/128.png
│   └── images/                # icon.svg
└── README.md

supabase/functions/extract-video/
└── index.ts                   # Optional yt-dlp edge function backend
```

---

## Privacy

- No analytics, no telemetry, no remote code.
- Settings sync via `chrome.storage.sync`. History is local-only via `chrome.storage.local`. Detected-video cache uses `chrome.storage.session` (cleared on browser close).
- Network request monitoring (`webRequest`) is used solely to detect media URLs on the active page; no request bodies or content are read or transmitted.
- The extraction backend is called only when you click "Extract formats" — never automatically.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| "No videos detected" on a platform page | The page uses encrypted/DRM streams. Click the card → "Extract formats" (needs backend) or "Open in helper". |
| 1-click download fails | The URL may be cross-origin with CORS restrictions or a blob URL. Open the format panel and try the context menu. |
| "Extraction failed" | No backend configured, or yt-dlp isn't installed on the backend host. Set the Extraction backend URL in Settings, or use the helper. |
| Floating badge doesn't appear | Auto-detect is off in settings, or the page blocked content scripts. Reload the page. |
| Glassmorphism looks flat | Your browser lacks `backdrop-filter` support; the extension falls back to solid translucent backgrounds automatically. |

---

## License

MIT. Use it, fork it, ship it.
