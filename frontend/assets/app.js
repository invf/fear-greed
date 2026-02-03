'use strict';

/**
 * Crypto Sentiment OS — Web App (app.js)
 * Works with app.html structure:
 * - #sym, #refreshBtn, #grid
 * - Risk: #riskLevel #riskScore #riskFill #riskChips
 * - Details: #detailsBars
 * - Settings: #apiBase #autoRefresh #intervalSec
 * - Misc: #err #apiStatus #themeBtn
 * - Tabs: .tab[data-tab="overview|details|settings|help"], .view#view-overview etc
 */

// =========================
// Config
// =========================
const API_BASE = "https://fear-greed-24pr.onrender.com";
const FNG_PATH = "/api/fng";

const TFS = [
  { key: "15m", title: "15m" },
  { key: "1h",  title: "1h"  },
  { key: "4h",  title: "4h"  },
  { key: "1d",  title: "1d"  }
];

const DECIMALS = 1;

// Settings (localStorage)
const STORE = {
  auto: "cs_web_auto_refresh",
  interval: "cs_web_refresh_interval_sec",
  theme: "cs_web_theme"
};

const AUTO_REFRESH_DEFAULT = true;
const DEFAULT_INTERVAL_SEC = 30;
const MIN_INTERVAL_SEC = 5;
const MAX_INTERVAL_SEC = 300;

// UI auto-refresh
const AUTO_POLL_MS = 900;     // lightweight poll (not mandatory)
const DEBOUNCE_MS = 450;      // avoid spam refresh

// =========================
// DOM helpers
// =========================
function $(id) { return document.getElementById(id); }

function setErr(txt) {
  const el = $("err");
  if (el) el.textContent = txt || "";
}

function clampInterval(v) {
  if (!isFinite(v)) return DEFAULT_INTERVAL_SEC;
  return Math.max(MIN_INTERVAL_SEC, Math.min(MAX_INTERVAL_SEC, v));
}

