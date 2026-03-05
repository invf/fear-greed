# app/main.py
# pip install -U pandas numpy ta fastapi uvicorn httpx supabase web3 ta
import math
import os
import secrets
from decimal import Decimal
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

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
# PAYMENTS (BSC USDT)
# ============================================================
# REQUIRED ENVS:
#   RECEIVE_WALLET="0x..." (туди приймаємо USDT)
#   RPC_56="https://..." (BSC rpc)
#   USDT_56="0x55d398..." (BSC USDT contract)
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
    # BSC “USDT” (0x55d3...) uses 18 decimals on BSC
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
    """Supabase python client sometimes returns list or dict."""
    if x is None:
        return None
    if isinstance(x, list):
        return x[0] if x else None
    return x


# ============================================================
# SUBSCRIPTIONS helpers (expiry -> effective plan)
# ============================================================
def _parse_iso_dt(x: Any) -> Optional[datetime]:
    if not x:
        return None
    try:
        s = str(x)
        if s.endswith("Z"):
            s = s.replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except Exception:
        return None


def resolve_user_id_from_api_key(api_key: str) -> Optional[str]:
    """
    Find user_id by api_key (active & not revoked).
    """
    if not supabase:
        return None

    k = (api_key or "").strip()
    if not k:
        return None

    res = (
        supabase.table("api_keys")
        .select("user_id")
        .eq("api_key", k)
        .eq("revoked", False)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    row = _sb_data(res.data)
    if not row:
        return None
    return row.get("user_id")


def get_subscription_meta(user_id: Optional[str]) -> Dict[str, Any]:
    """
    Returns:
      {
        plan_db, status, expires_at, active, days_left, will_expire_soon
      }
    """
    if not supabase or not user_id:
        return {
            "plan_db": "FREE",
            "status": "none",
            "expires_at": None,
            "active": False,
            "days_left": None,
            "will_expire_soon": False,
        }

    res = (
        supabase.table("subscriptions")
        .select("plan,status,expires_at")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    sub = _sb_data(res.data)
    if not sub:
        return {
            "plan_db": "FREE",
            "status": "none",
            "expires_at": None,
            "active": False,
            "days_left": None,
            "will_expire_soon": False,
        }

    plan_db = str(sub.get("plan") or "FREE")  # in DB: FREE/PRO/VIP
    status = str(sub.get("status") or "active")
    exp_dt = _parse_iso_dt(sub.get("expires_at"))

    now = datetime.now(timezone.utc)
    active = (status == "active") and (exp_dt is not None) and (exp_dt > now)

    days_left = None
    will_expire_soon = False
    if exp_dt is not None:
        seconds_left = (exp_dt - now).total_seconds()
        # ceil days
        days_left = int((seconds_left + 86399) // 86400)
        will_expire_soon = (days_left is not None) and (0 < days_left <= 3)

    return {
        "plan_db": plan_db,
        "status": status,
        "expires_at": exp_dt.isoformat() if exp_dt else None,
        "active": bool(active),
        "days_left": days_left,
        "will_expire_soon": bool(will_expire_soon),
    }


def effective_plan_from_meta(meta: Dict[str, Any]) -> str:
    """
    If subscription is not active -> FREE
    """
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

    q = (
        supabase.table("users")
        .select("id,wallet_address")
        .eq("wallet_address", wallet_norm)
        .limit(1)
        .execute()
    )
    row = _sb_data(q.data)
    if row and row.get("id"):
        return row["id"]

    ins = supabase.table("users").insert({"wallet_address": wallet_norm}).execute()
    new_row = _sb_data(ins.data)
    if not new_row or not new_row.get("id"):
        raise HTTPException(status_code=500, detail="Failed to create user for wallet")
    return new_row["id"]


# ============================================================
# SUPABASE gating helpers (existing)
# ============================================================
def validate_api_key_with_supabase(api_key: str) -> dict:
    """
    Calls RPC validate_api_key(p_key text) and returns normalized dict:
      { valid: bool, plan: "FREE"/"PRO"/"VIP"/..., status: "...", ... }
    """
    if not supabase:
        return {"valid": False, "plan": "FREE", "status": "supabase_not_configured"}

    api_key = (api_key or "").strip()
    if not api_key:
        return {"valid": False, "plan": "FREE", "status": "missing"}

    res = supabase.rpc("validate_api_key", {"p_key": api_key}).execute()
    data = _sb_data(res.data)

    if not data:
        return {"valid": False, "plan": "FREE", "status": "invalid"}

    if "valid" not in data:
        data["valid"] = True
    if "plan" not in data:
        data["plan"] = "PRO"
    if "status" not in data:
        data["status"] = "ok"
    return data


def consume_pair_access_or_raise(install_id: str, api_key: str, symbol: str) -> dict:
    """
    Calls RPC consume_pair_access(...) and returns its dict.
    Raises 402 if not ok.
    """
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

    res = supabase.rpc(
        "consume_pair_access",
        {
            "p_install_id": (install_id or "").strip(),
            "p_api_key": (api_key or "").strip(),
            "p_symbol": (symbol or "").strip(),
        },
    ).execute()

    data = _sb_data(res.data) or {}
    if not isinstance(data, dict):
        data = {"ok": False, "status": "bad_rpc_payload", "raw": data}

    if not data.get("ok", False):
        raise HTTPException(status_code=402, detail=data)

    return data


# ============================================================
# DATA FETCHERS (FNG)
# ============================================================
def klines(symbol="SOLUSDT", interval="1d", limit=500) -> pd.DataFrame:
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
    """
    Returns effective plan based on subscription expiry:
      - valid: api_key exists (active & not revoked)
      - plan: FREE if expired
      - expires_at/days_left/will_expire_soon: from subscriptions
    """
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
            "ok": True,
            "status": quota.get("status", "ok"),
            "plan": plan_effective,  # ✅ effective plan
            "valid": bool(quota.get("valid", False)) if plan_effective != "FREE" else False,
            "limit": quota.get("limit", None),
            "used": quota.get("used", None),
            "remaining": quota.get("remaining", None),
            "day": quota.get("day", None),
            # ✅ expiry meta for UI
            "expires_at": meta.get("expires_at"),
            "days_left": meta.get("days_left"),
            "will_expire_soon": meta.get("will_expire_soon"),
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

    install_id = (request.headers.get("X-Install-Id") or "").strip()
    api_key = (request.headers.get("X-Api-Key") or "").strip()
    if not install_id:
        raise HTTPException(status_code=400, detail="Missing X-Install-Id")

    # Determine effective plan by expiry
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
            "ok": True,
            "status": quota.get("status", "ok"),
            "plan": plan_effective,  # ✅ effective plan
            "valid": bool(quota.get("valid", False)) if plan_effective != "FREE" else False,
            "limit": quota.get("limit", None),
            "used": quota.get("used", None),
            "remaining": quota.get("remaining", None),
            "day": quota.get("day", None),
            # ✅ expiry meta for UI
            "expires_at": meta.get("expires_at"),
            "days_left": meta.get("days_left"),
            "will_expire_soon": meta.get("will_expire_soon"),
        }
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ============================================================
# CHECKOUT API
# ============================================================
class CheckoutCreateIn(BaseModel):
    wallet: str
    plan_code: str = Field(pattern="^(pro|vip|PRO|VIP)$")
    chain_id: int


class CheckoutCreateOut(BaseModel):
    payment_id: int  # bigserial
    chain_id: int
    token_address: str
    to_address: str  # receiver_address in DB
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


def _pending_tx_placeholder() -> str:
    # щоб пройти NOT NULL tx_hash + unique(chain_id, tx_hash)
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

    # 1) user by wallet
    user_id = get_or_create_user_by_wallet(payload.wallet)

    # 2) get plan price from plans.price_usd
    plan_row = (
        supabase.table("plans")
        .select("code,price_usd")
        .eq("code", plan_code)
        .limit(1)
        .execute()
    )
    plan_data = _sb_data(plan_row.data)
    if not plan_data:
        raise HTTPException(status_code=404, detail="Plan not found in plans table")

    # IMPORTANT: keep amount as string for Supabase JSON
    amount = str(plan_data["price_usd"])
    token_addr = _usdt_address(payload.chain_id)
    receiver = _receive_wallet()
    decimals = _usdt_decimals(payload.chain_id)

    placeholder_tx = _pending_tx_placeholder()

    # 3) insert pending payment
    ins = supabase.table("payments").insert({
        "user_id": user_id,
        "plan_code": plan_code,
        "chain_id": payload.chain_id,
        "token_address": token_addr,
        "tx_hash": placeholder_tx,
        "payer_address": None,
        "receiver_address": receiver,
        "amount": amount,               # ✅ string (no Decimal JSON issue)
        "decimals": int(decimals),
        "status": "pending",
    }).execute()

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
            return frm  # payer wallet

    raise HTTPException(status_code=400, detail="No matching USDT Transfer(to,amount) found in tx logs")


@app.post("/api/checkout/confirm", response_model=CheckoutConfirmOut)
def checkout_confirm(payload: CheckoutConfirmIn):
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    tx_hash = (payload.tx_hash or "").strip()
    if not tx_hash.startswith("0x"):
        raise HTTPException(status_code=400, detail="Invalid tx_hash")

    # 1) load payment
    p_res = supabase.table("payments").select("*").eq("id", payload.payment_id).limit(1).execute()
    pay = _sb_data(p_res.data)
    if not pay:
        raise HTTPException(status_code=404, detail="payment_id not found")

    status = str(pay.get("status", "")).lower()
    if status == "confirmed":
        # already confirmed -> return current state
        user_id = pay["user_id"]
        sub = _sb_data(
            supabase.table("subscriptions").select("plan,expires_at").eq("user_id", user_id).limit(1).execute().data
        ) or {}
        key = _sb_data(
            supabase.table("api_keys")
            .select("api_key")
            .eq("user_id", user_id)
            .eq("revoked", False)
            .eq("is_active", True)
            .order("created_at", desc=True)
            .limit(1)
            .execute().data
        ) or {}
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

    # 2) verify on-chain Transfer(to=receiver, amount)
    payer = _verify_usdt_transfer(chain_id, tx_hash, token_addr, receiver, amount, decimals)

    # 3) mark payment confirmed + granted window
    now = datetime.now(timezone.utc)
    granted_from = now
    granted_to = now + timedelta(days=30)

    supabase.table("payments").update({
        "status": "confirmed",
        "tx_hash": tx_hash,
        "payer_address": payer,
        "confirmed_at": ts_iso_now(),
        "granted_from": granted_from.isoformat(),
        "granted_to": granted_to.isoformat(),
    }).eq("id", payload.payment_id).execute()

    # 4) extend subscription (unique user_id)
    sub_res = supabase.table("subscriptions").select("expires_at").eq("user_id", user_id).limit(1).execute()
    sub = _sb_data(sub_res.data)

    base = now
    if sub and sub.get("expires_at"):
        try:
            cur_exp = _parse_iso_dt(sub["expires_at"])
            if cur_exp and cur_exp > base:
                base = cur_exp
        except Exception:
            pass

    new_expires = base + timedelta(days=30)

    supabase.table("subscriptions").upsert({
        "user_id": user_id,
        "plan": plan_code.upper(),     # ✅ FREE/PRO/VIP to satisfy chk + FK
        "status": "active",
        "expires_at": new_expires.isoformat(),
        "wallet_address": payer.lower(),
        "chain_id": chain_id,
        "last_payment_tx": tx_hash,
    }, on_conflict="user_id").execute()

    # 5) ensure API key exists
    k_res = (
        supabase.table("api_keys")
        .select("api_key")
        .eq("user_id", user_id)
        .eq("revoked", False)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    keyrow = _sb_data(k_res.data)

    if keyrow and keyrow.get("api_key"):
        api_key = keyrow["api_key"]
    else:
        api_key = _gen_api_key()
        supabase.table("api_keys").insert({
            "user_id": user_id,
            "api_key": api_key,
            "revoked": False,
            "is_active": True,
            "label": "main",
            "created_at": ts_iso_now(),
        }).execute()

    return CheckoutConfirmOut(
        ok=True,
        plan=plan_code.upper(),
        expires_at=new_expires.isoformat(),
        api_key=api_key
    )