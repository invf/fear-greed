// =========================
// Config
// =========================
const API_BASE = "https://fear-greed-24pr.onrender.com";

const FNG_PATH = "/api/fng";
const VALIDATE_PATH = "/api/validate-key";

// Endpoint that returns {plan, valid, limit, used, remaining, day}
const QUOTA_PATH = "/api/quota";

const TFS = ["15m", "1h", "4h", "1d"];
const DECIMALS = 1;

// Storage keys
const STORE = {
  auto: "cs_auto_refresh",
  interval: "cs_refresh_interval_sec",
  apiKey: "cs_api_key",
  installId: "cs_install_id",

  // plan cache
  plan: "cs_plan",
  planValid: "cs_plan_valid",
  planUpdatedAt: "cs_plan_ts",
};

// Defaults
const AUTO_REFRESH_DEFAULT = true;
const DEFAULT_INTERVAL_SEC = 30;

// Bounds
const MIN_INTERVAL_SEC = 15;
const MAX_INTERVAL_SEC = 300;

// Auto-refresh tuning
const AUTO_POLL_MS = 900;
const DEBOUNCE_MS = 650;

// Plan cache TTL (ms)
const PLAN_TTL_MS = 6 * 60 * 60 * 1000; // 6h

// Quota refresh tuning (anti-spam)
const QUOTA_TTL_MS = 3500; // do not refetch quota more often than this for same symbol

// Toast (limit exceeded)
const PRICING_URL = "https://www.sentipulse.app/en/pricing";
const GET_API_KEY_URL = "https://www.sentipulse.app/en/pricing#checkout";
const TOAST_COOLDOWN_MS = 60 * 1000; // 1 min

// AI
const AI_ANALYSIS_PATH = "/api/ai-analysis";

// Scanner
const SCANNER_PATH = "/api/scanner";

// Market stats
const MARKET_STATS_PATH = "/api/market-stats";

// =========================
// HTTP proxy (MV3 CSP-safe)
// =========================
function httpFetch(url, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "HTTP_FETCH", url, method, headers, body }, (res) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      resolve(res);
    });
  });
}

// =========================
// i18n helpers (robust placeholders)
// =========================
function manualSubstitute(template, subs) {
  if (!template || !subs || !subs.length) return template || "";
  let out = String(template);
  for (let i = 0; i < subs.length; i++) {
    const re = new RegExp("\\{" + i + "\\}", "g");
    out = out.replace(re, String(subs[i]));
  }
  return out;
}

/**
 * t(key, subs?)
 * - Uses chrome.i18n.getMessage
 * - If Chrome returns "{0} .." unchanged (common when you forgot/invalid subs),
 *   we do a safe manual substitute anyway.
 */
function t(key, substitutions) {
  try {
    const subs = Array.isArray(substitutions)
      ? substitutions.map((x) => String(x))
      : substitutions != null
      ? [String(substitutions)]
      : undefined;

    const v = chrome?.i18n?.getMessage(key, subs);
    if (!v) return "";

    // If placeholders stayed as-is, do a manual replace as a last resort.
    if (subs && /\{\d+\}/.test(v)) return manualSubstitute(v, subs);

    return v;
  } catch {
    // If chrome.i18n is unavailable (rare), still try manual substitution
    // only if key itself is passed as a template (not expected).
    return "";
  }
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const val = t(key);
    if (val) el.textContent = val;
  });

  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    const val = t(key);
    if (val) el.setAttribute("title", val);
  });

  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    const val = t(key);
    if (val) el.setAttribute("aria-label", val);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    const val = t(key);
    if (val) el.setAttribute("placeholder", val);
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// =========================
// API payload unwrap helper
// Supports backend responses like:
// - { ok:true, data:{...} }
// - { detail:{...} }
// - direct {...}
// =========================
function unwrapPayload(x) {
  if (!x) return null;
  if (typeof x !== "object") return x;

  if (x.data && typeof x.data === "object") return x.data;
  if (x.detail && typeof x.detail === "object") return x.detail;

  return x;
}

// =========================
// Error mapping -> i18n keys (NO hardcoded UA/EN strings here)
// =========================
function errKeyFromHttp(status) {
  if (status === 0) return { key: "err_offline" };
  if (status === 401) return { key: "err_unauthorized" };
  if (status === 403) return { key: "err_forbidden" };
  if (status === 404) return { key: "err_not_found" };
  if (status === 429) return { key: "err_too_many_requests" };
  if (status === 402) return { key: "err_payment_required" };
  if (status >= 500 && status <= 599) return { key: "err_server_unavailable" };
  return { key: "err_no_data" };
}

function friendlyErrorKey(err, ctx = {}) {
  const e = String(err?.message || err || "");
  const status = ctx?.status ?? null;

  // timeout / abort
  if (/timeout|timed out|aborted/i.test(e)) return { key: "err_timeout" };

  // MV3 / network-ish
  if (
    /Failed to fetch|NetworkError|net::ERR|The message port closed|message port closed|Receiving end does not exist/i.test(
      e
    )
  ) {
    return { key: "err_offline" };
  }

  if (status != null) return errKeyFromHttp(status);

  // backend status hints in text
  if (/limit_exceeded/i.test(e)) return { key: "err_limit_exceeded" };

  return { key: "err_no_data" };
}

function friendlyErrorText(err, ctx = {}) {
  const { key, subs } = friendlyErrorKey(err, ctx);
  // absolute last fallback: something readable
  return t(key, subs) || t("err_no_data") || "Error";
}

// =========================
// State
// =========================
const state = {
  venue: "—",
  symbol: "—",
  values: { "15m": null, "1h": null, "4h": null, "1d": null },
  risk: null,
  plan: "FREE",
  planValid: false,
  marketStats: null,
};

// quota fetch state to ensure it updates and doesn't spam
const quotaState = {
  lastSymbol: "",
  lastAt: 0,
  inFlight: false,
  queued: false,
  hasData: false,
};

const auto = {
  enabled: AUTO_REFRESH_DEFAULT,
  intervalSec: DEFAULT_INTERVAL_SEC,

  lastUrl: "",
  debounceTimer: null,
  pollTimer: null,
  periodicTimer: null,

  lastSymbol: "",
  lastVenue: "",
};

const aiState = {
  used: null,
  limit: null,
};

const scannerState = {
  used: null,
  limit: null,
};

let refreshInFlight = false;
let refreshQueued = false;
let lastSeenUrl = "";

// =========================
// DOM helpers
// =========================
function $(id) {
  return document.getElementById(id);
}

function setText(id, txt) {
  const el = $(id);
  if (el) el.textContent = txt ?? "—";
}

function setErr(txt) {
  const el = $("err");
  if (el) el.textContent = txt || "";
}

function fmt(v) {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  return v.toFixed(DECIMALS);
}

function clampInterval(v) {
  if (!isFinite(v)) return DEFAULT_INTERVAL_SEC;
  return Math.max(MIN_INTERVAL_SEC, Math.min(MAX_INTERVAL_SEC, v));
}

// =========================
// Toast
// =========================
let lastToastAt = 0;

function hideToast() {
  const toast = $("toast");
  if (toast) toast.style.display = "none";
}

function showToast({ title, text, linkUrl } = {}) {
  const now = Date.now();
  if (now - lastToastAt < TOAST_COOLDOWN_MS) return; // anti-spam
  lastToastAt = now;

  const toast = $("toast");
  const tTitle = $("toastTitle");
  const tText = $("toastText");
  const tLink = $("toastLink");

  if (!toast || !tTitle || !tText) return;

  tTitle.textContent = title || t("toast_default_title") || "Message";
  tText.textContent = text || "";

  if (tLink) {
    if (linkUrl) {
      tLink.href = linkUrl;
      tLink.style.display = "inline";
    } else {
      tLink.style.display = "none";
      tLink.href = "#";
    }
  }

  toast.style.display = "block";
}

// bind once
function initToastBindings() {
  $("toastClose")?.addEventListener("click", hideToast);
}

// =========================
// Plan UI (badge + hint)
// =========================
function planText(plan) {
  const p = String(plan || "FREE").toUpperCase();
  if (p === "PRO") return "PRO";
  if (p === "VIP") return "VIP";
  return "FREE";
}

function renderPlan(plan, valid) {
  const badge = $("planBadge");
  if (!badge) return;

  const p = String(plan || "FREE").toUpperCase();

  // planValue може НЕ бути в HTML — це ок
  const el = $("planValue");
  if (el) el.textContent = p;

  badge.classList.remove("plan-free", "plan-pro", "plan-vip");

  if (!valid) {
    badge.classList.add("plan-free");
    return;
  }

  if (p === "PRO") badge.classList.add("plan-pro");
  else if (p === "VIP") badge.classList.add("plan-vip");
  else badge.classList.add("plan-free");
}

function planHint({ plan, valid, status } = {}) {
  const p = planText(plan);

  // status keys:
  // missing | invalid | revoked | limit_exceeded | cached | ok
  if (!valid) {
    if (status === "missing") return t("apiKeyHint") || "";
    if (status === "invalid") return t("apiKeyInvalid") || "";
    if (status === "revoked") return t("apiKeyRevoked") || "";
    if (status === "limit_exceeded") return t("apiKeyLimitExceeded") || "";
    return t("apiKeyHint") || "";
  }

  if (p === "PRO") return t("apiKeyPro") || "";
  if (p === "VIP") return t("apiKeyVip") || "";
  return t("apiKeyFree") || "";
}

