# pip install -U pandas numpy ta fastapi uvicorn httpx
import math
import numpy as np
import pandas as pd
import httpx
from ta.momentum import RSIIndicator
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from datetime import datetime, timezone
from fastapi.responses import HTMLResponse

app = FastAPI()

@app.get("/", response_class=HTMLResponse)
def ui():
    # Файл index.html має лежати поруч із main.py
    with open("../frontend/index.html", "r", encoding="utf-8") as f:
        return f.read()


# ---- CONSTS
BINANCE_SPOT = "https://api.binance.com"
BINANCE_FAPI = "https://fapi.binance.com"  # USDT-M Futures

# Дозволені ТФ для споту/ф'ючерсів
VALID_TF = {"15m", "1h", "4h", "1d"}

# ---- APP
app = FastAPI(title="Custom Fear & Greed Index")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # у продакшні краще вказати свій домен
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- UTILS
def percentile(series_or_array, x) -> float:
    """Перцентиль: частка значень <= x."""
    arr = np.asarray(series_or_array, dtype=float)
    if arr.size == 0 or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return 0.5
    return float(np.mean(arr <= x))

def clamp01(x: float) -> float:
    return float(np.clip(x, 0.0, 1.0))

def ts_iso_now():
    return datetime.now(timezone.utc).isoformat()

def tf_to_oi_period(tf: str) -> str:
    """Binance OI period options: 5m,15m,30m,1h,2h,4h,6h,12h,1d
       Вибираємо найближчий відповідник."""
    return {"15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d"}[tf]

# ---- DATA FETCHERS
def klines(symbol="SOLUSDT", interval="1d", limit=500) -> pd.DataFrame:
    """Свічки зі Spot (для ціни/обсягів)"""
    params = {"symbol": symbol, "interval": interval, "limit": min(limit, 1000)}
    with httpx.Client(timeout=20) as client:
        r = client.get(f"{BINANCE_SPOT}/api/v3/klines", params=params)
        r.raise_for_status()
        rows = r.json()

    df = pd.DataFrame(rows, columns=[
        "t","o","h","l","c","v","ct","qv","n","tbb","tbq","i"
    ])
    df["t"]  = pd.to_datetime(df["t"], unit="ms", utc=True)
    df["ct"] = pd.to_datetime(df["ct"], unit="ms", utc=True)
    for col in ["o","h","l","c","v","qv","tbb","tbq"]:
        df[col] = df[col].astype(float)

    df["ret"] = np.log(df["c"]).diff()
    return df

def get_funding_now(symbol="SOLUSDT") -> float:
    """Останній funding rate (кожні ~8 год)"""
    with httpx.Client(timeout=15) as client:
        r = client.get(f"{BINANCE_FAPI}/fapi/v1/premiumIndex", params={"symbol": symbol})
        r.raise_for_status()
        data = r.json()
    # lastFundingRate може бути рядком
    return float(data.get("lastFundingRate", 0.0))

def get_funding_hist(symbol="SOLUSDT", limit=500) -> np.ndarray:
    with httpx.Client(timeout=20) as client:
        r = client.get(f"{BINANCE_FAPI}/fapi/v1/fundingRate",
                       params={"symbol": symbol, "limit": min(limit, 1000)})
        r.raise_for_status()
        arr = r.json()
    return np.array([float(x["fundingRate"]) for x in arr], dtype=float)

def get_oi_hist(symbol="SOLUSDT", period="1d", limit=200) -> pd.DataFrame:
    """Open Interest history (USDT-M Futures).
       Повертає час та openInterest (float)."""
    with httpx.Client(timeout=20) as client:
        r = client.get(f"{BINANCE_FAPI}/futures/data/openInterestHist",
                       params={"symbol": symbol, "period": period, "limit": min(limit, 500)})
        r.raise_for_status()
        arr = r.json()
    if isinstance(arr, dict) and "code" in arr:
        # інколи біржа повертає помилку як JSON
        raise RuntimeError(f"Binance OI error: {arr}")
    df = pd.DataFrame(arr)
    # поля: "symbol","sumOpenInterest","sumOpenInterestValue","timestamp"
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    for col in ("sumOpenInterest", "sumOpenInterestValue"):
        df[col] = df[col].astype(float)
    return df

# ---- SCORES
def compute_base_scores(df: pd.DataFrame) -> dict:
    """RSI / Momentum / Volatility / Volume anomaly"""
    # RSI-14 на ціні закриття
    rsi_series = RSIIndicator(df["c"], window=14).rsi()
    rsi = float(rsi_series.iloc[-1])
    score_rsi = float(np.clip((rsi - 30.0) / 40.0 * 100.0, 0, 100))

    # Momentum: остання одноперіодна доходність у перцентилях історії
    rets = df["ret"].dropna()
    r1 = float(rets.iloc[-1])
    p_mom = percentile(rets, r1)
    score_mom = p_mom * 100.0

    # Волатильність: stdev 30 → перцентиль в історії 180 періодів
    vol_hist = rets.rolling(30).std().dropna()
    cur_vol = float(vol_hist.iloc[-1]) if len(vol_hist) else 0.0
    p_vol = percentile(vol_hist[-180:], cur_vol) if len(vol_hist) else 0.5
    score_vol = (1.0 - p_vol) * 100.0  # низька волька => спокій
    # напрямок: при падінні робимо "більш страх"
    score_volx = 0.5 * score_vol + 0.5 * (100.0 - score_vol if r1 < 0 else score_vol)

    # Об'єм: поточний / медіана(30), у перцентилях власної історії
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
    """Повертає (score, cur, perc) для funding rate"""
    cur = get_funding_now(symbol)
    hist = get_funding_hist(symbol, limit=500)
    p = percentile(hist, cur) if hist.size else 0.5
    score = p * 100.0
    return float(score), float(cur), float(p)

