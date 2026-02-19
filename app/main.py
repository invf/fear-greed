# app/main.py
# pip install -U pandas numpy ta fastapi uvicorn httpx supabase
import math
import os
from typing import Optional

import httpx
import numpy as np
import pandas as pd
from ta.momentum import RSIIndicator

from fastapi import FastAPI, Query, HTTPException, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

from datetime import datetime, timezone
from supabase import create_client, Client


# =========================
# APP
# =========================
app = FastAPI(title="Custom Fear & Greed Index")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # prod: set your extension origin(s)
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# SUPABASE
# =========================
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# =========================
# CONSTS
# =========================
BINANCE_SPOT = "https://api.binance.com"
BINANCE_FAPI = "https://fapi.binance.com"  # USDT-M Futures
VALID_TF = {"15m", "1h", "4h", "1d"}


# =========================
# UTILS
# =========================
def ts_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def percentile(series_or_array, x) -> float:
    """Percentile: share of values <= x."""
    arr = np.asarray(series_or_array, dtype=float)
    if arr.size == 0:
        return 0.5
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return 0.5
    return float(np.mean(arr <= x))


def tf_to_oi_period(tf: str) -> str:
    """Binance OI period options: 5m,15m,30m,1h,2h,4h,6h,12h,1d"""
    return {"15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d"}[tf]


def _sb_data(x):
    """Supabase python client sometimes returns list or dict."""
    if x is None:
        return None
    if isinstance(x, list):
        return x[0] if x else None
    return x


# =========================
# SUPABASE GATING HELPERS
# =========================
def validate_api_key_with_supabase(api_key: str) -> dict:
    """
    Calls RPC validate_api_key(p_key text) and returns normalized dict:
      { valid: bool, plan: "FREE"/"PRO"/"VIP"/..., status: "...", ... }
    """
    if not supabase:
        # backend not configured -> treat as free (or raise, your call)
        return {"valid": False, "plan": "FREE", "status": "supabase_not_configured"}

    api_key = (api_key or "").strip()
    if not api_key:
        return {"valid": False, "plan": "FREE", "status": "missing"}

    res = supabase.rpc("validate_api_key", {"p_key": api_key}).execute()
    data = _sb_data(res.data)

    if not data:
        return {"valid": False, "plan": "FREE", "status": "invalid"}

    # If your RPC already returns {valid, plan, status}, just pass through.
    # Otherwise normalize minimal fields:
    if "valid" not in data:
        data["valid"] = True
    if "plan" not in data:
        data["plan"] = "PRO"
    if "status" not in data:
        data["status"] = "ok"
    return data


def consume_pair_access_or_raise(install_id: str, api_key: str, symbol: str):
    """
    Calls RPC consume_pair_access(...) and raises 402 if not ok.
    Expected RPC return example:
      { ok: true, plan: "FREE", remaining: 9, reset_at: "...", ... }
    """
    if not supabase:
        return  # if you want strict behavior: raise HTTPException(500,...)

    res = supabase.rpc(
        "consume_pair_access",
        {
            "p_install_id": (install_id or "").strip(),
            "p_api_key": (api_key or "").strip(),
            "p_symbol": (symbol or "").strip(),
        },
    ).execute()

    data = _sb_data(res.data) or {}
    if not data.get("ok", False):
        raise HTTPException(status_code=402, detail=data)


# =========================
# DATA FETCHERS
# =========================
def klines(symbol="SOLUSDT", interval="1d", limit=500) -> pd.DataFrame:
    """Spot klines (price + volume)."""
    params = {"symbol": symbol, "interval": interval, "limit": min(limit, 1000)}
    with httpx.Client(timeout=20) as client:
        r = client.get(f"{BINANCE_SPOT}/api/v3/klines", params=params)
        r.raise_for_status()
        rows = r.json()

    df = pd.DataFrame(
        rows,
        columns=["t", "o", "h", "l", "c", "v", "ct", "qv", "n", "tbb", "tbq", "i"],
    )
    df["t"] = pd.to_datetime(df["t"], unit="ms", utc=True)
    df["ct"] = pd.to_datetime(df["ct"], unit="ms", utc=True)
    for col in ["o", "h", "l", "c", "v", "qv", "tbb", "tbq"]:
        df[col] = df[col].astype(float)

    df["ret"] = np.log(df["c"]).diff()
    return df