function renderPlanStatus(extra = null) {
  const el = $("apiKeyStatus");
  if (!el) return;

  const plan = extra?.plan ?? state.plan;
  const valid = extra?.valid ?? state.planValid;
  const status = extra?.status;

  const label = valid ? `✅ ${planText(plan)}` : `ℹ️ ${planText(plan)}`;
  const hint = planHint({ plan, valid, status });

  el.textContent = hint ? `${label} — ${hint}` : label;
}

async function setPlanState({ plan, valid, status, save = true } = {}) {
  const p = planText(plan || "FREE");
  const v = !!valid;

  state.plan = p;
  state.planValid = v;

  renderPlan(p, v);
  renderPlanStatus({ plan: p, valid: v, status });
  renderAiQuotaText();
  renderScannerQuotaText();

  if (save) {
    await storageSet({
      [STORE.plan]: p,
      [STORE.planValid]: v,
      [STORE.planUpdatedAt]: Date.now(),
    });
  }
}

// =========================
// Quota UI (pairs per day)
// =========================
function renderQuota(metaLike) {
  const el = $("planMeta");
  if (!el) return;

  const meta = unwrapPayload(metaLike);

  // Якщо мети немає або вона не об'єкт — нічого не показуємо
  if (!meta || typeof meta !== "object") {
    el.style.display = "none";
    el.textContent = "";
    return;
  }

  const plan = String(meta.plan || state.plan || "FREE").toUpperCase();
  const planLabel = plan === "VIP" ? "VIP" : plan === "PRO" ? "PRO" : "FREE";

  // Unlimited показуємо ТІЛЬКИ для VIP.
  // Для PRO/FREE якщо limit ще не прийшов — ховаємо (щоб не миготіло "PRO • Unlimited").
  if (meta.limit == null) {
    if (planLabel === "VIP") {
      el.style.display = "block";
      el.textContent = t("quota_unlimited", [planLabel]) || `${planLabel} • Unlimited`;
    } else {
      el.style.display = "none";
      el.textContent = "";
    }
    return;
  }

  const used = Number(meta.used ?? 0);
  const limit = Number(meta.limit ?? 0);

  el.style.display = "block";
  el.textContent = t("quota_used", [planLabel, used, limit]) || `${planLabel} • ${used}/${limit}`;
}

//AI function
function renderAiQuotaText() {
  const el = $("aiQuota");
  if (!el) return;

  const plan = planText(state.plan);

  if (!state.planValid || plan === "FREE") {
    el.textContent = "—";
    return;
  }

  const limit =
    typeof aiState.limit === "number"
      ? aiState.limit
      : plan === "PRO"
      ? 10
      : 20;

  const used = Math.max(
    0,
    Math.min(
      limit,
      typeof aiState.used === "number" ? aiState.used : 0
    )
  );

  el.textContent = `${used}/${limit}`;
}

function closeAiPopup(animated = true) {
  const popup = $("aiPopup");
  if (!popup || popup.classList.contains("is-hidden")) return;

  if (animated) {
    popup.classList.add("is-closing");
    setTimeout(() => {
      popup.classList.add("is-hidden");
      popup.classList.remove("is-closing");
    }, 230);
  } else {
    popup.classList.add("is-hidden");
    popup.classList.remove("is-closing");
  }
}

function clearAiResult() {
  closeAiPopup(false);
  setText("aiBias", "—");
  setText("aiSetup", "—");
  setText("aiSummary", "—");
  setText("aiWhatMatters", "—");
  setText("aiCaution", "—");
}

function renderAiResult(payload) {
  const analysis = payload?.analysis || {};

  setText("aiBias", analysis.bias || "—");
  setText("aiSetup", analysis.setup || "—");
  setText("aiConfidence", analysis.confidence != null ? `${analysis.confidence}%` : "—");
  setText("aiSummary", analysis.summary || "—");
  setText("aiWhatMatters", analysis.what_matters || "—");
  setText("aiAction", analysis.action || "—");
  setText("aiCaution", analysis.caution || "—");

  const pairEl = $("aiPopupPair");
  if (pairEl) pairEl.textContent = state.symbol !== "—" ? state.symbol : "—";

  if (typeof payload?.used === "number" && typeof payload?.limit === "number") {
    animateAiQuotaTo(payload.used, payload.limit);
  } else {
    renderAiQuotaText();
  }

  const popup = $("aiPopup");
  if (popup) {
    popup.classList.remove("is-hidden", "is-closing");
  }
}

async function fetchAiAnalysis(symbol) {
  const installId = await getOrCreateInstallId();
  const apiKey = await getApiKey();

  const v15 = Number(state.values["15m"]);
  const v1h = Number(state.values["1h"]);
  const v4h = Number(state.values["4h"]);
  const v1d = Number(state.values["1d"]);

  // state.risk у тебе = object from computeRisk(...)
  const riskValue =
    typeof state.risk?.risk === "number"
      ? state.risk.risk
      : null;

  if (![v15, v1h, v4h, v1d, riskValue].every((v) => Number.isFinite(v))) {
    throw Object.assign(new Error("missing_market_data"), {
      status: 400,
      debug: { v15, v1h, v4h, v1d, riskValue },
    });
  }

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Install-Id": installId,
    "X-Api-Key": apiKey,
  };

  const lang = (chrome.i18n?.getUILanguage?.() || navigator.language || "en")
    .split("-")[0]
    .toLowerCase();

  const body = JSON.stringify({
    symbol,
    tf_15m: v15,
    tf_1h: v1h,
    tf_4h: v4h,
    tf_1d: v1d,
    risk: Math.round(riskValue),
    lang,
  });

  const res = await httpFetch(API_BASE + AI_ANALYSIS_PATH, {
    method: "POST",
    headers,
    body,
  });

  const data = unwrapPayload(res?.data ?? null) || {};
  if (res?.ok) return data;

  const err = String(data?.error || data?.status || "").toLowerCase();

  if (err === "upgrade_required" || err === "plan_required") {
    throw Object.assign(new Error("upgrade_required"), {
      status: 402,
      payload: data,
    });
  }

  if (err === "limit_reached" || err === "limit_exceeded") {
    throw Object.assign(new Error("limit_reached"), {
      status: 429,
      payload: data,
    });
  }

  throw Object.assign(
    new Error(friendlyErrorText(new Error("ai"), { status: res?.status ?? 0 })),
    {
      status: res?.status ?? 0,
      payload: data,
    }
  );
}

async function ensureAiDataReady() {
  const riskValue =
    typeof state.risk?.risk === "number"
      ? state.risk.risk
      : null;

  const ready =
    Number.isFinite(Number(state.values["15m"])) &&
    Number.isFinite(Number(state.values["1h"])) &&
    Number.isFinite(Number(state.values["4h"])) &&
    Number.isFinite(Number(state.values["1d"])) &&
    Number.isFinite(Number(riskValue));

  if (ready) return true;

  await refresh(lastSeenUrl, "ai-preload");

  const nextRiskValue =
    typeof state.risk?.risk === "number"
      ? state.risk.risk
      : null;

  return (
    Number.isFinite(Number(state.values["15m"])) &&
    Number.isFinite(Number(state.values["1h"])) &&
    Number.isFinite(Number(state.values["4h"])) &&
    Number.isFinite(Number(state.values["1d"])) &&
    Number.isFinite(Number(nextRiskValue))
  );
}

async function onAiAnalyzeClick() {
  const btn = $("aiAnalyzeBtn");
  const symbol = state.symbol;

  if (!symbol || symbol === "—") {
    showToast({
      title: t("aiTitle") || "AI Analysis",
      text: t("errNoSymbol") || "Cannot detect symbol from URL on this page.",
    });
    return;
  }

  if (!state.planValid || planText(state.plan) === "FREE") {
    showToast({
      title: t("toast_upgrade_title") || "Upgrade required",
      text: t("aiUpgradeToast") || "AI Analysis is available on PRO and VIP plans.",
      linkUrl: PRICING_URL,
    });
    return;
  }

  try {
    btn?.classList.add("is-loading");
    if (btn) btn.disabled = true;

    const ready = await ensureAiDataReady();
    if (!ready) {
      showToast({
        title: t("aiTitle") || "AI Analysis",
        text: "Market data is still unavailable. Please wait a moment and try again.",
      });
      return;
    }

    const data = await fetchAiAnalysis(symbol);

    const nextUsed = Number(data?.used);
    if (Number.isFinite(nextUsed)) {
      aiState.used = nextUsed;
    }

    const nextLimit = Number(data?.limit);
    if (Number.isFinite(nextLimit)) {
      aiState.limit = nextLimit;
    }

    renderAiQuotaText();
    renderAiResult(data);
    setErr("");
  } catch (e) {
    const code = String(e?.message || "").toLowerCase();

    if (code === "upgrade_required") {
      showToast({
        title: t("toast_upgrade_title") || "Upgrade required",
        text: t("aiUpgradeToast") || "AI Analysis is available on PRO and VIP plans.",
        linkUrl: PRICING_URL,
      });
      return;
    }

    if (code === "limit_reached") {
      const p = e?.payload || {};

      const limitPayload = Number(p.limit);
      if (Number.isFinite(limitPayload)) aiState.limit = limitPayload;

      const usedPayload = Number(p.used);
      if (Number.isFinite(usedPayload)) aiState.used = usedPayload;

      renderAiQuotaText();

      showToast({
        title: t("aiLimitTitle") || "Daily AI limit reached",
        text:
          t("aiLimitText", [p.used ?? 0, p.limit ?? 0]) ||
          "You've reached today's AI analysis limit. Please upgrade your plan or try again tomorrow.",
        linkUrl: PRICING_URL,
      });
      return;
    }

    if (code === "missing_market_data") {
      showToast({
        title: t("aiTitle") || "AI Analysis",
        text: "Market data is not ready yet. Refresh the panel and try again.",
      });
      return;
    }

    showToast({
      title: t("aiTitle") || "AI Analysis",
      text: friendlyErrorText(e, { status: e?.status ?? 0 }),
    });
  } finally {
    btn?.classList.remove("is-loading");
    if (btn) btn.disabled = false;
  }
}

