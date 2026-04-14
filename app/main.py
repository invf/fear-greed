import json
import math
import os
import secrets
import time
import threading
from typing import Tuple
from decimal import Decimal
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, Tuple

from dotenv import load_dotenv
load_dotenv()

import httpx
import numpy as np
import pandas as pd
from ta.momentum import RSIIndicator
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from supabase import create_client, Client
from web3 import Web3
from web3._utils.events import get_event_data
from pydantic import BaseModel, Field
from openai import OpenAI

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is not set")

client = OpenAI(api_key=OPENAI_API_KEY)


# ============================================================
# APP
# ============================================================
app = FastAPI(title="Custom Fear & Greed Index")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # prod: set your site + extension origin(s)
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# HTTP CLIENT (GLOBAL)  ✅ IMPORTANT
# ============================================================
HTTP_TIMEOUT = httpx.Timeout(20.0, connect=10.0)
HTTP_LIMITS = httpx.Limits(max_connections=25, max_keepalive_connections=15)
HTTP_CLIENT = httpx.Client(
    timeout=HTTP_TIMEOUT,
    limits=HTTP_LIMITS,
    headers={"User-Agent": "fear-greed/1.0"},
    follow_redirects=True,
)

# ============================================================
# SUPABASE
# ============================================================
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# ============================================================
# CONSTS (FNG)
# ============================================================
BINANCE_SPOT = "https://api.binance.com"
BINANCE_FAPI = "https://fapi.binance.com"  # USDT-M Futures
VALID_TF = {"15m", "1h", "4h", "1d"}

# ============================================================
# SIMPLE IN-MEMORY TTL CACHE (per worker)
# ============================================================
# NOTE: This cache lives per-process (per gunicorn worker).
# It's still extremely effective because each worker will stop recomputing the same symbol/tf many times per second.
FNG_CACHE_TTL_SEC = int(os.getenv("FNG_CACHE_TTL_SEC", "30"))

_fng_cache_lock = threading.Lock()
_fng_cache: dict[Tuple[str, str], dict] = {}
_fng_cache_exp: dict[Tuple[str, str], float] = {}


def _cache_get(key: Tuple[str, str]) -> Optional[dict]:
    now_ts = datetime.now(timezone.utc).timestamp()
    with _fng_cache_lock:
        exp = _fng_cache_exp.get(key)
        if not exp or exp < now_ts:
            # expired or missing
            _fng_cache.pop(key, None)
            _fng_cache_exp.pop(key, None)
            return None
        return _fng_cache.get(key)


def _cache_set(key: Tuple[str, str], value: dict, ttl: int = FNG_CACHE_TTL_SEC) -> None:
    now_ts = datetime.now(timezone.utc).timestamp()
    with _fng_cache_lock:
        _fng_cache[key] = value
        _fng_cache_exp[key] = now_ts + max(1, int(ttl))

# ============================================================
# PAYMENTS (BSC USDT)
# ============================================================
RECEIVE_WALLET = os.getenv("RECEIVE_WALLET", "")
RPC_56 = os.getenv("RPC_56", "")  # BSC
USDT_56 = os.getenv("USDT_56", "0x55d398326f99059fF775485246999027B3197955")  # default BSC USDT

SUPPORTED_CHAINS = {56}

ERC20_TRANSFER_ABI = {
    "anonymous": False,
    "inputs": [
        {"indexed": True, "name": "from", "type": "address"},
        {"indexed": True, "name": "to", "type": "address"},
        {"indexed": False, "name": "value", "type": "uint256"},
    ],
    "name": "Transfer",
    "type": "event",
}

TRANSFER_TOPIC = Web3.keccak(text="Transfer(address,address,uint256)").hex()


def _w3(chain_id: int) -> Web3:
    if chain_id == 56 and RPC_56 and RPC_56.startswith(("http://", "https://")):
        return Web3(Web3.HTTPProvider(RPC_56))
    raise HTTPException(status_code=400, detail=f"Unsupported chain_id={chain_id} or missing/invalid RPC_56 env")


def _usdt_address(chain_id: int) -> str:
    if chain_id == 56:
        return Web3.to_checksum_address(USDT_56)
    raise HTTPException(status_code=400, detail=f"Missing USDT env for chain_id={chain_id}")


def _usdt_decimals(chain_id: int) -> int:
    if chain_id == 56:
        return 18
    return 6