function fmt(v) {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  return v.toFixed(DECIMALS);
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
// App state
// =========================
const state = {
  mounted: false,
  values: { "15m": null, "1h": null, "4h": null, "1d": null },
  risk: null
};

const auto = {
  enabled: AUTO_REFRESH_DEFAULT,
  intervalSec: DEFAULT_INTERVAL_SEC,

  debounceTimer: null,
  pollTimer: null,
  periodicTimer: null,

  refreshInFlight: false,
  refreshQueued: false
};

// =========================
// Tabs + Theme
// =========================
function initTabs() {
  const tabs = document.querySelectorAll(".tab[data-tab]");
  const views = document.querySelectorAll(".view");

  function setActive(tabKey) {
    tabs.forEach(b => b.classList.toggle("is-active", b.dataset.tab === tabKey));
    views.forEach(v => v.classList.toggle("is-active", v.id === `view-${tabKey}`));
  }

  tabs.forEach(btn => {
    btn.addEventListener("click", () => setActive(btn.dataset.tab));
  });

  // default
  setActive("overview");
}

function initTheme() {
  const btn = $("themeBtn");
  if (!btn) return;

  // restore
  const saved = localStorage.getItem(STORE.theme);
  if (saved === "light") document.body.classList.add("light");

  btn.addEventListener("click", () => {
    document.body.classList.toggle("light");
    localStorage.setItem(STORE.theme, document.body.classList.contains("light") ? "light" : "dark");
  });
}

// =========================
// Settings load/save
// =========================
function loadSettings() {
  const a = localStorage.getItem(STORE.auto);
  const i = localStorage.getItem(STORE.interval);

  auto.enabled = (a === null) ? AUTO_REFRESH_DEFAULT : (a === "1");
  auto.intervalSec = clampInterval(Number(i ?? DEFAULT_INTERVAL_SEC));
}

function syncSettingsUI() {
  const apiInp = $("apiBase");
  if (apiInp) apiInp.value = API_BASE;

  const autoChk = $("autoRefresh");
  if (autoChk) autoChk.checked = auto.enabled;

  const intInp = $("intervalSec");
  if (intInp) intInp.value = String(auto.intervalSec);
}

function bindSettingsUI() {
  const autoChk = $("autoRefresh");
  if (autoChk) {
    autoChk.addEventListener("change", () => {
      auto.enabled = !!autoChk.checked;
      localStorage.setItem(STORE.auto, auto.enabled ? "1" : "0");
      restartPeriodic();
      if (auto.enabled) scheduleRefresh("auto-on");
    });
  }

  const intInp = $("intervalSec");
  if (intInp) {
    intInp.addEventListener("change", () => {
      const v = clampInterval(parseInt(intInp.value, 10));
      auto.intervalSec = v;
      intInp.value = String(v);
      localStorage.setItem(STORE.interval, String(v));
      restartPeriodic();
    });
  }
}

// =========================
// API fetch (with safe fallback)
// =========================
function pseudoRandomFrom(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function labelFromValue(v) {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  if (v < 25) return "EXTREME FEAR";
  if (v < 45) return "FEAR";
  if (v <= 55) return "NEUTRAL";
  if (v < 76) return "GREED";
  return "EXTREME GREED";
}

function stateFromValue(v) {
  if (typeof v !== "number" || !isFinite(v)) return "neutral";
  if (v < 25) return "extfear";
  if (v < 45) return "fear";
  if (v <= 55) return "neutral";
  if (v < 76) return "greed";
  return "extgreed";
}

function zoneName(v) {
  const st = stateFromValue(v);
  return (
    st === "extfear" ? "Extreme Fear" :
    st === "fear" ? "Fear" :
    st === "neutral" ? "Neutral" :
    st === "greed" ? "Greed" :
    "Extreme Greed"
  );
}

function mockFNG(symbol, tf) {
  const base = 30 + 70 * pseudoRandomFrom(symbol + tf);
  const v = Math.max(0, Math.min(100, base));
  return {
    coin: symbol,
    tf,
    value: Number(v.toFixed(1)),
    label: labelFromValue(v),
    updatedAt: new Date().toISOString(),
    __mock: true
  };
}

async function fetchFNG(symbol, tf) {
  const url = new URL(API_BASE + FNG_PATH);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("tf", tf);

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
      cache: "no-store",
      signal: ctrl.signal
    });
    clearTimeout(t);

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`${tf} -> HTTP ${r.status}: ${text.slice(0, 200)}`);
    }
    const data = await r.json();
    return data;
  } catch (e) {
    // fallback
    console.warn("API fallback to mock:", symbol, tf, e);
    return mockFNG(symbol, tf);
  }
}

async function pingApi() {
  const el = $("apiStatus");
  if (!el) return;
  try {
    const r = await fetch(API_BASE + "/health", { cache: "no-store" });
    el.textContent = r.ok ? API_BASE + " (online)" : API_BASE + " (offline)";
  } catch {
    el.textContent = API_BASE + " (offline)";
  }
}

// =========================
// Gauge rendering (SVG)
// =========================
const COLORS = {
  track: "#1f2937",
  fear: "#ef4444",
  neutral: "#f59e0b",
  greed: "#34d399",
  needle: "#e5e7eb",
  center: "#e5e7eb",
  muted: "#9aa3b2"
};

function toAngle(v) {
  const val = Math.max(0, Math.min(100, Number(v) || 0));
  return -90 + (val / 100) * 180;
}

