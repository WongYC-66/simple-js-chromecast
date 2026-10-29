chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "HEAD_SIZE" || typeof message.url !== "string") return;
  let parsed;
  try { parsed = new URL(message.url); } catch { sendResponse({}); return; }
  if (!["http:", "https:"].includes(parsed.protocol)) { sendResponse({}); return; }

  fetch(message.url, { method: "HEAD", redirect: "follow", credentials: "omit" })
    .then(response => {
      const length = Number(response.headers.get("content-length"));
      sendResponse({ size: Number.isFinite(length) && length > 0 ? length : null });
    })
    .catch(() => sendResponse({}));
  return true;
});