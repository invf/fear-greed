// =========================
// service_worker.js (MV3)
// =========================

// Open side panel on extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  await chrome.sidePanel.open({ tabId: tab.id });
  await chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: "sidepanel.html",
    enabled: true,
  });
});

// =========================
// HTTP_FETCH proxy (CSP-safe)
// =========================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "HTTP_FETCH") return;

  (async () => {
    const {
      url,
      method = "GET",
      headers = {},
      body = null,
      timeoutMs = 12000, // default timeout
    } = msg;

    if (!url || typeof url !== "string") {
      sendResponse({ ok: false, status: 0, error: "Missing url" });
      return;
    }

    const m = String(method || "GET").toUpperCase();

    // Timeout via AbortController
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.max(1000, Number(timeoutMs) || 12000));

    try {
      const init = {
        method: m,
        headers: headers || {},
        signal: ctrl.signal,
        // credentials: "omit" // default in extensions; keep as-is
      };

      // Never attach body for GET/HEAD
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

      // Optional: return a small subset of headers
      const respHeaders = {};
      try {
        ["content-type", "cache-control"].forEach((k) => {
          const v = r.headers.get(k);
          if (v) respHeaders[k] = v;
        });
      } catch {}

      sendResponse({
        ok: r.ok,
        status: r.status,
        data,
        headers: respHeaders,
      });
    } catch (e) {
      const msgText = String(e?.message || e);
      const isAbort = /aborted|abort/i.test(msgText);

      sendResponse({
        ok: false,
        status: 0,
        error: isAbort ? "Request timeout" : msgText,
      });
    } finally {
      clearTimeout(t);
    }
  })();

  return true; // IMPORTANT: async response
});