// Semi-circle gauge SVG (like your index.html)
function gaugeSVG(id, value = 50) {
  const cx = 150, cy = 150;
  const rTrack = 132;
  const rArc = rTrack - 8;
  const rTicks = rArc + 3;
  const needleLen = rArc - 18;

  const toTickA = (p) => (Math.PI) - (Math.max(0, Math.min(100, p)) / 100) * Math.PI;
  const polar = (rr, a) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  const arcPath = (rr) => `M ${cx - rr} ${cy} A ${rr} ${rr} 0 0 1 ${cx + rr} ${cy}`;

  const initDeg = toAngle(value);

  const tens = Array.from({ length: 11 }, (_, k) => k * 10);
  const majors = new Set([0, 25, 50, 75, 100]);

  return `
  <svg class="gauge" viewBox="0 0 300 160" role="img" aria-label="Gauge ${id}">
    <defs>
      <linearGradient id="sweep-${id}" x1="${cx - rArc}" y1="${cy}" x2="${cx + rArc}" y2="${cy}" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="${COLORS.fear}"/>
        <stop offset="50%" stop-color="${COLORS.neutral}"/>
        <stop offset="100%" stop-color="${COLORS.greed}"/>
      </linearGradient>
      <filter id="glow-${id}" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="g"/>
        <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>

    <path d="${arcPath(rTrack)}" fill="none" stroke="${COLORS.track}" stroke-width="22" stroke-linecap="round"/>

    <path d="${arcPath(rArc)}" fill="none" stroke="url(#sweep-${id})" stroke-width="14" stroke-linecap="round" filter="url(#glow-${id})"/>

    ${tens.map(p => {
      const a = toTickA(p);
      const isMajor = majors.has(p);
      const [x2, y2] = polar(rTicks + (isMajor ? 2 : 1), a);
      const [x1, y1] = polar(isMajor ? (rArc - 16) : (rArc - 10), a);
      const [lx, ly] = polar(rArc - 26, a);
      const lw = isMajor ? 3 : 2;
      const sc = isMajor ? '#e5e7eb' : '#9ca3af';
      return `<g>
        <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
              stroke="${sc}" stroke-width="${lw}" stroke-linecap="round"/>
        <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${COLORS.muted}" font-size="10"
              text-anchor="middle" dominant-baseline="central">${p}</text>
      </g>`;
    }).join('')}

    <g id="needle-${id}" data-angle="${initDeg}"
       style="transform-origin:${cx}px ${cy}px; transform:rotate(${initDeg}deg);
              transition:transform 600ms cubic-bezier(.2,.8,.2,1);">
      <polygon points="${cx - 5},${cy - 6} ${cx},${cy - needleLen} ${cx + 5},${cy - 6} ${cx},${cy + 22}"
               fill="${COLORS.needle}"/>
      <circle cx="${cx}" cy="${cy}" r="8" fill="#111827" stroke="${COLORS.needle}" stroke-width="2"/>
    </g>
  </svg>`;
}

function animateNumber(el, from, to, dur = 650) {
  const start = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);
  function step(now) {
    const p = Math.min(1, (now - start) / dur);
    const v = from + (to - from) * ease(p);
    el.textContent = v.toFixed(DECIMALS);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// =========================
// Cards (Overview grid)
// =========================
function makeCard(tf, idx) {
  const id = `g${idx}`;
  const el = document.createElement("div");
  el.className = "card pad";
  el.id = `card-${id}`;

  el.innerHTML = `
    <div class="row" style="margin-bottom:8px;">
      <div class="cardTitle">${tf.title}</div>
      <div class="muted" id="${id}-pill">—</div>
    </div>
    <div style="display:flex; justify-content:center; align-items:center; margin:6px 0 10px;">
      <div style="font-weight:900; font-size:44px; letter-spacing:.2px;" id="${id}-val">—</div>
    </div>
    <div id="${id}-svg"></div>
    <div class="row" style="margin-top:10px;">
      <div class="muted small">Fear</div>
      <div class="muted small">Greed</div>
    </div>
    <div class="muted small" id="${id}-upd" style="margin-top:8px;">—</div>
  `;

  $("grid")?.appendChild(el);

  // initial svg
  const host = $(id + "-svg");
  if (host) host.innerHTML = gaugeSVG(id, 50);
}

// =========================
// Risk computation (same logic as extension, no i18n here)
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
  return spread === 0 ? 0 :
         spread === 1 ? 15 :
         spread === 2 ? 35 :
         spread === 3 ? 60 : 80;
}

