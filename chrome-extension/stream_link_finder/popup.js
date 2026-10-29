const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const titleEl = document.getElementById("page-title");
const scanBtn = document.getElementById("scan");

function prettyBytes(n) {
  if (n == null || !Number.isFinite(n) || n <= 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, value = n;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i ? 1 : 0)} ${units[i]}`;
}
function prettyDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "Unknown duration";
  if (seconds === Infinity) return "Live / unknown length";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
function render(items) {
  resultsEl.replaceChildren();
  if (!items.length) {
    resultsEl.append(make("div", "empty", "No common direct video links found. Try playing the video and press Rescan."));
    return;
  }
  for (const item of items) {
    const card = make("article", "card");
    const head = make("div", "card-head");
    const left = make("div");
    left.append(make("div", "name", item.name || "Video stream"));
    left.append(make("span", "kind", item.kind || "Media URL"));
    const copy = make("button", "copy", "Copy URL");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.url);
        copy.textContent = "Copied!";
        setTimeout(() => { copy.textContent = "Copy URL"; }, 1200);
      } catch {
        const input = document.createElement("textarea");
        input.value = item.url;
        document.body.append(input);
        input.select();
        document.execCommand("copy");
        input.remove();
        copy.textContent = "Copied!";
        setTimeout(() => { copy.textContent = "Copy URL"; }, 1200);
      }
    });
    head.append(left, copy);
    card.append(head);
    const meta = make("div", "meta");
    meta.append(make("span", "", `Size: ${prettyBytes(item.size)}`));
    meta.append(make("span", "", `Duration: ${prettyDuration(item.duration)}`));
    card.append(meta);
    card.append(make("div", "url", item.url));
    resultsEl.append(card);
  }
}
async function scan() {
  statusEl.textContent = "Looking for video links…";
  resultsEl.replaceChildren();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab.");
    titleEl.textContent = tab.title || tab.url || "Current tab";
    if (!tab.url || !/^https?:/.test(tab.url)) {
      throw new Error("This page cannot be scanned (Chrome internal pages are restricted).");
    }
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const map = new Map();
        const extKind = (url) => {
          const clean = url.split("?")[0].split("#")[0].toLowerCase();
          if (clean.endsWith(".m3u8")) return "HLS playlist (.m3u8)";
          if (clean.endsWith(".mpd")) return "MPEG-DASH manifest (.mpd)";
          if (clean.endsWith(".mp4")) return "MP4 video";
          if (clean.endsWith(".webm")) return "WebM video";
          if (clean.endsWith(".m4v")) return "M4V video";
          if (clean.endsWith(".mov")) return "MOV video";
          if (clean.endsWith(".ogv")) return "Ogg video";
          if (clean.endsWith(".m4s")) return "Fragmented media (.m4s)";
          if (clean.endsWith(".ts")) return "MPEG transport stream (.ts)";
          return "Video resource";
        };
        const isLikelyMedia = (url, type = "") => {
          if (!url || url.startsWith("blob:") || url.startsWith("data:")) return false;
          return /\.(m3u8|mpd|mp4|webm|m4v|mov|ogv|m4s|ts)(?:$|[?#])/i.test(url) ||
            /(^|\/)(video|videoplayback)(\/|$|\?)/i.test(url) ||
            /mpegurl|dash\+xml|video\/|mp2t/i.test(type);
        };
        const add = (url, details = {}) => {
          if (!isLikelyMedia(url, details.mime || "")) return;
          let absolute;
          try { absolute = new URL(url, location.href).href; } catch { return; }
          const old = map.get(absolute) || {};
          map.set(absolute, {
            url: absolute,
            name: details.name || old.name || decodeURIComponent(absolute.split("/").pop().split("?")[0] || "Video stream"),
            kind: details.kind || old.kind || extKind(absolute),
            size: details.size ?? old.size ?? null,
            duration: details.duration ?? old.duration ?? null
          });
        };
        document.querySelectorAll("video").forEach((video, index) => {
          const sourceUrl = video.currentSrc || video.src;
          if (sourceUrl) add(sourceUrl, {
            name: video.getAttribute("aria-label") || video.getAttribute("title") || `Video element ${index + 1}`,
            duration: Number.isFinite(video.duration) ? video.duration : null,
            size: null
          });
          video.querySelectorAll("source").forEach(source => add(source.src, {
            name: source.getAttribute("title") || source.src.split("/").pop(),
            kind: source.type || undefined,
            duration: Number.isFinite(video.duration) ? video.duration : null
          }));
        });
        document.querySelectorAll("a[href], source[src], video[src]").forEach(el => {
          const url = el.href || el.src;
          if (url) add(url, { name: el.getAttribute("title") || el.getAttribute("download") || undefined });
        });
        try {
          performance.getEntriesByType("resource").forEach(entry => {
            if (isLikelyMedia(entry.name, entry.initiatorType)) {
              add(entry.name, {
                size: entry.encodedBodySize > 0 ? entry.encodedBodySize : (entry.transferSize > 0 ? entry.transferSize : null),
                kind: entry.initiatorType === "video" ? "Video resource" : undefined
              });
            }
          });
        } catch {}
        return [...map.values()];
      }
    });
    const items = result?.[0]?.result || [];
    // A HEAD request may reveal Content-Length when the server permits it.
    const enriched = await Promise.all(items.map(async item => {
      if (item.size || !/^https?:/.test(item.url)) return item;
      try {
        const response = await chrome.runtime.sendMessage({ type: "HEAD_SIZE", url: item.url });
        if (response?.size > 0) item.size = response.size;
      } catch {}
      return item;
    }));
    statusEl.textContent = `${enriched.length} possible media link${enriched.length === 1 ? "" : "s"} found`;
    render(enriched);
  } catch (error) {
    statusEl.textContent = error.message || "Could not scan this tab.";
    render([]);
  }
}
scanBtn.addEventListener("click", scan);
scan();