def _receive_wallet() -> str:
    if not RECEIVE_WALLET:
        raise HTTPException(status_code=500, detail="RECEIVE_WALLET env is missing")
    return Web3.to_checksum_address(RECEIVE_WALLET)


def _gen_api_key() -> str:
    return "fg_" + secrets.token_urlsafe(32)


def ts_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sb_data(x):
    if x is None:
        return None
    if isinstance(x, list):
        return x[0] if x else None
    return x


# ============================================================
# RETRY HELPERS (Supabase/Network)
# ============================================================
def _with_retry(fn, tries: int = 3, base_delay: float = 0.25):
    last = None
    for i in range(tries):
        try:
            return fn()
        except (httpx.ReadError, httpx.ConnectError, httpx.TimeoutException) as e:
            last = e
            time.sleep(base_delay * (i + 1))
    raise last


def _supabase_call(fn, tries: int = 3):
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    try:
        return _with_retry(fn, tries=tries, base_delay=0.35)
    except (httpx.ReadError, httpx.ConnectError, httpx.TimeoutException) as e:
        # IMPORTANT: return 503, not 500 (so extension doesn't "crash")
        raise HTTPException(
            status_code=503,
            detail={"ok": False, "error": "supabase_unavailable", "message": str(e)},
        )


# ============================================================
# SUBSCRIPTIONS helpers (expiry -> effective plan) + CACHE
# ============================================================
def _parse_iso_dt(x: Any) -> Optional[datetime]:
    if not x:
        return None
    try:
        s = str(x)
        if s.endswith("Z"):
            s = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


# caches (in-memory per Render instance)
_APIKEY_TO_UID: Dict[str, Tuple[float, Optional[str]]] = {}
_UID_TO_SUBMETA: Dict[str, Tuple[float, Dict[str, Any]]] = {}

CACHE_TTL_UID = 60   # seconds
CACHE_TTL_SUB = 30   # seconds


def resolve_user_id_from_api_key(api_key: str) -> Optional[str]:
    if not supabase:
        return None

    k = (api_key or "").strip()
    if not k:
        return None

    now_ts = time.time()
    hit = _APIKEY_TO_UID.get(k)
    if hit and (now_ts - hit[0]) < CACHE_TTL_UID:
        return hit[1]

    def _do():
        return (
            supabase.table("api_keys")
            .select("user_id")
            .eq("api_key", k)
            .eq("revoked", False)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )

    res = _supabase_call(_do)
    row = _sb_data(res.data)
    uid = row.get("user_id") if row else None
    _APIKEY_TO_UID[k] = (now_ts, uid)
    return uid


