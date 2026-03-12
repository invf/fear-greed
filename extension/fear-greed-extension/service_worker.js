// service_worker.js (MV3)

// Open side panel on extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  await chrome.sidePanel.open({ tabId: tab.id });
  await chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: "sidepanel.html",
    enabled: true
  });
});

// Backend request handler
const ALLOWED_ORIGINS = new Set([
  "https://fear-greed-24pr.onrender.com"
]);

const ALLOWED_METHODS = new Set(["GET", "POST"]);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "HTTP_FETCH") return;

  (async () => {
    const {
      url,
      method = "GET",
      headers = {},
      body = null,
      timeoutMs = 12000
    } = msg;

    if (!url || typeof url !== "string") {
      sendResponse({ ok: false, status: 0, error: "Missing url" });
      return;
    }

    // Optional: only allow requests from sidepanel
    const allowedSender = chrome.runtime.getURL("sidepanel.html");
    if (!sender?.url?.startsWith(allowedSender)) {
      sendResponse({ ok: false, status: 0, error: "Unauthorized sender" });
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      sendResponse({ ok: false, status: 0, error: "Invalid url" });
      return;
    }

    if (!ALLOWED_ORIGINS.has(parsedUrl.origin)) {
      sendResponse({ ok: false, status: 0, error: "URL not allowed" });
      return;
    }

    const m = String(method).toUpperCase();
    if (!ALLOWED_METHODS.has(m)) {
      sendResponse({ ok: false, status: 0, error: "Method not allowed" });
      return;
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => {
      ctrl.abort();
    }, Math.max(1000, Number(timeoutMs) || 12000));

    try {
      const init = {
        method: m,
        headers: headers || {},
        signal: ctrl.signal
      };

      if (m !== "GET" && m !== "HEAD" && body != null) {
        init.body = body;
      }

      const r = await fetch(url, init);
      const contentType = r.headers.get("content-type") || "";
      const text = await r.text();

      let data = text;
      if (contentType.includes("application/json")) {
        try {
          data = JSON.parse(text);
        } catch {
          // keep raw text
        }
      }

      const respHeaders = {};
      for (const k of ["content-type", "cache-control"]) {
        const v = r.headers.get(k);
        if (v) respHeaders[k] = v;
      }

      sendResponse({
        ok: r.ok,
        status: r.status,
        data,
        headers: respHeaders
      });
    } catch (e) {
      const msgText = String(e?.message || e);
      const isAbort = /aborted|abort/i.test(msgText);

      sendResponse({
        ok: false,
        status: 0,
        error: isAbort ? "Request timeout" : msgText
      });
    } finally {
      clearTimeout(t);
    }
  })();

  return true;
});