// =========================
// Scanner
// =========================
function renderScannerQuotaText() {
  const el = $("scannerQuota");
  if (!el) return;

  const plan = planText(state.plan);

  if (!state.planValid || plan === "FREE") {
    el.textContent = "—";
    return;
  }

  const limit =
    typeof scannerState.limit === "number"
      ? scannerState.limit
      : plan === "PRO"
      ? 10
      : 40;

  const used = Math.max(
    0,
    Math.min(limit, typeof scannerState.used === "number" ? scannerState.used : 0)
  );

  el.textContent = `${used}/${limit}`;
}

function toggleScannerCollapse() {
  const popup = $("scannerPopup");
  if (!popup || popup.classList.contains("is-hidden")) return;
  const collapsed = popup.classList.toggle("is-collapsed");
  document.body.classList.toggle("scanner-collapsed", collapsed);
}

function openScannerPopup() {
  const popup = $("scannerPopup");
  if (!popup) return;
  renderScannerQuotaText();
  popup.classList.remove("is-hidden", "is-closing", "is-collapsed");
  const listEl = $("scannerList");
  if (listEl) listEl.innerHTML = "";
  const subEl = $("scannerPopupSub");
  if (subEl) subEl.textContent = "";
  $("tabScanner")?.classList.add("is-active");
  document.body.classList.add("scanner-open");
  document.body.classList.remove("scanner-collapsed");
}

function closeScannerPopup(animated = true) {
  const popup = $("scannerPopup");
  if (!popup || popup.classList.contains("is-hidden")) return;

  $("tabScanner")?.classList.remove("is-active");
  document.body.classList.remove("scanner-open", "scanner-collapsed");

  if (animated) {
    popup.classList.add("is-closing");
    setTimeout(() => {
      popup.classList.add("is-hidden");
      popup.classList.remove("is-closing");
    }, 260);
  } else {
    popup.classList.add("is-hidden");
    popup.classList.remove("is-closing");
  }
}

function scannerExchangeUrls(symbol) {
  const base = symbol.replace(/USDT$/i, "");
  const baseLow = base.toLowerCase();
  return {
    binance: `https://www.binance.com/en/trade/${base}_USDT?type=spot`,
    okx: `https://www.okx.com/en/trade-spot/${baseLow}-usdt`,
    bybit: `https://www.bybit.com/en/trade/spot/${base}/USDT`,
  };
}

function scannerZoneClass(label) {
  const l = (label || "").toLowerCase();
  if (l.includes("extreme fear")) return "zone-extfear";
  if (l.includes("fear")) return "zone-fear";
  if (l.includes("extreme greed")) return "zone-extgreed";
  if (l.includes("greed")) return "zone-greed";
  return "";
}

function renderScannerResult(data) {
  const mode = data?.mode || "fear";
  const pairs = data?.pairs || [];
  const scanned = data?.scanned || 0;

  const titleEl = $("scannerPopupTitle");
  const subEl = $("scannerPopupSub");
  const listEl = $("scannerList");

  if (titleEl) {
    titleEl.textContent =
      mode === "fear"
        ? t("scannerResultFear") || "Fear ≤ 30"
        : t("scannerResultGreed") || "Greed ≥ 70";
  }

  if (subEl) {
    subEl.textContent = t("scannerScanned", [String(scanned)]) || `Scanned ${scanned} pairs`;
  }

  if (listEl) {
    if (!pairs.length) {
      listEl.innerHTML = `<div class="scannerEmpty">${escapeHtml(t("scannerEmpty") || "No pairs found in this zone")}</div>`;
    } else {
      listEl.innerHTML = pairs
        .map((p, i) => {
          const zone = scannerZoneClass(p.label);
          const urls = scannerExchangeUrls(p.symbol);
          const avail = Array.isArray(p.exchanges) ? p.exchanges : ["binance", "okx", "bybit"];
          const links = [
            { key: "binance", label: "Binance", url: urls.binance, cls: "scannerLinkBinance" },
            { key: "okx",     label: "OKX",     url: urls.okx,     cls: "scannerLinkOkx" },
            { key: "bybit",   label: "Bybit",   url: urls.bybit,   cls: "scannerLinkBybit" },
          ].map(({ key, label, url, cls }) => {
            const on = avail.includes(key);
            return `<a href="${on ? url : "#"}" data-ex="${key}" data-available="${on}"
              class="scannerLink ${cls}${on ? "" : " scannerLinkOff"}">${label}</a>`;
          }).join("");
          return `
          <div class="scannerItem ${zone}">
            <div class="scannerItemRow">
              <div class="scannerItemLeft">
                <div class="scannerItemRank">${i + 1}</div>
                <div class="scannerItemSymbol">${escapeHtml(p.symbol)}</div>
              </div>
              <div class="scannerItemRight">
                <div class="scannerItemScore">${p.score}</div>
                <div class="scannerItemLabel">${escapeHtml(p.label)}</div>
              </div>
            </div>
            <div class="scannerItemLinks">${links}</div>
          </div>`;
        })
        .join("");
    }
  }

}

async function fetchMarketStats(symbol) {
  const url = new URL(API_BASE + MARKET_STATS_PATH);
  url.searchParams.set("symbol", symbol);
  try {
    const res = await httpFetch(url.toString());
    return unwrapPayload(res?.data) || res?.data || null;
  } catch {
    return null;
  }
}

function fmtLargeUsd(v) {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(0) + "K";
  return "$" + v.toFixed(0);
}

function fmtFunding(v) {
  if (v == null || isNaN(v)) return "—";
  const pct = (v * 100).toFixed(4);
  return (v >= 0 ? "+" : "") + pct + "%";
}

async function fetchScanner(mode) {
  const installId = await getOrCreateInstallId();
  const apiKey = await getApiKey();

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Install-Id": installId,
    "X-Api-Key": apiKey,
  };

  const body = JSON.stringify({ mode });

  const res = await httpFetch(API_BASE + SCANNER_PATH, {
    method: "POST",
    headers,
    body,
  });

  const data = unwrapPayload(res?.data ?? null) || {};
  if (res?.ok) return data;

  const err = String(data?.error || data?.status || "").toLowerCase();

  if (err === "upgrade_required" || err === "plan_required") {
    throw Object.assign(new Error("upgrade_required"), { status: 402, payload: data });
  }

  if (err === "limit_reached" || err === "limit_exceeded") {
    throw Object.assign(new Error("limit_reached"), { status: 429, payload: data });
  }

  throw Object.assign(
    new Error(friendlyErrorText(new Error("scanner"), { status: res?.status ?? 0 })),
    { status: res?.status ?? 0, payload: data }
  );
}

async function onScannerClick(mode) {
  const btnId = mode === "fear" ? "scannerFearBtn" : "scannerGreedBtn";
  const btn = $(btnId);

  if (!state.planValid || planText(state.plan) === "FREE") {
    showToast({
      title: t("toast_upgrade_title") || "Upgrade required",
      text: t("scannerUpgradeToast") || "Scanner is available on PRO and VIP plans.",
      linkUrl: PRICING_URL,
    });
    return;
  }

  try {
    btn?.classList.add("is-loading");
    if (btn) btn.disabled = true;
    $("scannerFearBtn" === btnId ? "scannerGreedBtn" : "scannerFearBtn")?.setAttribute("disabled", "");

    const data = await fetchScanner(mode);

    if (typeof data?.used === "number") scannerState.used = data.used;
    if (typeof data?.limit === "number") scannerState.limit = data.limit;
    renderScannerQuotaText();

    renderScannerResult(data);
    setErr("");
  } catch (e) {
    const code = String(e?.message || "").toLowerCase();

    if (code === "upgrade_required") {
      showToast({
        title: t("toast_upgrade_title") || "Upgrade required",
        text: t("scannerUpgradeToast") || "Scanner is available on PRO and VIP plans.",
        linkUrl: PRICING_URL,
      });
      return;
    }

    if (code === "limit_reached") {
      const p = e?.payload || {};
      if (typeof p.limit === "number") scannerState.limit = p.limit;
      if (typeof p.used === "number") scannerState.used = p.used;
      renderScannerQuotaText();

      showToast({
        title: t("scannerLimitTitle") || "Daily scanner limit reached",
        text:
          t("scannerLimitText", [p.used ?? 0, p.limit ?? 0]) ||
          `Scanner limit reached (${p.used ?? 0}/${p.limit ?? 0}). Try again tomorrow.`,
        linkUrl: PRICING_URL,
      });
      return;
    }

    showToast({
      title: t("scannerTitle") || "Top Pairs",
      text: friendlyErrorText(e, { status: e?.status ?? 0 }),
    });
  } finally {
    btn?.classList.remove("is-loading");
    if (btn) btn.disabled = false;
    const otherId = btnId === "scannerFearBtn" ? "scannerGreedBtn" : "scannerFearBtn";
    $(otherId)?.removeAttribute("disabled");
  }
}