def get_funding_now(symbol="SOLUSDT") -> float:
    """Latest funding rate (USDT-M Futures)."""
    with httpx.Client(timeout=15) as client:
        r = client.get(f"{BINANCE_FAPI}/fapi/v1/premiumIndex", params={"symbol": symbol})
        r.raise_for_status()
        data = r.json()
    return float(data.get("lastFundingRate", 0.0))


def get_funding_hist(symbol="SOLUSDT", limit=500) -> np.ndarray:
    with httpx.Client(timeout=20) as client:
        r = client.get(
            f"{BINANCE_FAPI}/fapi/v1/fundingRate",
            params={"symbol": symbol, "limit": min(limit, 1000)},
        )
        r.raise_for_status()
        arr = r.json()
    return np.array([float(x["fundingRate"]) for x in arr], dtype=float)


def get_oi_hist(symbol="SOLUSDT", period="1d", limit=200) -> pd.DataFrame:
    """Open Interest history (USDT-M Futures)."""
    with httpx.Client(timeout=20) as client:
        r = client.get(
            f"{BINANCE_FAPI}/futures/data/openInterestHist",
            params={"symbol": symbol, "period": period, "limit": min(limit, 500)},
        )
        r.raise_for_status()
        arr = r.json()

    if isinstance(arr, dict) and "code" in arr:
        raise RuntimeError(f"Binance OI error: {arr}")

    df = pd.DataFrame(arr)
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    for col in ("sumOpenInterest", "sumOpenInterestValue"):
        df[col] = df[col].astype(float)
    return df


# =========================
# SCORES
# =========================
def compute_base_scores(df: pd.DataFrame) -> dict:
    """RSI / Momentum / Volatility / Volume anomaly"""
    rsi_series = RSIIndicator(df["c"], window=14).rsi()
    rsi = float(rsi_series.iloc[-1])
    score_rsi = float(np.clip((rsi - 30.0) / 40.0 * 100.0, 0, 100))

    rets = df["ret"].dropna()
    r1 = float(rets.iloc[-1])
    p_mom = percentile(rets, r1)
    score_mom = p_mom * 100.0

    vol_hist = rets.rolling(30).std().dropna()
    cur_vol = float(vol_hist.iloc[-1]) if len(vol_hist) else 0.0
    p_vol = percentile(vol_hist[-180:], cur_vol) if len(vol_hist) else 0.5
    score_vol = (1.0 - p_vol) * 100.0
    score_volx = 0.5 * score_vol + 0.5 * (100.0 - score_vol if r1 < 0 else score_vol)

    vol_mult = df["v"] / df["v"].rolling(30).median()
    vm_hist = vol_mult.dropna()
    cur_vm = float(vm_hist.iloc[-1]) if len(vm_hist) else 1.0
    score_volm = percentile(vm_hist, cur_vm) * 100.0

    return {
        "rsi": score_rsi,
        "mom": score_mom,
        "vol": score_volx,
        "volm": score_volm,
        "rsi_raw": rsi,
        "ret_last": r1,
        "vol_cur": cur_vol,
        "vol_mult_cur": cur_vm,
    }


def compute_funding_score(symbol="SOLUSDT") -> tuple[float, float, float]:
    cur = get_funding_now(symbol)
    hist = get_funding_hist(symbol, limit=500)
    p = percentile(hist, cur) if hist.size else 0.5
    score = p * 100.0
    return float(score), float(cur), float(p)


def compute_oi_score(symbol="SOLUSDT", tf="1d") -> dict:
    period = tf_to_oi_period(tf)
    df = get_oi_hist(symbol, period=period, limit=200)
    if df.empty:
        return {"oi": 50.0, "oi_delta": 50.0, "oi_cur": 0.0}

    oi = df["sumOpenInterest"].astype(float)
    oi_cur = float(oi.iloc[-1])
    p_oi = percentile(oi, oi_cur)

    med = float(oi.rolling(30, min_periods=5).median().iloc[-1])
    d_rel = (oi_cur - med) / med if med > 0 else 0.0

    d_hist = ((oi - oi.shift(1)) / oi.shift(1)).dropna()
    p_delta = percentile(d_hist, d_rel) if len(d_hist) else 0.5

    score_oi = p_oi * 100.0
    score_oid = p_delta * 100.0
    score_oi_mix = 0.6 * score_oi + 0.4 * score_oid

    return {
        "oi": float(score_oi_mix),
        "oi_cur": oi_cur,
        "oi_p": float(p_oi),
        "oi_delta": float(score_oid),
        "oi_delta_val": float(d_rel),
        "oi_delta_p": float(p_delta),
    }