function impulseScore(v15, v1h, v4h) {
  const imp = Math.max(Math.abs(v15 - v1h), Math.abs(v15 - v4h));
  if (imp < 6)  return { I: 0 };
  if (imp < 12) return { I: 25 };
  if (imp < 18) return { I: 50 };
  if (imp < 25) return { I: 75 };
  return { I: 90 };
}

function computeRisk(values) {
  const v15 = values["15m"], v1 = values["1h"], v4 = values["4h"], vD = values["1d"];
  const w = { "15m": 0.15, "1h": 0.20, "4h": 0.30, "1d": 0.35 };
  const ext = (v) => Math.abs(v - 50) / 50;

  const E = 100 * (w["15m"] * ext(v15) + w["1h"] * ext(v1) + w["4h"] * ext(v4) + w["1d"] * ext(vD));

  const zones = [zoneIndex(v15), zoneIndex(v1), zoneIndex(v4), zoneIndex(vD)];
  const spread = Math.max(...zones) - Math.min(...zones);
  const D = spreadPenalty(spread);

  const impA = Math.abs(v15 - v1);
  const impB = Math.abs(v15 - v4);
  const { I } = impulseScore(v15, v1, v4);

  let risk = 0.55 * E + 0.30 * D + 0.15 * I;
  risk = Math.max(0, Math.min(100, risk));

  const level =
    risk < 30 ? { key: "LOW", cls: "risk-low" } :
    risk < 55 ? { key: "MEDIUM", cls: "risk-med" } :
    risk < 75 ? { key: "HIGH", cls: "risk-high" } :
                { key: "EXTREME", cls: "risk-ext" };

  const chips = [
    `E:${Math.round(E)}%`,
    `Spread:${spread}`,
    `15m↔1h:${impA.toFixed(1)}`,
    `15m↔4h:${impB.toFixed(1)}`
  ];

  return { risk, level, chips, E, spread, impA, impB };
}

function renderRisk(r) {
  $("riskLevel").textContent = r.level.key;
  $("riskScore").textContent = String(Math.round(r.risk));
  const fill = $("riskFill");
  if (fill) fill.style.width = `${Math.round(r.risk)}%`;

  const chipsEl = $("riskChips");
  if (chipsEl) {
    chipsEl.innerHTML = "";
    r.chips.forEach(c => {
      const el = document.createElement("div");
      el.textContent = c;
      chipsEl.appendChild(el);
    });
  }
}

function clearRisk() {
  $("riskLevel").textContent = "—";
  $("riskScore").textContent = "—";
  const fill = $("riskFill");
  if (fill) fill.style.width = "0%";
  const chipsEl = $("riskChips");
  if (chipsEl) chipsEl.innerHTML = "";
}

// =========================
// Details (market structure)
// =========================
function detailsClassByValue(v) {
  const st = stateFromValue(v);
  return (
    st === "extfear" ? "z-extfear" :
    st === "fear" ? "z-fear" :
    st === "neutral" ? "z-neutral" :
    st === "greed" ? "z-greed" :
    "z-extgreed"
  );
}

let detailsStylesInjected = false;
function ensureDetailsStyles() {
  if (detailsStylesInjected) return;
  detailsStylesInjected = true;

  const css = `
  #detailsBars{margin-top:10px}
  .d-wrap{display:flex;flex-direction:column;gap:12px}
  .d-section{padding:10px;border:1px solid rgba(234,236,239,.10);border-radius:14px;background:rgba(17,24,39,.25)}
  body.light .d-section{background:rgba(0,0,0,.04); border-color:rgba(0,0,0,.08)}
  .d-title{font-weight:900;font-size:12px;letter-spacing:.2px;margin-bottom:8px;opacity:.95}
  .d-row{display:flex;flex-direction:column;gap:6px;margin:10px 0}
  .d-rowtop{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
  .d-name{font-weight:800;font-size:12px;opacity:.92}
  .d-val{font-weight:900;font-size:12px;opacity:.95}
  .d-bar{position:relative;height:10px}
  .d-track{position:absolute;inset:0;border-radius:999px;background:linear-gradient(90deg,#ff3b30 0%,#fcd535 50%,#34c759 100%);opacity:.95;}
  .d-dot{position:absolute;top:50%;transform:translate(-50%,-50%);width:10px;height:10px;border-radius:999px;border:2px solid rgba(0,0,0,.45);box-shadow:0 0 0 2px rgba(255,255,255,.12);background:#EAECEF;}
  .d-sub{font-size:12px;opacity:.70}
  .z-extfear{color:rgb(220,38,38)}
  .z-fear{color:rgb(239,68,68)}
  .z-neutral{color:rgb(234,179,8)}
  .z-greed{color:rgb(34,197,94)}
  .z-extgreed{color:rgb(22,163,74)}
  `;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
}

