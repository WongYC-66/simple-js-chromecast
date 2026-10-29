# Stream Link Finder (Chrome Extension)

A small Manifest V3 extension that scans the **currently active tab** for common direct media URLs:
- `.mp4`, `.webm`, `.m4v`, `.mov`, `.ogv`
- HLS `.m3u8` playlists
- MPEG-DASH `.mpd` manifests
- `.m4s` and `.ts` media segments
- video/source elements and matching resource URLs recorded by the page Performance API

For each candidate it displays a name, estimated size when available, duration when a video element exposes it, the URL, and a Copy URL button.

## Install in Chrome

1. Unzip `stream-link-finder.zip` to a folder.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `stream_link_finder` folder (the one containing `manifest.json`).
6. Open a page with a video, click the extension icon, and press **Rescan** after playback starts.

## Limitations

- Size is best-effort. The extension uses resource timing data or an HTTP `HEAD` request; many servers hide `Content-Length`, reject `HEAD`, or stream content in chunks.
- Duration is available only when a matching `<video>` element exposes it. HLS/DASH manifests and segmented streams may not expose a single duration.
- Sites using `blob:` URLs, DRM/encrypted playback, Media Source Extensions, signed/short-lived URLs, or access controls may not expose a reusable direct URL. This extension deliberately skips `blob:` and `data:` URLs.
- It scans the active tab only when the popup is opened or Rescan is clicked; it does not continuously record browsing activity.
- The broad host permission allows best-effort HEAD requests to media hosts. You can remove `host_permissions` from `manifest.json` if you prefer, but remote size lookup will usually be unavailable.
- Use only for media you are authorized to access. A copied stream URL may expire or require the original site's session.

No data is sent to a third-party service; scanning and size lookups happen locally in the browser.