# =========================
# MAIN INDEX
# =========================
def compute_fng(symbol="SOLUSDT", tf="1d") -> tuple[float, str, dict]:
    df = klines(symbol=symbol, interval=tf, limit=500)
    base = compute_base_scores(df)

    try:
        score_funding, funding_cur, funding_p = compute_funding_score(symbol)
    except Exception:
        score_funding, funding_cur, funding_p = 50.0, 0.0, 0.5

    try:
        oi_pack = compute_oi_score(symbol, tf=tf)
        score_oi = oi_pack["oi"]
    except Exception:
        oi_pack = {
            "oi": 50.0,
            "oi_cur": 0.0,
            "oi_p": 0.5,
            "oi_delta": 50.0,
            "oi_delta_val": 0.0,
            "oi_delta_p": 0.5,
        }
        score_oi = 50.0

    w = {"rsi": 0.25, "mom": 0.20, "vol": 0.15, "volm": 0.15, "funding": 0.15, "oi": 0.10}

    fng = (
        w["rsi"] * base["rsi"]
        + w["mom"] * base["mom"]
        + w["vol"] * base["vol"]
        + w["volm"] * base["volm"]
        + w["funding"] * score_funding
        + w["oi"] * score_oi
    )
    fng = float(np.clip(fng, 0, 100))

    label = (
        "Extreme Fear" if fng < 25 else
        "Fear"         if fng < 45 else
        "Neutral"      if fng <= 55 else
        "Greed"        if fng < 76 else
        "Extreme Greed"
    )

    components = {
        "scores": {
            "rsi": base["rsi"],
            "mom": base["mom"],
            "vol": base["vol"],
            "volm": base["volm"],
            "funding": score_funding,
            "oi": score_oi,
        },
        "raw": {
            "rsi_raw": base["rsi_raw"],
            "ret_last": base["ret_last"],
            "vol_cur": base["vol_cur"],
            "vol_mult_cur": base["vol_mult_cur"],
            "funding_now": funding_cur,
            "funding_p": funding_p,
            **oi_pack,
        },
        "weights": w,
    }
    return fng, label, components


# =========================
# SVG QUAD GAUGES (optional)
# =========================
def make_gauge(cx, cy, r, value, label, tf):
    angle = 180 - (value / 100) * 180
    radians = math.radians(angle)
    x = cx + r * math.cos(radians)
    y = cy - r * math.sin(radians)

    return f"""
    <g>
      <path d="M{cx - r} {cy} A{r} {r} 0 0 1 {cx + r} {cy}"
            fill="none" stroke="lightgray" stroke-width="12"/>
      <path d="M{cx - r} {cy} A{r} {r} 0 0 1 {cx + r} {cy}"
            fill="none" stroke="url(#grad)" stroke-width="12"/>
      <line x1="{cx}" y1="{cy}" x2="{x}" y2="{y}" stroke="black" stroke-width="5"/>
      <circle cx="{cx}" cy="{cy}" r="6" fill="black"/>
      <text x="{cx}" y="{cy - 60}" font-size="38" text-anchor="middle" fill="black">{value:.1f}</text>
      <text x="{cx}" y="{cy - 140}" font-size="22" text-anchor="middle" fill="black">{label}</text>
      <text x="{cx}" y="{cy + 40}" font-size="22" fill="gray" text-anchor="middle">{tf}</text>
    </g>
    """