function detailsBarRow(title, value, rightText) {
  const v = (typeof value === "number" && isFinite(value)) ? Math.max(0, Math.min(100, value)) : null;
  const cls = (v == null) ? "z-neutral" : detailsClassByValue(v);
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
  const v1  = state.values["1h"];
  const v4  = state.values["4h"];
  const vD  = state.values["1d"];

  const arr = [v15, v1, v4, vD].map(v => (typeof v === "number" && isFinite(v)) ? v : NaN);
  const okAll = arr.every(v => isFinite(v));

  if (!okAll) {
    host.innerHTML = `
      <div class="d-wrap">
        <div class="d-section">
          <div class="d-title">Market structure</div>
          <div class="d-sub">Waiting for market data...</div>
        </div>
      </div>
    `;
    return;
  }

  const minV = Math.min(...arr);
  const maxV = Math.max(...arr);
  const diff = maxV - minV; // TF spread
  const tilt = arr.reduce((a, b) => a + b, 0) / arr.length;
  const eValue = state.risk ? state.risk.E : 0;

  host.innerHTML = `
    <div class="d-wrap">
      <div class="d-section">
        <div class="d-title">Market structure</div>
        ${detailsBarRow("Market tilt", tilt, `${tilt.toFixed(1)} • ${zoneName(tilt)}`)}
        ${detailsBarRow("TF spread", diff, `${diff.toFixed(1)} • dispersion`)}
        ${detailsBarRow("Extremes (E)", eValue, `${Math.round(eValue)}% • distance from 50`)}
      </div>

      <div class="d-section">
        <div class="d-title">Timeframes</div>
        ${detailsBarRow("15m", v15, `${fmt(v15)} • ${zoneName(v15)}`)}
        ${detailsBarRow("1h",  v1,  `${fmt(v1)} • ${zoneName(v1)}`)}
        ${detailsBarRow("4h",  v4,  `${fmt(v4)} • ${zoneName(v4)}`)}
        ${detailsBarRow("1d",  vD,  `${fmt(vD)} • ${zoneName(vD)}`)}
      </div>
    </div>
  `;
}

// =========================
// Apply card updates
// =========================
function applyCard(tfKey, data, idx) {
  const id = `g${idx}`;
  const value = (typeof data?.value === "number" && isFinite(data.value)) ? data.value : null;

  const pill = $(`${id}-pill`);
  if (pill) pill.textContent = value == null ? "—" : labelFromValue(value);

  const num = $(`${id}-val`);
  if (num) {
    if (value == null) num.textContent = "—";
    else {
      const from = Number(String(num.textContent).replace(/[^0-9.\-]/g, "")) || 0;
      animateNumber(num, from, value, 650);
    }
  }

  const upd = $(`${id}-upd`);
  if (upd) {
    const d = data?.updatedAt ? new Date(data.updatedAt) : new Date();
    const tag = data?.__mock ? " (mock)" : "";
    upd.textContent = `Last updated: ${d.toLocaleString()}${tag}`;
  }

  // needle rotation
  const needle = document.querySelector(`#needle-${id}`);
  if (needle && value != null) {
    const targetDeg = toAngle(value);
    const prev = Number(needle.getAttribute("data-angle")) || targetDeg;
    needle.style.transform = `rotate(${prev}deg)`;
    requestAnimationFrame(() => {
      needle.style.transform = `rotate(${targetDeg}deg)`;
      needle.setAttribute("data-angle", String(targetDeg));
    });
  }
}