// =========================
// storage
// =========================
function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.sync.get(keys, (res) => resolve(res || {})));
}
function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.sync.set(obj, () => resolve(true)));
}

async function loadSettings() {
  const res = await storageGet({
    [STORE.auto]: AUTO_REFRESH_DEFAULT,
    [STORE.interval]: DEFAULT_INTERVAL_SEC,
    [STORE.apiKey]: "",
    [STORE.installId]: "",
    [STORE.plan]: "FREE",
    [STORE.planValid]: false,
    [STORE.planUpdatedAt]: 0,
  });

  auto.enabled = typeof res[STORE.auto] === "boolean" ? res[STORE.auto] : AUTO_REFRESH_DEFAULT;
  auto.intervalSec = clampInterval(Number(res[STORE.interval] ?? DEFAULT_INTERVAL_SEC));

  state.plan = planText(res[STORE.plan] || "FREE");
  state.planValid = !!res[STORE.planValid];
}

async function saveSettingsPartial(partial) {
  await storageSet(partial);
}

function listenStorageChanges() {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;

      let needRestart = false;

      if (changes[STORE.auto]) {
        auto.enabled = !!changes[STORE.auto].newValue;
        needRestart = true;
      }
      if (changes[STORE.interval]) {
        auto.intervalSec = clampInterval(Number(changes[STORE.interval].newValue));
        needRestart = true;
      }
      if (changes[STORE.plan]) state.plan = planText(changes[STORE.plan].newValue || "FREE");
      if (changes[STORE.planValid]) state.planValid = !!changes[STORE.planValid].newValue;

      const autoChk = $("s_auto");
      if (autoChk) autoChk.checked = auto.enabled;

      const intInp = $("s_interval");
      if (intInp) intInp.value = String(auto.intervalSec);

      renderPlan(state.plan, state.planValid);
      renderPlanStatus();
      renderAiQuotaText();
      renderScannerQuotaText();

      if (needRestart) restartPeriodic();
    });
  } catch {
    // ignore
  }
}

// =========================
// install_id + api_key helpers
// =========================
async function getOrCreateInstallId() {
  const res = await storageGet({ [STORE.installId]: "" });
  let id = res[STORE.installId];
  if (!id) {
    id = crypto.randomUUID();
    await storageSet({ [STORE.installId]: id });
  }
  return id;
}

async function getApiKey() {
  const res = await storageGet({ [STORE.apiKey]: "" });
  return (res[STORE.apiKey] || "").trim();
}

async function setApiKey(v) {
  await storageSet({ [STORE.apiKey]: (v || "").trim() });
}

// =========================
// Validate API key (backend)
// =========================
async function validateCurrentKey({ force = false, silent = false } = {}) {
  const now = Date.now();
  const cached = await storageGet({
    [STORE.plan]: "FREE",
    [STORE.planValid]: false,
    [STORE.planUpdatedAt]: 0,
  });

  const cacheTs = Number(cached[STORE.planUpdatedAt] || 0);
  const cacheFresh = cacheTs && now - cacheTs < PLAN_TTL_MS;

  await setPlanState({
    plan: cached[STORE.plan] || "FREE",
    valid: !!cached[STORE.planValid],
    status: "cached",
    save: false,
  });

  if (!force && cacheFresh) return { cached: true, plan: state.plan, valid: state.planValid };

  const installId = await getOrCreateInstallId();
  const apiKey = await getApiKey();

  if (!apiKey) {
    await setPlanState({ plan: "FREE", valid: false, status: "missing", save: true });
    return { cached: false, plan: "FREE", valid: false, status: "missing" };
  }

  const url = new URL(API_BASE + VALIDATE_PATH);
  const headers = {
    Accept: "application/json",
    "X-Install-Id": installId,
    "X-Api-Key": apiKey,
  };

  let res;
  try {
    res = await httpFetch(url.toString(), { headers });
  } catch (e) {
    const msg = friendlyErrorText(e);
    if (!silent) throw new Error(msg);
    return { cached: false, error: msg };
  }

  const raw = res?.data ?? null;
  const data = unwrapPayload(raw) || {};
  const statusCode = res?.status ?? 0;

  // If not ok but backend returned structured status -> show it
  if (!res || !res.ok) {
    if (data && typeof data === "object" && data.status) {
      await setPlanState({
        plan: data.plan ?? "FREE",
        valid: typeof data.valid === "boolean" ? data.valid : false,
        status: data.status,
        save: true,
      });
      return { cached: false, plan: state.plan, valid: state.planValid, status: data.status, data };
    }

    const msg = friendlyErrorText(new Error(String(raw || "")), { status: statusCode });
    if (!silent) throw new Error(msg);
    return { cached: false, error: msg };
  }

  const plan = planText(data.plan || "FREE");
  const valid = !!data.valid;
  const status = data.status || (valid ? "ok" : "invalid");

  await setPlanState({ plan, valid, status, save: true });
  return { cached: false, plan, valid, status, data };
}

// =========================
// Quota fetch (backend)
// =========================
async function fetchQuota(symbol) {
  const url = new URL(API_BASE + QUOTA_PATH);
  url.searchParams.set("symbol", symbol);

  const installId = await getOrCreateInstallId();
  const apiKey = await getApiKey();

  const headers = {
    Accept: "application/json",
    "X-Install-Id": installId,
  };
  if (apiKey) headers["X-Api-Key"] = apiKey;

  let res;
  try {
    res = await httpFetch(url.toString(), { headers });
  } catch (e) {
    throw new Error(friendlyErrorText(e));
  }

  const raw = res?.data ?? null;
  const data = unwrapPayload(raw);

  if (res && res.ok) return data;

  // even if not ok, return structured payload to avoid UI crash
  if (data && typeof data === "object") return data;

  const status = res?.status ?? 0;
  throw new Error(friendlyErrorText(new Error("quota"), { status }));
}

// Fetch quota only when symbol changes (and throttle)
async function maybeUpdateQuota(symbol, { force = false } = {}) {
  if (!symbol) return;

  const now = Date.now();
  const sameSym = quotaState.lastSymbol === symbol;
  const fresh = now - quotaState.lastAt < QUOTA_TTL_MS;

  if (!force && sameSym && fresh) return;

  if (quotaState.inFlight) {
    quotaState.queued = true;
    return;
  }

  quotaState.inFlight = true;
  quotaState.queued = false;
  renderQuota({ plan: state.plan }); // показати PRO • … поки loading

  try {
    const meta = await fetchQuota(symbol);

    if (meta && typeof meta === "object") {
      if ("plan" in meta || "valid" in meta || "status" in meta) {
        await setPlanState({
          plan: meta.plan ?? state.plan,
          valid: typeof meta.valid === "boolean" ? meta.valid : state.planValid,
          status: meta.status,
          save: false,
        });
      }
      renderQuota(meta);
      quotaState.hasData = true;
    }

    quotaState.lastSymbol = symbol;
    quotaState.lastAt = Date.now();
  } catch {
    // don't crash UI if quota endpoint fails
  } finally {
    quotaState.inFlight = false;
    if (quotaState.queued) {
      quotaState.queued = false;
      setTimeout(() => maybeUpdateQuota(symbol, { force: true }), 250);
    }
  }
}

// =========================
// Tabs
// =========================
function setActiveTab(tab) {
  const tabs = {
    overview: { btn: $("tabOverview"), view: $("viewOverview") },
    details: { btn: $("tabDetails"), view: $("viewDetails") },
    settings: { btn: $("tabSettings"), view: $("viewSettings") },
    help: { btn: $("tabHelp"), view: $("viewHelp") },
  };

  Object.entries(tabs).forEach(([key, obj]) => {
    obj.btn?.classList.toggle("is-active", key === tab);
    obj.btn?.setAttribute("aria-selected", key === tab ? "true" : "false");
    obj.view?.classList.toggle("is-active", key === tab);
  });
}

// =========================
// Sentiment helpers
// =========================
function stateFromValue(v) {
  if (typeof v !== "number" || !isFinite(v)) return "neutral";
  if (v < 25) return "extfear";
  if (v < 45) return "fear";
  if (v <= 55) return "neutral";
  if (v < 76) return "greed";
  return "extgreed";
}

function labelFromValue(v) {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  const key =
    v < 25
      ? "labelExtremeFear"
      : v < 45
      ? "labelFear"
      : v <= 55
      ? "labelNeutral"
      : v < 76
      ? "labelGreed"
      : "labelExtremeGreed";

  return (
    t(key) ||
    (v < 25
      ? "EXTREME FEAR"
      : v < 45
      ? "FEAR"
      : v <= 55
      ? "NEUTRAL"
      : v < 76
      ? "GREED"
      : "EXTREME GREED")
  );
}

function zoneName(v) {
  const st = stateFromValue(v);
  const key =
    st === "extfear"
      ? "zoneExtremeFear"
      : st === "fear"
      ? "zoneFear"
      : st === "neutral"
      ? "zoneNeutral"
      : st === "greed"
      ? "zoneGreed"
      : "zoneExtremeGreed";

  return (
    t(key) ||
    (st === "extfear"
      ? "Extreme Fear"
      : st === "fear"
      ? "Fear"
      : st === "neutral"
      ? "Neutral"
      : st === "greed"
      ? "Greed"
      : "Extreme Greed")
  );
}