def get_subscription_meta(user_id: Optional[str]) -> Dict[str, Any]:
    if not supabase or not user_id:
        return {
            "plan_db": "FREE",
            "status": "none",
            "expires_at": None,
            "active": False,
            "days_left": None,
            "will_expire_soon": False,
        }

    now_ts = time.time()
    hit = _UID_TO_SUBMETA.get(user_id)
    if hit and (now_ts - hit[0]) < CACHE_TTL_SUB:
        return hit[1]

    def _do():
        return (
            supabase.table("subscriptions")
            .select("plan,status,expires_at")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )

    res = _supabase_call(_do)
    sub = _sb_data(res.data)

    if not sub:
        meta = {
            "plan_db": "FREE",
            "status": "none",
            "expires_at": None,
            "active": False,
            "days_left": None,
            "will_expire_soon": False,
        }
        _UID_TO_SUBMETA[user_id] = (now_ts, meta)
        return meta

    plan_db = str(sub.get("plan") or "FREE").upper()
    status = str(sub.get("status") or "active").lower()
    exp_dt = _parse_iso_dt(sub.get("expires_at"))

    now = datetime.now(timezone.utc)
    active = (status == "active") and (exp_dt is not None) and (exp_dt > now)

    days_left = None
    will_expire_soon = False
    if exp_dt is not None:
        seconds_left = (exp_dt - now).total_seconds()
        days_left = int((seconds_left + 86399) // 86400)  # ceil days
        will_expire_soon = (0 < days_left <= 3)

    meta = {
        "plan_db": plan_db,
        "status": status,
        "expires_at": exp_dt.isoformat() if exp_dt else None,
        "active": bool(active),
        "days_left": days_left,
        "will_expire_soon": bool(will_expire_soon),
    }

    _UID_TO_SUBMETA[user_id] = (now_ts, meta)
    return meta


def effective_plan_from_meta(meta: Dict[str, Any]) -> str:
    if meta.get("active"):
        return str(meta.get("plan_db") or "FREE").upper()
    return "FREE"


# ============================================================
# USERS helper: map wallet -> users.id
# ============================================================
def get_or_create_user_by_wallet(wallet: str) -> str:
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    if not wallet or not isinstance(wallet, str) or not wallet.startswith("0x"):
        raise HTTPException(status_code=400, detail="Invalid wallet address")

    wallet_norm = wallet.strip().lower()

    def _sel():
        return (
            supabase.table("users")
            .select("id,wallet_address")
            .eq("wallet_address", wallet_norm)
            .limit(1)
            .execute()
        )

    q = _supabase_call(_sel)
    row = _sb_data(q.data)
    if row and row.get("id"):
        return row["id"]

    def _ins():
        return supabase.table("users").insert({"wallet_address": wallet_norm}).execute()

    ins = _supabase_call(_ins)
    new_row = _sb_data(ins.data)
    if not new_row or not new_row.get("id"):
        raise HTTPException(status_code=500, detail="Failed to create user for wallet")
    return new_row["id"]


# ============================================================
# SUPABASE gating helpers
# ============================================================
def consume_pair_access_or_raise(install_id: str, api_key: str, symbol: str) -> dict:
    if not supabase:
        return {
            "ok": True,
            "valid": False,
            "plan": "FREE",
            "limit": None,
            "used": None,
            "remaining": None,
            "status": "supabase_not_configured",
        }

    def _do():
        return supabase.rpc(
            "consume_pair_access",
            {
                "p_install_id": (install_id or "").strip(),
                "p_api_key": (api_key or "").strip(),
                "p_symbol": (symbol or "").strip(),
            },
        ).execute()

    res = _supabase_call(_do)
    data = _sb_data(res.data) or {}
    if not isinstance(data, dict):
        data = {"ok": False, "status": "bad_rpc_payload", "raw": data}

    if not data.get("ok", False):
        raise HTTPException(status_code=402, detail=data)

    return data


# ============================================================
# DATA FETCHERS (FNG)  ✅ uses global HTTP_CLIENT
# ============================================================
def klines(symbol="SOLUSDT", interval="1d", limit=500) -> pd.DataFrame:
    params = {"symbol": symbol, "interval": interval, "limit": min(limit, 1000)}
    r = HTTP_CLIENT.get(f"{BINANCE_SPOT}/api/v3/klines", params=params)
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
    r = HTTP_CLIENT.get(f"{BINANCE_FAPI}/fapi/v1/premiumIndex", params={"symbol": symbol})
    r.raise_for_status()
    data = r.json()
    return float(data.get("lastFundingRate", 0.0))


def get_funding_hist(symbol="SOLUSDT", limit=500) -> np.ndarray:
    r = HTTP_CLIENT.get(
        f"{BINANCE_FAPI}/fapi/v1/fundingRate",
        params={"symbol": symbol, "limit": min(limit, 1000)},
    )
    r.raise_for_status()
    arr = r.json()
    return np.array([float(x["fundingRate"]) for x in arr], dtype=float)


def get_oi_hist(symbol="SOLUSDT", period="1d", limit=200) -> pd.DataFrame:
    r = HTTP_CLIENT.get(
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


def percentile(series_or_array, x) -> float:
    arr = np.asarray(series_or_array, dtype=float)
    if arr.size == 0:
        return 0.5
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return 0.5
    return float(np.mean(arr <= x))


def tf_to_oi_period(tf: str) -> str:
    return {"15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d"}[tf]


# ============================================================
# SCORES (FNG)
# ============================================================
def compute_base_scores(df: pd.DataFrame) -> dict:
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


# ============================================================
# MAIN INDEX (FNG)
# ============================================================
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
#++++++++++++++++++++++++++++++++++++++++++++++
#GPT STORE
#++++++++++++++++++++++++++++++++++++++++++++++

# ============================================================
# GPT HELPERS
# ============================================================
GPT_ALLOWED_TF = ["15m", "1h", "4h", "1d"]
GPT_MAX_PAIRS = 4


def risk_label(score: float) -> str:
    if score <= 25:
        return "Low"
    elif score <= 50:
        return "Moderate"
    elif score <= 75:
        return "Elevated"
    return "High"


def derive_risk_score(tf_values: list[float]) -> int:
    if not tf_values:
        return 50

    arr = np.array(tf_values, dtype=float)
    avg = float(arr.mean())
    spread = float(arr.max() - arr.min())
    std = float(arr.std())

    # distance from neutral
    directional_stretch = abs(avg - 50.0) * 2.8

    # disagreement between timeframes
    tf_instability = spread * 1.4 + std * 1.8

    # penalty for extreme zones
    extreme_penalty = 0.0
    if avg < 30 or avg > 70:
        extreme_penalty = 16.0
    elif avg < 40 or avg > 60:
        extreme_penalty = 8.0

    risk = directional_stretch * 0.35 + tf_instability * 0.50 + extreme_penalty
    return int(np.clip(round(risk), 0, 100))


def summarize_sentiment(avg: float) -> str:
    if avg < 25:
        return "Extreme Fear"
    elif avg < 45:
        return "Fear"
    elif avg <= 55:
        return "Neutral"
    elif avg < 76:
        return "Greed"
    return "Extreme Greed"


def build_pair_summary(symbol: str, avg: float, risk: int) -> str:
    if avg < 25:
        mood = "Panic-like conditions, possible oversold pressure."
    elif avg < 45:
        mood = "Weak sentiment with cautious market behavior."
    elif avg <= 55:
        mood = "Mixed market tone without strong directional conviction."
    elif avg < 76:
        mood = "Bullish sentiment with constructive momentum."
    else:
        mood = "Overheated sentiment with elevated reversal risk."

    if risk <= 25:
        suffix = "Structure remains relatively controlled."
    elif risk <= 50:
        suffix = "Some volatility risk is present."
    elif risk <= 75:
        suffix = "Conditions are more unstable than usual."
    else:
        suffix = "This setup is emotionally stretched and higher risk."

    return f"{mood} {suffix}"

# ============================================================
# ROUTES
# ============================================================
@app.get("/", response_class=HTMLResponse)
def root():
    return """
    <h1>Custom Fear & Greed Index</h1>
    <p>Try: <a href="/api/fng?symbol=SOLUSDT&tf=1d">/api/fng?symbol=SOLUSDT&tf=1d</a></p>
    <p>Validate key: GET /api/validate-key with X-Api-Key</p>
    <p>Checkout: POST /api/checkout/create, POST /api/checkout/confirm</p>
    """


@app.get("/health")
def health():
    return JSONResponse({"ok": True, "time": ts_iso_now()})


@app.get("/api/validate-key")
def validate_key(request: Request):
    api_key = (request.headers.get("X-Api-Key") or "").strip()
    if not api_key:
        return {
            "valid": False,
            "plan": "FREE",
            "status": "missing",
            "expires_at": None,
            "days_left": None,
            "will_expire_soon": False,
        }

    user_id = resolve_user_id_from_api_key(api_key)
    if not user_id:
        return {
            "valid": False,
            "plan": "FREE",
            "status": "invalid",
            "expires_at": None,
            "days_left": None,
            "will_expire_soon": False,
        }

    meta = get_subscription_meta(user_id)
    plan_effective = effective_plan_from_meta(meta)

    return {
        "valid": True,
        "plan": plan_effective,
        "status": "ok",
        "expires_at": meta.get("expires_at"),
        "days_left": meta.get("days_left"),
        "will_expire_soon": meta.get("will_expire_soon"),
        "subscription_status": meta.get("status"),
        "plan_db": meta.get("plan_db"),
    }


@app.get("/api/fng")
def fng(
    request: Request,
    symbol: str = Query("SOLUSDT", description="Binance symbol, e.g. SOLUSDT"),
    tf: str = Query("1d", description="15m | 1h | 4h | 1d"),
):
    if tf not in VALID_TF:
        return JSONResponse({"error": f"Invalid tf={tf}. Allowed: {sorted(VALID_TF)}"}, status_code=400)

    install_id = (request.headers.get("X-Install-Id") or "").strip()
    api_key = (request.headers.get("X-Api-Key") or "").strip()
    if not install_id:
        raise HTTPException(status_code=400, detail="Missing X-Install-Id")

    # Determine effective plan by expiry
    user_id = resolve_user_id_from_api_key(api_key) if api_key else None
    meta = get_subscription_meta(user_id)
    plan_effective = effective_plan_from_meta(meta)

    # If expired -> treat as FREE by giving empty api_key to quota RPC
    api_key_for_quota = api_key if plan_effective != "FREE" else ""

    try:
        quota = consume_pair_access_or_raise(install_id=install_id, api_key=api_key_for_quota, symbol=symbol)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # ✅ CACHE key only depends on symbol+tf (compute part)
    cache_key = (symbol.upper().strip(), tf.strip())

    cached = _cache_get(cache_key)
    if cached:
        # merge plan/quota meta (per-user) + cached computed data
        payload = {
            **cached,
            "ok": True,
            "status": quota.get("status", "ok"),
            "plan": plan_effective,
            "valid": bool(quota.get("valid", False)) if plan_effective != "FREE" else False,
            "limit": quota.get("limit", None),
            "used": quota.get("used", None),
            "remaining": quota.get("remaining", None),
            "day": quota.get("day", None),
            "expires_at": meta.get("expires_at"),
            "days_left": meta.get("days_left"),
            "will_expire_soon": meta.get("will_expire_soon"),
        }
        return JSONResponse(
            payload,
            headers={"Cache-Control": f"public, max-age={FNG_CACHE_TTL_SEC}"},
        )

    # Not cached -> compute
    try:
        value, label, comps = compute_fng(symbol=symbol, tf=tf)

        computed_payload = {
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

        # cache only the computed part
        _cache_set(cache_key, computed_payload)

        payload = {
            **computed_payload,
            "ok": True,
            "status": quota.get("status", "ok"),
            "plan": plan_effective,
            "valid": bool(quota.get("valid", False)) if plan_effective != "FREE" else False,
            "limit": quota.get("limit", None),
            "used": quota.get("used", None),
            "remaining": quota.get("remaining", None),
            "day": quota.get("day", None),
            "expires_at": meta.get("expires_at"),
            "days_left": meta.get("days_left"),
            "will_expire_soon": meta.get("will_expire_soon"),
        }

        return JSONResponse(
            payload,
            headers={"Cache-Control": f"public, max-age={FNG_CACHE_TTL_SEC}"},
        )
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

    install_id = (request.headers.get("X-Install-Id") or "").strip()
    api_key = (request.headers.get("X-Api-Key") or "").strip()
    if not install_id:
        raise HTTPException(status_code=400, detail="Missing X-Install-Id")

    user_id = resolve_user_id_from_api_key(api_key) if api_key else None
    meta = get_subscription_meta(user_id)
    plan_effective = effective_plan_from_meta(meta)
    api_key_for_quota = api_key if plan_effective != "FREE" else ""

    try:
        quota = consume_pair_access_or_raise(install_id=install_id, api_key=api_key_for_quota, symbol=symbol)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    cache_key = (f"{symbol.upper().strip()}__components", tf.strip())
    cached = _cache_get(cache_key)
    if cached:
        payload = {
            **cached,
            "ok": True,
            "status": quota.get("status", "ok"),
            "plan": plan_effective,
            "valid": bool(quota.get("valid", False)) if plan_effective != "FREE" else False,
            "limit": quota.get("limit", None),
            "used": quota.get("used", None),
            "remaining": quota.get("remaining", None),
            "day": quota.get("day", None),
            "expires_at": meta.get("expires_at"),
            "days_left": meta.get("days_left"),
            "will_expire_soon": meta.get("will_expire_soon"),
        }
        return JSONResponse(
            payload,
            headers={"Cache-Control": f"public, max-age={FNG_CACHE_TTL_SEC}"},
        )

    try:
        value, label, comps = compute_fng(symbol=symbol, tf=tf)
        computed_payload = {
            "coin": symbol,
            "tf": tf,
            "value": round(value, 1),
            "label": label,
            "weights": comps["weights"],
            "scores": comps["scores"],
            "raw": comps["raw"],
            "updatedAt": ts_iso_now(),
        }
        _cache_set(cache_key, computed_payload)

        payload = {
            **computed_payload,
            "ok": True,
            "status": quota.get("status", "ok"),
            "plan": plan_effective,
            "valid": bool(quota.get("valid", False)) if plan_effective != "FREE" else False,
            "limit": quota.get("limit", None),
            "used": quota.get("used", None),
            "remaining": quota.get("remaining", None),
            "day": quota.get("day", None),
            "expires_at": meta.get("expires_at"),
            "days_left": meta.get("days_left"),
            "will_expire_soon": meta.get("will_expire_soon"),
        }

        return JSONResponse(
            payload,
            headers={"Cache-Control": f"public, max-age={FNG_CACHE_TTL_SEC}"},
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

#++++++++++++++++++++++++++++++++++++++++++++++++++
#GPT Store add
#++++++++++++++++++++++++++++++++++++++++++++++++++
@app.get("/api/gpt-fng")
def gpt_fng(
    pairs: str = Query("BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT", description="Comma-separated Binance pairs"),
):
    """
    GPT-friendly endpoint:
    - no X-Install-Id
    - no quota usage
    - max 4 pairs
    - returns clean JSON for GPT Store
    """

    try:
        raw_pairs = [p.strip().upper() for p in pairs.split(",") if p.strip()]
        raw_pairs = raw_pairs[:GPT_MAX_PAIRS]

        if not raw_pairs:
            return JSONResponse({"error": "No valid pairs provided"}, status_code=400)

        results = []

        for symbol in raw_pairs:
            tf_map = {}
            tf_values = []

            for tf in GPT_ALLOWED_TF:
                cache_key = (symbol, tf)
                cached = _cache_get(cache_key)

                if cached:
                    value = float(cached["value"])
                    label = cached["label"]
                else:
                    value, label, comps = compute_fng(symbol=symbol, tf=tf)

                    computed_payload = {
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
                    _cache_set(cache_key, computed_payload)
                    value = float(computed_payload["value"])

                tf_map[tf] = round(value, 1)
                tf_values.append(value)

            avg = float(np.mean(tf_values))
            sentiment = summarize_sentiment(avg)
            risk = derive_risk_score(tf_values)

            results.append({
                "symbol": symbol,
                "sentiment": sentiment,
                "risk": risk,
                "risk_label": risk_label(risk),
                "tf_15m": tf_map["15m"],
                "tf_1h": tf_map["1h"],
                "tf_4h": tf_map["4h"],
                "tf_1d": tf_map["1d"],
                "summary": build_pair_summary(symbol, avg, risk),
                "average_score": round(avg, 1),
            })

        # market summary
        if results:
            market_avg = float(np.mean([x["average_score"] for x in results]))
            market_risk = int(np.mean([x["risk"] for x in results]))
            market_summary = build_pair_summary("MARKET", market_avg, market_risk)

            best_setup = max(
                results,
                key=lambda x: (x["average_score"] - x["risk"] * 0.35)
            )["symbol"]
        else:
            market_summary = "No market summary available."
            best_setup = None

        return JSONResponse({
            "ok": True,
            "pairs": results,
            "market_summary": market_summary,
            "best_setup": best_setup,
            "updatedAt": ts_iso_now(),
        })

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ============================================================
# CHECKOUT API (твій код — без змін по логіці)
# ============================================================
class CheckoutCreateIn(BaseModel):
    wallet: str
    plan_code: str = Field(pattern="^(pro|vip|PRO|VIP)$")
    chain_id: int


class CheckoutCreateOut(BaseModel):
    payment_id: int
    chain_id: int
    token_address: str
    to_address: str
    amount: str
    decimals: int


class CheckoutConfirmIn(BaseModel):
    payment_id: int
    tx_hash: str


class CheckoutConfirmOut(BaseModel):
    ok: bool
    plan: str
    expires_at: str
    api_key: str

class AiAnalysisIn(BaseModel):
    symbol: str
    tf_15m: float
    tf_1h: float
    tf_4h: float
    tf_1d: float
    risk: int

def _pending_tx_placeholder() -> str:
    return "pending_" + secrets.token_hex(24)


@app.post("/api/checkout/create", response_model=CheckoutCreateOut)
def checkout_create(payload: CheckoutCreateIn):
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    plan_code = payload.plan_code.lower()
    if plan_code not in ("pro", "vip"):
        raise HTTPException(status_code=400, detail="Invalid plan_code")

    if payload.chain_id not in SUPPORTED_CHAINS:
        raise HTTPException(status_code=400, detail="Unsupported chain_id")

    user_id = get_or_create_user_by_wallet(payload.wallet)

    plan_row = _supabase_call(
        lambda: supabase.table("plans").select("code,price_usd").eq("code", plan_code).limit(1).execute()
    )
    plan_data = _sb_data(plan_row.data)
    if not plan_data:
        raise HTTPException(status_code=404, detail="Plan not found in plans table")

    amount = str(plan_data["price_usd"])
    token_addr = _usdt_address(payload.chain_id)
    receiver = _receive_wallet()
    decimals = _usdt_decimals(payload.chain_id)

    placeholder_tx = _pending_tx_placeholder()

    ins = _supabase_call(
        lambda: supabase.table("payments").insert({
            "user_id": user_id,
            "plan_code": plan_code,
            "chain_id": payload.chain_id,
            "token_address": token_addr,
            "tx_hash": placeholder_tx,
            "payer_address": None,
            "receiver_address": receiver,
            "amount": amount,
            "decimals": int(decimals),
            "status": "pending",
        }).execute()
    )

    row = _sb_data(ins.data)
    if not row or not row.get("id"):
        raise HTTPException(status_code=500, detail="Failed to create payment")

    return CheckoutCreateOut(
        payment_id=int(row["id"]),
        chain_id=payload.chain_id,
        token_address=token_addr,
        to_address=receiver,
        amount=amount,
        decimals=int(decimals),
    )


def _verify_usdt_transfer(
    chain_id: int,
    tx_hash: str,
    token_addr: str,
    to_addr: str,
    amount_human: Decimal,
    decimals: int
) -> str:
    web3 = _w3(chain_id)

    receipt = web3.eth.get_transaction_receipt(tx_hash)
    if not receipt:
        raise HTTPException(status_code=400, detail="Transaction not found yet")

    if receipt.get("status") != 1:
        raise HTTPException(status_code=400, detail="Transaction failed")

    token_addr = Web3.to_checksum_address(token_addr)
    to_addr = Web3.to_checksum_address(to_addr)
    expected_value = int(amount_human * (10 ** decimals))

    for log in receipt["logs"]:
        if Web3.to_checksum_address(log["address"]) != token_addr:
            continue
        if log["topics"][0].hex() != TRANSFER_TOPIC:
            continue

        decoded = get_event_data(web3.codec, ERC20_TRANSFER_ABI, log)
        frm = Web3.to_checksum_address(decoded["args"]["from"])
        to = Web3.to_checksum_address(decoded["args"]["to"])
        value = int(decoded["args"]["value"])

        if to == to_addr and value == expected_value:
            return frm

    raise HTTPException(status_code=400, detail="No matching USDT Transfer(to,amount) found in tx logs")


@app.post("/api/checkout/confirm", response_model=CheckoutConfirmOut)
def checkout_confirm(payload: CheckoutConfirmIn):
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    tx_hash = (payload.tx_hash or "").strip()
    if not tx_hash.startswith("0x"):
        raise HTTPException(status_code=400, detail="Invalid tx_hash")

    p_res = _supabase_call(lambda: supabase.table("payments").select("*").eq("id", payload.payment_id).limit(1).execute())
    pay = _sb_data(p_res.data)
    if not pay:
        raise HTTPException(status_code=404, detail="payment_id not found")

    status = str(pay.get("status", "")).lower()
    if status == "confirmed":
        user_id = pay["user_id"]
        sub = _sb_data(_supabase_call(lambda: supabase.table("subscriptions").select("plan,expires_at").eq("user_id", user_id).limit(1).execute()).data) or {}
        key = _sb_data(_supabase_call(lambda: supabase.table("api_keys").select("api_key").eq("user_id", user_id).eq("revoked", False).eq("is_active", True).order("created_at", desc=True).limit(1).execute()).data) or {}
        return CheckoutConfirmOut(
            ok=True,
            plan=str(sub.get("plan", "FREE")).upper(),
            expires_at=str(sub.get("expires_at", "")),
            api_key=str(key.get("api_key", "")),
        )

    chain_id = int(pay["chain_id"])
    token_addr = str(pay["token_address"])
    receiver = str(pay["receiver_address"])
    amount = Decimal(str(pay["amount"]))
    decimals = int(pay.get("decimals", _usdt_decimals(chain_id)))
    plan_code = str(pay["plan_code"]).lower()
    user_id = pay["user_id"]

    payer = _verify_usdt_transfer(chain_id, tx_hash, token_addr, receiver, amount, decimals)

    now = datetime.now(timezone.utc)
    granted_from = now
    granted_to = now + timedelta(days=30)

    _supabase_call(lambda: supabase.table("payments").update({
        "status": "confirmed",
        "tx_hash": tx_hash,
        "payer_address": payer,
        "confirmed_at": ts_iso_now(),
        "granted_from": granted_from.isoformat(),
        "granted_to": granted_to.isoformat(),
    }).eq("id", payload.payment_id).execute())

    sub_res = _supabase_call(lambda: supabase.table("subscriptions").select("expires_at").eq("user_id", user_id).limit(1).execute())
    sub = _sb_data(sub_res.data)

    base = now
    if sub and sub.get("expires_at"):
        cur_exp = _parse_iso_dt(sub["expires_at"])
        if cur_exp and cur_exp > base:
            base = cur_exp

    new_expires = base + timedelta(days=30)

    _supabase_call(lambda: supabase.table("subscriptions").upsert({
        "user_id": user_id,
        "plan": plan_code.upper(),
        "status": "active",
        "expires_at": new_expires.isoformat(),
        "wallet_address": payer.lower(),
        "chain_id": chain_id,
        "last_payment_tx": tx_hash,
    }, on_conflict="user_id").execute())

    k_res = _supabase_call(lambda: supabase.table("api_keys").select("api_key").eq("user_id", user_id).eq("revoked", False).eq("is_active", True).order("created_at", desc=True).limit(1).execute())
    keyrow = _sb_data(k_res.data)

    if keyrow and keyrow.get("api_key"):
        api_key = keyrow["api_key"]
    else:
        api_key = _gen_api_key()
        _supabase_call(lambda: supabase.table("api_keys").insert({
            "user_id": user_id,
            "api_key": api_key,
            "revoked": False,
            "is_active": True,
            "label": "main",
            "created_at": ts_iso_now(),
        }).execute())

    # clear caches (so UI sees new plan instantly)
    _APIKEY_TO_UID.pop(api_key, None)
    _UID_TO_SUBMETA.pop(user_id, None)

    return CheckoutConfirmOut(
        ok=True,
        plan=plan_code.upper(),
        expires_at=new_expires.isoformat(),
        api_key=api_key
    )
@app.post("/api/ai-analysis")
def ai_analysis(request: Request, payload: AiAnalysisIn):
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    install_id = (request.headers.get("X-Install-Id") or "").strip()
    api_key = (request.headers.get("X-Api-Key") or "").strip()

    if not install_id:
        raise HTTPException(status_code=400, detail="Missing X-Install-Id")

    # --- PLAN ---
    user_id = resolve_user_id_from_api_key(api_key) if api_key else None
    meta = get_subscription_meta(user_id)
    plan_effective = effective_plan_from_meta(meta)

    # FREE → блок
    if plan_effective == "FREE":
        raise HTTPException(
            status_code=402,
            detail={"ok": False, "error": "upgrade_required"}
        )

    # --- AI QUOTA ---
    def _do():
        return supabase.rpc(
            "consume_ai_analysis",
            {
                "p_install_id": install_id,
                "p_api_key": api_key,
                "p_symbol": payload.symbol,
            },
        ).execute()

    res = _supabase_call(_do)
    quota = _sb_data(res.data) or {}

    if not quota.get("ok", False):
        raise HTTPException(status_code=402, detail=quota)

    # --- OPENAI PROMPT ---
    prompt = f"""
You are a crypto trader.

Symbol: {payload.symbol}

Timeframes:
15m: {payload.tf_15m}
1h: {payload.tf_1h}
4h: {payload.tf_4h}
1d: {payload.tf_1d}

Risk score: {payload.risk}/100

Do NOT repeat numbers.

Return JSON:

{{
  "bias": "Bullish / Bearish / Neutral",
  "setup": "short idea",
  "summary": "2 short sentences",
  "what_matters": "key factor",
  "caution": "risk warning"
}}
"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a professional crypto analyst."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7
        )

        text = response.choices[0].message.content

        text = text.strip()

        if text.startswith("```"):
            parts = text.split("```")
            if len(parts) >= 2:
                text = parts[1]
            text = text.replace("json", "", 1).strip()

        parsed = json.loads(text)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")

    return {
        "ok": True,
        "used": quota.get("used"),
        "limit": quota.get("limit"),
        "remaining": quota.get("remaining"),
        "analysis": parsed
    }