// =========================
// Refresh flow
// =========================
function scheduleRefresh(reason) {
  if (auto.debounceTimer) clearTimeout(auto.debounceTimer);
  auto.debounceTimer = setTimeout(() => {
    refresh(reason);
  }, DEBOUNCE_MS);
}

async function refresh(reason = "manual") {
  if (auto.refreshInFlight) {
    auto.refreshQueued = true;
    return;
  }

  auto.refreshInFlight = true;
  auto.refreshQueued = false;

  try {
    setErr("");

    const symInp = $("sym");
    const symbol = (symInp?.value || "").trim().toUpperCase();

    if (!symbol) {
      setErr("Enter a symbol (e.g., BTCUSDT).");
      state.values = { "15m": null, "1h": null, "4h": null, "1d": null };
      state.risk = null;
      clearRisk();
      renderDetails();
      return;
    }

    // mount cards once
    if (!state.mounted) {
      const grid = $("grid");
      if (grid) grid.innerHTML = "";
      TFS.forEach((tf, i) => makeCard(tf, i));
      state.mounted = true;
    }

    const results = await Promise.all(
      TFS.map(async (tf) => {
        try {
          const d = await fetchFNG(symbol, tf.key);
          return { tf: tf.key, ok: true, d };
        } catch (e) {
          return { tf: tf.key, ok: false, error: String(e?.message || e) };
        }
      })
    );

    // apply cards + fill values
    const values = { "15m": null, "1h": null, "4h": null, "1d": null };

    results.forEach((r, idx) => {
      applyCard(r.tf, r.ok ? r.d : null, idx);
      if (r.ok && typeof r.d?.value === "number") values[r.tf] = r.d.value;
    });

    state.values = values;

    const okAll = Object.values(values).every(v => v != null);
    if (okAll) {
      state.risk = computeRisk(values);
      renderRisk(state.risk);
    } else {
      state.risk = null;
      clearRisk();
    }

    renderDetails();

    const errors = results.filter(x => !x.ok);
    if (errors.length && reason !== "poll") {
      setErr(errors.map(x => `${x.tf}: ${x.error}`).join(" | "));
    }
  } finally {
    auto.refreshInFlight = false;
    if (auto.refreshQueued) {
      auto.refreshQueued = false;
      scheduleRefresh("queued");
    }
  }
}

// =========================
// Auto-refresh timers
// =========================
function restartPeriodic() {
  if (auto.periodicTimer) {
    clearInterval(auto.periodicTimer);
    auto.periodicTimer = null;
  }
  if (!auto.enabled) return;

  auto.periodicTimer = setInterval(() => {
    refresh("periodic");
  }, auto.intervalSec * 1000);
}

function startAutoEngines() {
  stopAutoEngines();

  // lightweight poll just to keep UI fresh if user changes symbol quickly
  auto.pollTimer = setInterval(() => {
    // do nothing heavy if disabled
    if (auto.enabled) {
      // If user is on Overview/Details, update in background
      refresh("poll");
    }
  }, AUTO_POLL_MS);

  restartPeriodic();
}

function stopAutoEngines() {
  if (auto.debounceTimer) { clearTimeout(auto.debounceTimer); auto.debounceTimer = null; }
  if (auto.pollTimer) { clearInterval(auto.pollTimer); auto.pollTimer = null; }
  if (auto.periodicTimer) { clearInterval(auto.periodicTimer); auto.periodicTimer = null; }
}

// =========================
// Init
// =========================
function initDomReady() {
  initTabs();
  initTheme();

  loadSettings();
  syncSettingsUI();
  bindSettingsUI();

  $("refreshBtn")?.addEventListener("click", () => refresh("manual"));

  // Enter to refresh
  $("sym")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") refresh("enter");
  });

  // initial API + UI
  pingApi();
  setInterval(pingApi, 60_000);

  // initial render
  refresh("init");

  // start auto if enabled
  startAutoEngines();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDomReady);
} else {
  initDomReady();
}