function needleColorByState(st) {
  return (
    st === "extfear"
      ? "rgb(220,38,38)"
      : st === "fear"
      ? "rgb(239,68,68)"
      : st === "neutral"
      ? "rgb(234,179,8)"
      : st === "greed"
      ? "rgb(34,197,94)"
      : "rgb(22,163,74)"
  );
}

// =========================
// Venue + symbol detect
// =========================
function detectVenue(host) {
  host = (host || "").toLowerCase();
  if (host.includes("binance.com")) return "BINANCE";
  if (host.includes("bybit.com")) return "BYBIT";
  if (host.includes("okx.com")) return "OKX";
  return "UNKNOWN";
}

function normalizeSymbol(raw) {
  if (!raw) return null;
  return String(raw).replace(/[-_\/:]/g, "").toUpperCase();
}

function extractSymbolFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    const path = u.pathname;

    if (host.includes("binance.com")) {
      const m = path.match(/\/trade\/([A-Z0-9]+)_([A-Z0-9]+)/i);
      if (m) return normalizeSymbol(m[1] + m[2]);
      const q = u.searchParams.get("symbol");
      if (q) return normalizeSymbol(q);
    }

    if (host.includes("bybit.com")) {
      const q = u.searchParams.get("symbol");
      if (q) return normalizeSymbol(q);

      let m = path.match(/\/trade\/usdt\/([A-Z0-9]+)/i);
      if (m) return normalizeSymbol(m[1]);

      m = path.match(/\/trade\/spot\/([A-Z0-9]+)\/([A-Z0-9]+)/i);
      if (m) return normalizeSymbol(m[1] + m[2]);

      m = path.match(/\/trade\/spot\/([A-Z0-9]+)/i);
      if (m) return normalizeSymbol(m[1]);
    }

    if (host.includes("okx.com")) {
      let m = path.match(/\/trade-spot\/([A-Z0-9-]+)/i);
      if (m) return normalizeSymbol(m[1]);

      m = path.match(/\/trade-swap\/([A-Z0-9-]+)/i);
      if (m) {
        const parts = m[1].toUpperCase().split("-");
        if (parts.length >= 2) return normalizeSymbol(parts[0] + parts[1]);
      }

      m = path.match(/\/price\/[a-z0-9-]+-([a-z0-9]+)/i);
      if (m) return normalizeSymbol(m[1] + "USDT");
    }


    return null;
  } catch {
    return null;
  }
}

async function getActiveTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url || "";
}

// =========================
// API fetch (via SW proxy + headers)
// =========================
async function fetchFng(symbol, tf) {
  const url = new URL(API_BASE + FNG_PATH);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("tf", tf);

  const installId = await getOrCreateInstallId();
  const apiKey = await getApiKey();

  const headers = {
    Accept: "application/json",
    "X-Install-Id": installId,
  };
  if (apiKey) headers["X-Api-Key"] = apiKey;

  let res;
  try {
    res = await httpFetch(url.toString(), { headers });
  } catch (e) {
    throw new Error(friendlyErrorText(e));
  }

  const raw = res?.data ?? null;
  const payload = unwrapPayload(raw);
  const status = res?.status ?? 0;

  // keep plan in sync if backend returns it
  if (payload && typeof payload === "object") {
    if ("plan" in payload || "valid" in payload || "status" in payload) {
      await setPlanState({
        plan: payload.plan ?? state.plan,
        valid: typeof payload.valid === "boolean" ? payload.valid : state.planValid,
        status: payload.status,
        save: false,
      });
    }
  }

  // if backend says limit exceeded -> return payload even if HTTP is not ok (402 etc)
  if (payload && typeof payload === "object" && payload.status === "limit_exceeded") {
    return payload;
  }

  if (res && res.ok) return payload;

  // If not ok but backend returned structured payload with status -> still return it
  if (payload && typeof payload === "object" && payload.status) return payload;

  throw new Error(friendlyErrorText(new Error("fng"), { status }));
}

// =========================
// Gauge drawing
// =========================
function colorAt(tN) {
  let rC, gC, bC;
  if (tN < 0.5) {
    const k = tN / 0.5;
    rC = 255;
    gC = Math.round(59 + (204 - 59) * k);
    bC = Math.round(48 + (0 - 48) * k);
  } else {
    const k = (tN - 0.5) / 0.5;
    rC = Math.round(255 + (52 - 255) * k);
    gC = Math.round(204 + (199 - 204) * k);
    bC = Math.round(0 + (89 - 0) * k);
  }
  return { r: rC, g: gC, b: bC };
}

function drawGradientArc(ctx, cx, cy, r, start, end, lineW) {
  const steps = 200;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const a0 = start + (end - start) * t0;
    const a1 = start + (end - start) * t1;
    const tM = (t0 + t1) / 2;
    const c = colorAt(tM);
    ctx.strokeStyle = `rgb(${c.r},${c.g},${c.b})`;
    ctx.lineWidth = lineW;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1, false);
    ctx.stroke();
  }
}