def compute_oi_score(symbol="SOLUSDT", tf="1d") -> dict:
    """Оцінка OI:
       - перцентиль поточного OI
       - перцентиль ΔOI (ост. значення vs медіана N)
    """
    period = tf_to_oi_period(tf)
    df = get_oi_hist(symbol, period=period, limit=200)
    if df.empty:
        return {"oi": 50.0, "oi_delta": 50.0, "oi_cur": 0.0}

    oi = df["sumOpenInterest"].astype(float)
    oi_cur = float(oi.iloc[-1])
    p_oi = percentile(oi, oi_cur)

    # ΔOI відносно медіани (ост. N=30)
    med = float(oi.rolling(30, min_periods=5).median().iloc[-1])
    d_rel = (oi_cur - med) / med if med > 0 else 0.0
    # перцентиль по ряду відносних змін
    d_hist = ((oi - oi.shift(1)) / oi.shift(1)).dropna()
    p_delta = percentile(d_hist, d_rel) if len(d_hist) else 0.5

    score_oi = p_oi * 100.0
    score_oid = p_delta * 100.0
    # узагальнений OI-скоромір (можна змінити логику)
    score_oi_mix = 0.6 * score_oi + 0.4 * score_oid

    return {
        "oi": float(score_oi_mix),
        "oi_cur": oi_cur,
        "oi_p": float(p_oi),
        "oi_delta": float(score_oid),
        "oi_delta_val": float(d_rel),
        "oi_delta_p": float(p_delta),
    }

# ---- MAIN INDEX
def compute_fng(symbol="SOLUSDT", tf="1d") -> tuple[float, str, dict]:
    """Фінальний індекс з базових сигналів + funding + OI"""
    # 1) базові сигнали зі споту
    df = klines(symbol=symbol, interval=tf, limit=500)
    base = compute_base_scores(df)

    # 2) деривативи
    try:
        score_funding, funding_cur, funding_p = compute_funding_score(symbol)
    except Exception:
        score_funding, funding_cur, funding_p = 50.0, 0.0, 0.5

    try:
        oi_pack = compute_oi_score(symbol, tf=tf)  # містить зміксований score по OI
        score_oi = oi_pack["oi"]
    except Exception:
        oi_pack = {"oi": 50.0, "oi_cur": 0.0, "oi_p": 0.5,
                   "oi_delta": 50.0, "oi_delta_val": 0.0, "oi_delta_p": 0.5}
        score_oi = 50.0

    # 3) ваги (можеш підкрутити під себе)
    w = {
        "rsi": 0.25,
        "mom": 0.20,
        "vol": 0.15,
        "volm": 0.15,
        "funding": 0.15,
        "oi": 0.10,
    }

    fng = (
        w["rsi"] * base["rsi"] +
        w["mom"] * base["mom"] +
        w["vol"] * base["vol"] +
        w["volm"] * base["volm"] +
        w["funding"] * score_funding +
        w["oi"] * score_oi
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
            **oi_pack
        },
        "weights": w
    }
    return fng, label, components

# ---- ROUTES
@app.get("/", response_class=HTMLResponse)
def root():
    return """
    <h1>Custom Fear & Greed Index</h1>
    <p>Try: <a href="/api/fng?symbol=SOLUSDT&tf=1d">/api/fng?symbol=SOLUSDT&tf=1d</a></p>
    <p>Docs: <a href="/docs">/docs</a></p>
    """

@app.get("/health")
def health():
    return JSONResponse({"ok": True, "time": ts_iso_now()})

@app.get("/api/fng")
def fng(
    symbol: str = Query("SOLUSDT", description="Binance symbol, e.g. SOLUSDT"),
    tf: str = Query("1d", description="15m | 1h | 4h | 1d"),
):
    if tf not in VALID_TF:
        return JSONResponse({"error": f"Invalid tf={tf}. Allowed: {sorted(VALID_TF)}"}, status_code=400)

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
            "updatedAt": ts_iso_now()
        }
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/api/fng-components")
def fng_components(
    symbol: str = Query("SOLUSDT", description="Binance symbol, e.g. SOLUSDT"),
    tf: str = Query("1d", description="15m | 1h | 4h | 1d"),
):
    if tf not in VALID_TF:
        return JSONResponse({"error": f"Invalid tf={tf}. Allowed: {sorted(VALID_TF)}"}, status_code=400)
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
            "updatedAt": ts_iso_now()
        }
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