@app.get("/api/fng/quad")
async def fng_quad(symbol: str = "BTCUSDT"):
    tfs = ["15m", "1h", "4h", "1d"]
    values = {}

    async with httpx.AsyncClient(timeout=10.0) as client:
        # call local endpoints (same app) by direct compute to avoid internal http
        for tf in tfs:
            try:
                v, lbl, _ = compute_fng(symbol=symbol, tf=tf)
                values[tf] = {"value": float(v), "label": lbl}
            except Exception:
                values[tf] = {"value": 50.0, "label": "Neutral"}

    svg = f"""
    <svg width="800" height="800" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad">
          <stop offset="0%" stop-color="red"/>
          <stop offset="50%" stop-color="yellow"/>
          <stop offset="100%" stop-color="green"/>
        </linearGradient>
      </defs>
      {make_gauge(250, 250, 120, values["15m"]["value"], values["15m"]["label"], "15m")}
      {make_gauge(550, 250, 120, values["1h"]["value"], values["1h"]["label"], "1h")}
      {make_gauge(250, 600, 120, values["4h"]["value"], values["4h"]["label"], "4h")}
      {make_gauge(550, 600, 120, values["1d"]["value"], values["1d"]["label"], "1d")}
    </svg>
    """
    return Response(content=svg, media_type="image/svg+xml")


# =========================
# ROUTES
# =========================
@app.get("/", response_class=HTMLResponse)
def root():
    return """
    <h1>Custom Fear & Greed Index</h1>
    <p>Try: <a href="/api/fng?symbol=SOLUSDT&tf=1d">/api/fng?symbol=SOLUSDT&tf=1d</a></p>
    <p>Validate key: <a href="/docs">/docs</a> then GET /api/validate-key with X-Api-Key</p>
    """


@app.get("/health")
def health():
    return JSONResponse({"ok": True, "time": ts_iso_now()})


@app.get("/api/validate-key")
def validate_key(request: Request):
    """
    Reads X-Api-Key header and validates via Supabase RPC validate_api_key(p_key text)
    """
    api_key = (request.headers.get("X-Api-Key") or "").strip()
    try:
        data = validate_api_key_with_supabase(api_key)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/fng")
def fng(
    request: Request,
    symbol: str = Query("SOLUSDT", description="Binance symbol, e.g. SOLUSDT"),
    tf: str = Query("1d", description="15m | 1h | 4h | 1d"),
):
    if tf not in VALID_TF:
        return JSONResponse({"error": f"Invalid tf={tf}. Allowed: {sorted(VALID_TF)}"}, status_code=400)

    # ---- GATE (pair access)
    install_id = (request.headers.get("X-Install-Id") or "").strip()
    api_key = (request.headers.get("X-Api-Key") or "").strip()

    # If you want to force install_id always:
    if not install_id:
        raise HTTPException(status_code=400, detail="Missing X-Install-Id")

    try:
        consume_pair_access_or_raise(install_id=install_id, api_key=api_key, symbol=symbol)
    except HTTPException:
        raise
    except Exception as e:
        # Supabase not configured or RPC error
        raise HTTPException(status_code=500, detail=str(e))

    # ---- Compute
    try:
        value, label, comps = compute_fng(symbol=symbol, tf=tf)
        return {
            "coin": symbol,
            "tf": tf,
            "value": round(value, 1),
            "label": label,
            "components": {
                "rsi": round(comps["scores"]["rsi"], 2),
                "mom": round(comps["scores"]["mom"], 2),
                "vol": round(comps["scores"]["vol"], 2),
                "volm": round(comps["scores"]["volm"], 2),
                "funding": round(comps["scores"]["funding"], 2),
                "oi": round(comps["scores"]["oi"], 2),
            },
            "updatedAt": ts_iso_now(),
        }
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/fng-components")
def fng_components(
    request: Request,
    symbol: str = Query("SOLUSDT", description="Binance symbol, e.g. SOLUSDT"),
    tf: str = Query("1d", description="15m | 1h | 4h | 1d"),
):
    if tf not in VALID_TF:
        return JSONResponse({"error": f"Invalid tf={tf}. Allowed: {sorted(VALID_TF)}"}, status_code=400)

    # Gate here too (so components isn't a bypass)
    install_id = (request.headers.get("X-Install-Id") or "").strip()
    api_key = (request.headers.get("X-Api-Key") or "").strip()
    if not install_id:
        raise HTTPException(status_code=400, detail="Missing X-Install-Id")
    try:
        consume_pair_access_or_raise(install_id=install_id, api_key=api_key, symbol=symbol)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    try:
        value, label, comps = compute_fng(symbol=symbol, tf=tf)
        return {
            "coin": symbol,
            "tf": tf,
            "value": round(value, 1),
            "label": label,
            "weights": comps["weights"],
            "scores": comps["scores"],
            "raw": comps["raw"],
            "updatedAt": ts_iso_now(),
        }
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