function drawGlowArc(ctx, cx, cy, r, start, end, lineW) {
  const passes = [
    { add: 14, alpha: 0.1 },
    { add: 8, alpha: 0.12 },
    { add: 3, alpha: 0.14 },
  ];
  for (const p of passes) {
    const steps = 120;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const a0 = start + (end - start) * t0;
      const a1 = start + (end - start) * t1;
      const tM = (t0 + t1) / 2;
      const c = colorAt(tM);
      ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${p.alpha})`;
      ctx.lineWidth = lineW + p.add;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1, false);
      ctx.stroke();
    }
  }
}

function drawTicks(ctx, cx, cy, r, start, end) {
  const ticks = [0, 25, 50, 75, 100];

  ctx.save();
  ctx.font = "600 11px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.74)";
  ctx.strokeStyle = "rgba(255,255,255,0.62)";
  ctx.lineWidth = 2;

  for (const tv of ticks) {
    const tN = tv / 100;
    const a = start + (end - start) * tN;

    const r1 = r - 5;
    const r2 = r - 18;

    const x1 = cx + Math.cos(a) * r1;
    const y1 = cy + Math.sin(a) * r1;
    const x2 = cx + Math.cos(a) * r2;
    const y2 = cy + Math.sin(a) * r2;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const rt = r - 34;
    const xt = cx + Math.cos(a) * rt;
    const yt = cy + Math.sin(a) * rt;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(tv), xt, yt);
  }

  ctx.fillStyle = "rgba(255,255,255,0.64)";
  ctx.font = "600 11px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(t("fearLabelShort") || "Fear", cx - r + 6, cy - 6);
  ctx.textAlign = "right";
  ctx.fillText(t("greedLabelShort") || "Greed", cx + r - 6, cy - 6);

  ctx.restore();
}

function drawGauge(canvas, value, st) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const v =
    typeof value === "number" && isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : null;

  const cx = w / 2;
  const cy = h * 0.88;
  const r = Math.min(w * 0.42, h * 0.92);

  const start = Math.PI;
  const end = 2 * Math.PI;
  const baseW = Math.max(14, Math.round(r * 0.17));

  ctx.strokeStyle = "rgba(15, 23, 42, 0.60)";
  ctx.lineWidth = baseW + 14;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end, false);
  ctx.stroke();

  drawGlowArc(ctx, cx, cy, r, start, end, baseW);
  drawGradientArc(ctx, cx, cy, r, start, end, baseW);
  drawTicks(ctx, cx, cy, r, start, end);

  if (v !== null) {
    const a = start + (end - start) * (v / 100);
    const len = r - baseW * 0.3;
    const nx = cx + Math.cos(a) * len;
    const ny = cy + Math.sin(a) * len;

    const needleColor = needleColorByState(st);

    ctx.strokeStyle = needleColor;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.stroke();

    ctx.fillStyle = needleColor;
    ctx.beginPath();
    ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 10.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// =========================
// Risk computation + render
// =========================
function zoneIndex(v) {
  if (typeof v !== "number" || !isFinite(v)) return 2;
  if (v < 25) return 0;
  if (v < 45) return 1;
  if (v <= 55) return 2;
  if (v < 76) return 3;
  return 4;
}

function spreadPenalty(spread) {
  return spread === 0 ? 0 : spread === 1 ? 15 : spread === 2 ? 35 : spread === 3 ? 60 : 80;
}

function impulseScore(v15, v1h, v4h) {
  const imp = Math.max(Math.abs(v15 - v1h), Math.abs(v15 - v4h));
  if (imp < 6) return { I: 0 };
  if (imp < 12) return { I: 25 };
  if (imp < 18) return { I: 50 };
  if (imp < 25) return { I: 75 };
  return { I: 90 };
}

function computeRisk(values) {
  const v15 = values["15m"],
    v1 = values["1h"],
    v4 = values["4h"],
    vD = values["1d"];
  const w = { "15m": 0.15, "1h": 0.2, "4h": 0.3, "1d": 0.35 };
  const ext = (v) => Math.abs(v - 50) / 50;

  const E =
    100 *
    (w["15m"] * ext(v15) + w["1h"] * ext(v1) + w["4h"] * ext(v4) + w["1d"] * ext(vD));
  const zones = [zoneIndex(v15), zoneIndex(v1), zoneIndex(v4), zoneIndex(vD)];
  const spread = Math.max(...zones) - Math.min(...zones);
  const D = spreadPenalty(spread);
  const impA = Math.abs(v15 - v1);
  const impB = Math.abs(v15 - v4);
  const { I } = impulseScore(v15, v1, v4);

  let risk = 0.55 * E + 0.3 * D + 0.15 * I;
  risk = Math.max(0, Math.min(100, risk));

  const level =
    risk < 30
      ? { key: t("riskLow") || "LOW", cls: "risk-low" }
      : risk < 55
      ? { key: t("riskMedium") || "MEDIUM", cls: "risk-med" }
      : risk < 75
      ? { key: t("riskHigh") || "HIGH", cls: "risk-high" }
      : { key: t("riskExtreme") || "EXTREME", cls: "risk-ext" };

  const chipE = t("chipE") || "E";
  const chipSpread = t("chipSpread") || "Spread";
  const chip15_1 = t("chip15_1") || "15m↔1h";
  const chip15_4 = t("chip15_4") || "15m↔4h";

  const chips = [
    `${chipE}:${Math.round(E)}%`,
    `${chipSpread}:${spread}`,
    `${chip15_1}:${impA.toFixed(1)}`,
    `${chip15_4}:${impB.toFixed(1)}`,
  ];

  return { risk, level, chips, E, spread, impA, impB };
}

function renderRisk(r) {
  const card = $("riskCard");
  if (!card) return;

  card.classList.remove("risk-low", "risk-med", "risk-high", "risk-ext");
  card.classList.add(r.level.cls);

  setText("riskLevel", r.level.key);
  setText("riskScore", String(Math.round(r.risk)));

  const fill = $("riskFill");
  if (fill) fill.style.width = `${Math.round(r.risk)}%`;

  const chipsEl = $("riskChips");
  if (chipsEl) {
    chipsEl.innerHTML = "";
    for (const c of r.chips) {
      const el = document.createElement("div");
      el.className = "riskChip";
      el.textContent = c;
      chipsEl.appendChild(el);
    }
  }
}

// =========================
// Rendering (Overview)
// =========================
function applyCard(tf, d) {
  const p = unwrapPayload(d);

  const value = typeof p?.value === "number" ? p.value : null;
  const st = value == null ? "neutral" : stateFromValue(value);

  const bar = $(`bar_${tf}`);
  if (bar) bar.className = `bar ${st}`;

  const pill = $(`pill_${tf}`);
  if (pill) pill.textContent = value == null ? "—" : labelFromValue(value);

  setText(`val_${tf}`, value == null ? "—" : fmt(value));
  drawGauge($(`g_${tf}`), value, st);
}

// =========================
// Details
// =========================
let detailsStylesInjected = false;

function ensureDetailsStyles() {
  if (detailsStylesInjected) return;
  detailsStylesInjected = true;

  const css = `
  #detailsBars{margin-bottom:14px}
  .d-wrap{display:flex;flex-direction:column;gap:12px}
  .d-section{padding:10px;border:1px solid rgba(234,236,239,.10);border-radius:14px;background:rgba(17,24,39,.25)}
  .d-title{font-weight:800;font-size:12px;letter-spacing:.2px;margin-bottom:8px;opacity:.95}
  .d-row{display:flex;flex-direction:column;gap:6px;margin:10px 0}
  .d-rowtop{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
  .d-name{font-weight:700;font-size:12px;opacity:.92}
  .d-val{font-weight:800;font-size:12px;opacity:.95}
  .d-bar{position:relative;height:10px}
  .d-track{position:absolute;inset:0;border-radius:999px;background:linear-gradient(90deg,#ff3b30 0%,#fcd535 50%,#34c759 100%);opacity:.95;}
  .d-dot{position:absolute;top:50%;transform:translate(-50%,-50%);width:10px;height:10px;border-radius:999px;border:2px solid rgba(0,0,0,.45);box-shadow:0 0 0 2px rgba(255,255,255,.12);background:#EAECEF;}
  .d-sub{font-size:12px;opacity:.70}
  .z-extfear{color:rgb(220,38,38)}
  .z-fear{color:rgb(239,68,68)}
  .z-neutral{color:rgb(234,179,8)}
  .z-greed{color:rgb(34,197,94)}
  .z-extgreed{color:rgb(22,163,74)}
  .mstat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px;padding-bottom:70px}
  .mstat-item{display:flex;flex-direction:column;gap:8px;padding:16px 14px;border-radius:16px;background:linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.10);box-shadow:0 4px 16px rgba(0,0,0,0.35);position:relative;cursor:default}
  .mstat-label{font-size:9px;font-weight:800;letter-spacing:.7px;color:rgba(255,255,255,0.45);text-transform:uppercase}
  .mstat-value{font-size:22px;font-weight:900;letter-spacing:-.5px;line-height:1}
  .mstat-sub{font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);margin-top:2px}
  .mstat-item[data-tooltip]::after{content:attr(data-tooltip);position:absolute;top:calc(100% + 7px);left:50%;transform:translateX(-50%);background:rgba(10,14,26,0.97);border:1px solid rgba(255,255,255,0.14);color:rgba(255,255,255,0.88);font-size:10px;font-weight:500;line-height:1.45;padding:7px 10px;border-radius:9px;width:155px;text-align:center;pointer-events:none;opacity:0;transition:opacity .15s ease;z-index:200;white-space:normal;box-shadow:0 4px 14px rgba(0,0,0,0.55)}
  .mstat-item[data-tooltip]:hover::after{opacity:1}
  .mstat-item-vol  {border-color:rgba(99,102,241,0.40); background:linear-gradient(135deg,rgba(99,102,241,0.18),rgba(99,102,241,0.06))}
  .mstat-item-oi   {border-color:rgba(245,158,11,0.40);  background:linear-gradient(135deg,rgba(245,158,11,0.18),rgba(245,158,11,0.06))}
  .mstat-item-fund {border-color:rgba(16,185,129,0.40);  background:linear-gradient(135deg,rgba(16,185,129,0.18),rgba(16,185,129,0.06))}
  .mstat-item-fund-neg{border-color:rgba(239,68,68,0.40)!important;background:linear-gradient(135deg,rgba(239,68,68,0.18),rgba(239,68,68,0.06))!important}
  .mstat-item-ls   {border-color:rgba(168,85,247,0.40);  background:linear-gradient(135deg,rgba(168,85,247,0.18),rgba(168,85,247,0.06))}
  .mstat-item-ls-bear{border-color:rgba(239,68,68,0.40)!important;background:linear-gradient(135deg,rgba(239,68,68,0.18),rgba(239,68,68,0.06))!important}
  .mstat-item-taker{border-color:rgba(6,182,212,0.40);   background:linear-gradient(135deg,rgba(6,182,212,0.18),rgba(6,182,212,0.06))}
  .mstat-item-taker-sell{border-color:rgba(239,68,68,0.40)!important;background:linear-gradient(135deg,rgba(239,68,68,0.18),rgba(239,68,68,0.06))!important}
  .mstat-item-rsi  {border-color:rgba(52,211,153,0.40);  background:linear-gradient(135deg,rgba(52,211,153,0.18),rgba(52,211,153,0.06))}
  .mstat-item-rsi-ob{border-color:rgba(239,68,68,0.40)!important;background:linear-gradient(135deg,rgba(239,68,68,0.18),rgba(239,68,68,0.06))!important}
  .mstat-item-rsi-os{border-color:rgba(99,102,241,0.40)!important;background:linear-gradient(135deg,rgba(99,102,241,0.18),rgba(99,102,241,0.06))!important}
  `;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
}

function detailsClassByValue(v) {
  const st = stateFromValue(v);
  return st === "extfear"
    ? "z-extfear"
    : st === "fear"
    ? "z-fear"
    : st === "neutral"
    ? "z-neutral"
    : st === "greed"
    ? "z-greed"
    : "z-extgreed";
}

function detailsBarRow(title, value, rightText) {
  const v =
    typeof value === "number" && isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  const cls = v == null ? "z-neutral" : detailsClassByValue(v);
  const label = rightText ?? (v == null ? "—" : `${fmt(v)} • ${zoneName(v)}`);
  const left = v == null ? 50 : v;

  return `
    <div class="d-row">
      <div class="d-rowtop">
        <div class="d-name">${escapeHtml(title)}</div>
        <div class="d-val ${cls}">${escapeHtml(label)}</div>
      </div>
      <div class="d-bar">
        <div class="d-track"></div>
        <div class="d-dot ${cls}" style="left:${left}%;"></div>
      </div>
    </div>
  `;
}

function renderDetails() {
  ensureDetailsStyles();
  const host = $("detailsBars");
  if (!host) return;

  const v15 = state.values["15m"];
  const v1 = state.values["1h"];
  const v4 = state.values["4h"];
  const vD = state.values["1d"];

  const arr = [v15, v1, v4, vD].map((v) => (typeof v === "number" && isFinite(v) ? v : NaN));
  const okAll = arr.every((v) => isFinite(v));

  const minV = Math.min(...arr);
  const maxV = Math.max(...arr);
  const diff = maxV - minV;
  const tilt = arr.reduce((a, b) => a + b, 0) / arr.length;
  const eValue = state.risk ? state.risk.E : 0;

  const ms = state.marketStats;
  const funding   = ms?.funding_rate     ?? null;
  const oi        = ms?.open_interest_usd ?? null;
  const vol24     = ms?.volume_24h        ?? null;
  const lsRatio   = ms?.ls_ratio          ?? null;
  const takerR    = ms?.taker_ratio       ?? null;
  const rsiVal    = ms?.rsi               ?? null;

  const fundNeg   = funding  != null && funding  < 0;
  const lsBear    = lsRatio  != null && lsRatio  > 1.5;
  const takerSell = takerR   != null && takerR   < 1;
  const rsiOB     = rsiVal   != null && rsiVal   > 70;
  const rsiOS     = rsiVal   != null && rsiVal   < 30;

  const fundColor  = funding  == null ? "#fff" : funding  > 0 ? "#6EE7B7" : "#FCA5A5";
  const lsColor    = lsRatio  == null ? "#fff" : lsRatio  > 1.5 ? "#FCA5A5" : lsRatio < 0.7 ? "#6EE7B7" : "#C4B5FD";
  const takerColor = takerR   == null ? "#fff" : takerR   >= 1  ? "#6EE7B7" : "#FCA5A5";
  const rsiColor   = rsiVal   == null ? "#fff" : rsiVal   > 70  ? "#FCA5A5" : rsiVal < 30 ? "#93C5FD" : "#6EE7B7";

  const lsSub   = lsRatio  != null ? (lsRatio > 1.5 ? "Too many longs ⚠️" : lsRatio < 0.7 ? "Shorts dominate" : "Balanced") : "";
  const tkSub   = takerR   != null ? (takerR  >= 1  ? "Buyers aggressive" : "Sellers aggressive") : "";
  const rsiSub  = rsiVal   != null ? (rsiVal  > 70  ? "Overbought" : rsiVal < 30 ? "Oversold" : "Neutral zone") : "";

  if (!ms) {
    host.innerHTML = `<div class="d-wrap"><div class="d-section"><div class="d-sub">${escapeHtml(t("waiting") || "Waiting for market data...")}</div></div></div>`;
    return;
  }

  host.innerHTML = `
    <div class="mstat-grid">
      <div class="mstat-item mstat-item-vol" data-tooltip="${escapeHtml(t("tip_vol24"))}">
        <div class="mstat-label">Volume 24h</div>
        <div class="mstat-value" style="color:#A5B4FC">${fmtLargeUsd(vol24)}</div>
        <div class="mstat-sub">Futures quote vol</div>
      </div>
      <div class="mstat-item mstat-item-oi" data-tooltip="${escapeHtml(t("tip_oi"))}">
        <div class="mstat-label">Open Interest</div>
        <div class="mstat-value" style="color:#FCD34D">${fmtLargeUsd(oi)}</div>
        <div class="mstat-sub">Total OI in USD</div>
      </div>
      <div class="mstat-item mstat-item-fund${fundNeg ? " mstat-item-fund-neg" : ""}" data-tooltip="${escapeHtml(t("tip_funding"))}">
        <div class="mstat-label">Funding Rate</div>
        <div class="mstat-value" style="color:${fundColor}">${fmtFunding(funding)}</div>
        <div class="mstat-sub">${funding != null ? (funding > 0 ? "Longs pay shorts" : "Shorts pay longs") : ""}</div>
      </div>
      <div class="mstat-item mstat-item-ls${lsBear ? " mstat-item-ls-bear" : ""}" data-tooltip="${escapeHtml(t("tip_ls"))}">
        <div class="mstat-label">Long / Short</div>
        <div class="mstat-value" style="color:${lsColor}">${lsRatio != null ? lsRatio.toFixed(2) : "—"}</div>
        <div class="mstat-sub">${lsSub}</div>
      </div>
      <div class="mstat-item mstat-item-taker${takerSell ? " mstat-item-taker-sell" : ""}" data-tooltip="${escapeHtml(t("tip_taker"))}">
        <div class="mstat-label">Taker Buy/Sell</div>
        <div class="mstat-value" style="color:${takerColor}">${takerR != null ? takerR.toFixed(2) : "—"}</div>
        <div class="mstat-sub">${tkSub}</div>
      </div>
      <div class="mstat-item mstat-item-rsi${rsiOB ? " mstat-item-rsi-ob" : rsiOS ? " mstat-item-rsi-os" : ""}" data-tooltip="${escapeHtml(t("tip_rsi1d"))}">
        <div class="mstat-label">RSI (1D)</div>
        <div class="mstat-value" style="color:${rsiColor}">${rsiVal != null ? rsiVal.toFixed(1) : "—"}</div>
        <div class="mstat-sub">${rsiSub}</div>
      </div>
    </div>
  `;
}

// =========================
// Periodic refresh control
// =========================
function restartPeriodic() {
  if (auto.periodicTimer) {
    clearInterval(auto.periodicTimer);
    auto.periodicTimer = null;
  }
  if (!auto.enabled) return;

  auto.periodicTimer = setInterval(() => {
    if (auto.lastSymbol) refresh(lastSeenUrl, "periodic");
    else checkActiveUrl("periodic-check");
  }, auto.intervalSec * 1000);
}

// =========================
// Auto-refresh
// =========================
function scheduleRefresh(reason, url) {
  if (auto.debounceTimer) clearTimeout(auto.debounceTimer);
  auto.debounceTimer = setTimeout(() => refresh(url || lastSeenUrl, reason), DEBOUNCE_MS);
}

async function checkActiveUrl(reason) {
  try {
    const url = await getActiveTabUrl();
    if (!url) return;
    lastSeenUrl = url;

    if (url !== auto.lastUrl) {
      auto.lastUrl = url;
      if (auto.enabled) scheduleRefresh(reason || "url-change", url);
    }
  } catch {
    // ignore
  }
}

function startAutoEngines() {
  stopAutoEngines();
  checkActiveUrl("init");

  try {
    chrome.tabs.onActivated.addListener(() => checkActiveUrl("tab-activated"));
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (tab?.active && (changeInfo?.url || changeInfo?.status === "complete")) {
        checkActiveUrl(changeInfo?.url ? "tab-url" : "tab-complete");
      }
    });
    chrome.windows.onFocusChanged.addListener(() => checkActiveUrl("focus"));
  } catch {
    // ignore
  }

  auto.pollTimer = setInterval(() => {
    if (auto.enabled) checkActiveUrl("poll");
  }, AUTO_POLL_MS);

  restartPeriodic();
}

function stopAutoEngines() {
  if (auto.debounceTimer) {
    clearTimeout(auto.debounceTimer);
    auto.debounceTimer = null;
  }
  if (auto.pollTimer) {
    clearInterval(auto.pollTimer);
    auto.pollTimer = null;
  }
  if (auto.periodicTimer) {
    clearInterval(auto.periodicTimer);
    auto.periodicTimer = null;
  }
}

// =========================
// Refresh flow
// =========================
async function refresh(urlOverride, reason) {
  if (refreshInFlight) {
    refreshQueued = true;
    return;
  }

  refreshInFlight = true;
  refreshQueued = false;

  const rb = $("refresh");
  rb?.classList.add("is-loading");

  try {
    setErr("");

    const url = urlOverride || (await getActiveTabUrl());
    if (!url) {
      auto.lastSymbol = "";
      auto.lastVenue = "";
      state.venue = "—";
      state.symbol = "—";
      setText("venue", "—");
      setText("symbol", "—");
      if (reason !== "poll") setErr(t("errNoActiveTab") || "");

      TFS.forEach((tf) => applyCard(tf, null));
      state.values = { "15m": null, "1h": null, "4h": null, "1d": null };
      state.risk = null;
      state.marketStats = null;
      renderDetails();
      return;
    }

    lastSeenUrl = url;

    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {}
    const venue = detectVenue(host);
    const symbol = extractSymbolFromUrl(url);

    auto.lastVenue = symbol ? venue : "";
    auto.lastSymbol = symbol ? symbol : "";

    const prevSymbol = state.symbol;

    state.venue = symbol ? venue : "—";
    state.symbol = symbol ? symbol : "—";
    setText("venue", state.venue);
    setText("symbol", state.symbol);

    if (!symbol) {
      if (reason !== "poll" && reason !== "periodic") {
        setErr(t("errNoSymbol") || "");
      } else {
        setErr("");
      }

      TFS.forEach((tf) => applyCard(tf, null));
      state.values = { "15m": null, "1h": null, "4h": null, "1d": null };
      state.risk = null;
      renderDetails();
      return;
    }

    // Close AI popup when pair changes
    const symbolChanged = prevSymbol !== symbol && prevSymbol !== "—";
    if (symbolChanged) closeAiPopup(true);

    // Update quota ONLY when symbol changes (or on manual/init/apikey-change)
    if (symbolChanged || reason === "manual" || reason === "init" || reason === "apikey-change") {
      await maybeUpdateQuota(symbol, { force: symbolChanged });
    }

    const results = await Promise.all(
      TFS.map(async (tf) => {
        try {
          const d = await fetchFng(symbol, tf);
          const p = unwrapPayload(d);

          if (p && typeof p === "object" && p.status === "limit_exceeded") {
            return { tf, ok: true, d: p, limited: true };
          }

          return { tf, ok: true, d: p };
        } catch (e) {
          return { tf, ok: false, error: friendlyErrorText(e) };
        }
      })
    );

    for (const r of results) applyCard(r.tf, r.ok ? r.d : null);

    // render quota from any payload
    try {
      const firstObj = results.find((x) => x.ok && x.d && typeof x.d === "object");
      if (firstObj?.d) {
        const payload = unwrapPayload(firstObj.d);
        if (payload && typeof payload === "object") {
          if ("limit" in payload || "used" in payload || "remaining" in payload) {
            renderQuota(payload);
          }
        }
      }
    } catch {
      // ignore
    }

    const values = { "15m": null, "1h": null, "4h": null, "1d": null };
    for (const r of results) {
      const p = r.ok ? unwrapPayload(r.d) : null;
      if (r.ok && typeof p?.value === "number") values[r.tf] = p.value;
    }
    state.values = values;

    if (
      values["15m"] != null &&
      values["1h"] != null &&
      values["4h"] != null &&
      values["1d"] != null
    ) {
      state.risk = computeRisk(values);
      renderRisk(state.risk);
    } else {
      state.risk = null;
      setText("riskLevel", "—");
      setText("riskScore", "—");
      const fill = $("riskFill");
      if (fill) fill.style.width = "0%";
      const chipsEl = $("riskChips");
      if (chipsEl) chipsEl.innerHTML = "";
    }

    renderDetails();

    // Fetch market stats in background (non-blocking)
    if (symbol) {
      fetchMarketStats(symbol).then((ms) => {
        state.marketStats = ms;
        renderDetails();
      });
    }

    const limited = results.find((x) => x.ok && x.limited);
    if (limited) {
      const payload = unwrapPayload(limited.d) || {};
      const used = payload.used ?? "?";
      const limit = payload.limit ?? "?";

      showToast({
        title: t("toast_limit_title") || "Limit reached",
        text:
          t("toast_limit_text", [String(used), String(limit)]) ||
          `Limit exceeded (${used}/${limit}).`,
        linkUrl: PRICING_URL,
      });

      setErr("");
    } else {
      const errors = results.filter((x) => !x.ok);
      if (errors.length && reason !== "poll") {
        setErr(errors.map((x) => `${x.tf}: ${x.error}`).join(" | "));
      }
    }
  } catch (e) {
    const msg = friendlyErrorText(e);
    if (reason !== "poll") setErr(msg);
  } finally {
    rb?.classList.remove("is-loading");
    refreshInFlight = false;

    if (refreshQueued) {
      refreshQueued = false;
      scheduleRefresh("queued", lastSeenUrl);
    }
  }
}

// =========================
// Init bindings + Boot
// =========================
function initDomReady() {
  applyI18n();
  initToastBindings();

  $("btnGetKey")?.addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: GET_API_KEY_URL });
  } catch {
    // fallback (rare)
    window.open(GET_API_KEY_URL, "_blank", "noopener,noreferrer");
  }
});

  $("tabOverview")?.addEventListener("click", () => setActiveTab("overview"));
  $("tabDetails")?.addEventListener("click", () => setActiveTab("details"));
  $("tabSettings")?.addEventListener("click", () => setActiveTab("settings"));
  $("tabHelp")?.addEventListener("click", () => setActiveTab("help"));

  $("refresh")?.addEventListener("click", () => refresh(lastSeenUrl, "manual"));
  $("aiAnalyzeBtn")?.addEventListener("click", onAiAnalyzeClick);
  $("aiPopupClose")?.addEventListener("click", () => closeAiPopup(true));
  $("aiPopupBackdrop")?.addEventListener("click", () => closeAiPopup(true));
  $("tabScanner")?.addEventListener("click", openScannerPopup);
  $("scannerFearBtn")?.addEventListener("click", () => onScannerClick("fear"));
  $("scannerGreedBtn")?.addEventListener("click", () => onScannerClick("greed"));
  $("scannerPopupClose")?.addEventListener("click", () => closeScannerPopup(true));
  $("scannerDrawerHandle")?.addEventListener("click", toggleScannerCollapse);
  $("scannerList")?.addEventListener("click", (e) => {
    const a = e.target.closest(".scannerLink");
    if (!a) return;
    e.preventDefault();
    if (a.dataset.available === "false") {
      const ex = a.dataset.ex;
      const sym = a.closest(".scannerItem")?.querySelector(".scannerItemSymbol")?.textContent || "";
      showToast({ title: ex.charAt(0).toUpperCase() + ex.slice(1), text: `${sym} не торгується на спот-ринку ${ex}.` });
      return;
    }
    chrome.tabs.create({ url: a.href, active: false });
  });
  setActiveTab("overview");

  (async function boot() {
    await loadSettings();
    listenStorageChanges();
    await getOrCreateInstallId();

    renderPlan(state.plan, state.planValid);
    renderPlanStatus();
    renderAiQuotaText();
    renderScannerQuotaText();
    clearAiResult();

    await validateCurrentKey({ force: false, silent: true });

    const autoChk = $("s_auto");
    if (autoChk) {
      autoChk.checked = auto.enabled;
      autoChk.addEventListener("change", async () => {
        auto.enabled = !!autoChk.checked;
        await saveSettingsPartial({ [STORE.auto]: auto.enabled });

        if (auto.enabled) {
          await checkActiveUrl("auto-on");
          scheduleRefresh("auto-on", lastSeenUrl);
        } else {
          setErr("");
        }
        restartPeriodic();
      });
    }

    const intInp = $("s_interval");
    if (intInp) {
      intInp.value = String(auto.intervalSec);
      intInp.addEventListener("change", async () => {
        const v = clampInterval(parseInt(intInp.value, 10));
        auto.intervalSec = v;
        intInp.value = String(v);
        await saveSettingsPartial({ [STORE.interval]: auto.intervalSec });
        restartPeriodic();
      });
    }

    // API key input
    const keyInp = $("s_apiKey");
        if (keyInp) {
          keyInp.value = await getApiKey();
          syncGetKeyVisibility();

    keyInp.addEventListener("input", () => {
      syncGetKeyVisibility();
    });

      keyInp.addEventListener("change", async () => {
        const v = (keyInp.value || "").trim();
        await setApiKey(v);

        await storageSet({ [STORE.planUpdatedAt]: 0 });

        try {
          await validateCurrentKey({ force: true, silent: false });
        } catch {
          renderPlanStatus({ plan: "FREE", valid: false, status: "invalid" });
        }

        if (auto.lastSymbol) await maybeUpdateQuota(auto.lastSymbol, { force: true });
        scheduleRefresh("apikey-change", lastSeenUrl);
      });
    }

    $("btnCheckKey")?.addEventListener("click", async () => {

      const btn = $("btnCheckKey");   // ← ОЦЕ ДОДАЛИ
      const hint = $("apiKeyStatus");

      // 🔒 блокуємо кнопку
      if (btn) btn.disabled = true;

      if (hint) hint.textContent = t("checking") || "Checking...";

      try {

        const res = await validateCurrentKey({ force: true, silent: false });

        renderPlanStatus({
          plan: res?.plan || "FREE",
          valid: !!res?.valid,
          status: res?.status || "ok",
        });

        syncGetKeyVisibility();

        if (auto.lastSymbol) {
          await maybeUpdateQuota(auto.lastSymbol, { force: true });
        }

      } catch (e) {

        const msg = friendlyErrorText(e);

        renderPlanStatus({
          plan: "FREE",
          valid: false,
          status: "invalid",
        });

        await setPlanState({
          plan: "FREE",
          valid: false,
          status: "invalid",
          save: false,
        });

        syncGetKeyVisibility({ forceShow: true });

        setErr(msg);
      }
      finally {

        // 🔓 розблокувати кнопку (ВАЖЛИВО!)
        if (btn) btn.disabled = false;

      }
    });

    $("btnClearKey")?.addEventListener("click", async () => {
      await setApiKey("");
      await storageSet({
        [STORE.plan]: "FREE",
        [STORE.planValid]: false,
        [STORE.planUpdatedAt]: 0,
      });

      const keyInp2 = $("s_apiKey");
      if (keyInp2) keyInp2.value = "";

      syncGetKeyVisibility({ forceShow: true });

      await setPlanState({ plan: "FREE", valid: false, status: "missing", save: false });

      if (auto.lastSymbol) await maybeUpdateQuota(auto.lastSymbol, { force: true });
      scheduleRefresh("apikey-clear", lastSeenUrl);
      aiState.used = null;
      aiState.limit = null;
      renderAiQuotaText();
      clearAiResult();
    });

    await refresh("", "init");
    startAutoEngines();
  })();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDomReady);
} else {
  initDomReady();
}
function syncGetKeyVisibility(opts = {}) {
  const btnGet = $("btnGetKey");
  const keyInp = $("s_apiKey");
  if (!btnGet || !keyInp) return;

  if (opts.forceShow) {
    btnGet.style.display = "inline-flex";
    return;
  }

  btnGet.style.display = keyInp.value.trim() ? "none" : "inline-flex";
}
function animateAiQuotaTo(nextUsed, nextLimit) {
  const startUsed = typeof aiState.used === "number" ? aiState.used : 0;
  const limit = Number(nextLimit || 0);
  const endUsed = Math.max(0, Math.min(limit, Number(nextUsed || 0)));

  aiState.limit = limit;

  const steps = 10;
  let i = 0;
  const delta = endUsed - startUsed;

  if (startUsed === endUsed) {
    aiState.used = endUsed;
    renderAiQuotaText();
    return;
  }

  const timer = setInterval(() => {
    i += 1;
    const value = Math.round(startUsed + (delta * i) / steps);
    aiState.used = Math.max(0, Math.min(limit, value));
    renderAiQuotaText();

    if (i >= steps) {
      clearInterval(timer);
      aiState.used = endUsed;
      aiState.limit = limit;
      renderAiQuotaText();
    }
  }, 35);
}