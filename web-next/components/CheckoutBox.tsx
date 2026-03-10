// web-next/components/CheckoutBox.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

type ChainInfo = { id: number; name: string };

const CHAINS: ChainInfo[] = [
  { id: 56, name: "BSC (56)" },
  { id: 42161, name: "Arbitrum (42161)" },
  { id: 137, name: "Polygon (137)" },
  { id: 1, name: "Ethereum (1)" },
];

type UiStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "switching"
  | "creating"
  | "paying"
  | "confirming"
  | "success"
  | "error";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ||
  "https://fear-greed-24pr.onrender.com";

// ✅ Force BSC
const TARGET_CHAIN_ID_HEX = "0x38"; // 56
const TARGET_CHAIN_ID_DEC = 56;

// ✅ Default USDT on BSC (BEP20)
const DEFAULT_USDT_BSC = "0x55d398326f99059fF775485246999027B3197955";
const DEFAULT_USDT_DECIMALS = 18;

// BSC chain params
const BSC_PARAMS = {
  chainId: TARGET_CHAIN_ID_HEX,
  chainName: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.binance.org/"],
  blockExplorerUrls: ["https://bscscan.com"],
};

function shortAddr(a: string) {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmt(n: bigint, decimals = 18, maxFrac = 6) {
  try {
    const s = ethers.formatUnits(n, decimals);
    const [i, f = ""] = s.split(".");
    return f ? `${i}.${f.slice(0, maxFrac)}` : i;
  } catch {
    return "—";
  }
}

function normalizeEthersError(e: any): string {
  const msg =
    e?.shortMessage ||
    e?.reason ||
    e?.message ||
    (typeof e === "string" ? e : "") ||
    "Payment failed";

  const m = String(msg).toLowerCase();

  if (e?.code === 4001 || m.includes("user rejected") || m.includes("rejected")) {
    return "Transaction was rejected in MetaMask.";
  }

  if (m.includes("transfer amount exceeds balance") || m.includes("exceeds balance")) {
    return "Not enough USDT for this payment. Please top up your USDT (BSC) balance.";
  }

  if (m.includes("insufficient funds") || (m.includes("gas") && m.includes("insufficient"))) {
    return "Not enough BNB for network gas fee. Please add a small amount of BNB on BSC.";
  }

  if (m.includes("chain") && m.includes("switch")) {
    return "Please switch MetaMask to BSC (BNB Chain) to pay with USDT.";
  }

  return String(msg);
}

type ConfirmOut = {
  ok: boolean;
  plan: string;
  expires_at: string;
  api_key: string;
};

function formatExpireDate(iso: string) {
  if (!iso) return "—";

  try {
    const d = new Date(iso);

    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function calcDaysLeft(iso: string) {
  if (!iso) return 0;

  try {
    const ms = new Date(iso).getTime() - Date.now();
    return Math.max(0, Math.floor(ms / 86400000));
  } catch {
    return 0;
  }
}

function daysColor(days: number) {
  if (days <= 1) return "#ff4d4f";
  if (days <= 7) return "#faad14";
  return "#3fb950";
}

function computeDaysLeft(expiresAtIso: string): number | null {
  try {
    if (!expiresAtIso) return null;
    const exp = new Date(expiresAtIso).getTime();
    if (!Number.isFinite(exp)) return null;
    const now = Date.now();
    const diffMs = exp - now;
    // ceil days
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

export default function CheckoutBox() {
  const [hasMM, setHasMM] = useState(false);
  const [address, setAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number | null>(null);

  const [status, setStatus] = useState<UiStatus>("idle");
  const [error, setError] = useState<string>("");

  const [txHash, setTxHash] = useState<string>("");
  const [paymentId, setPaymentId] = useState<string>("");

  // Balances
  const [bnBWei, setBnBWei] = useState<bigint>(0n);
  const [usdtRaw, setUsdtRaw] = useState<bigint>(0n);
  const [usdtDecimals, setUsdtDecimals] = useState<number>(DEFAULT_USDT_DECIMALS);
  const [usdtAddress, setUsdtAddress] = useState<string>(DEFAULT_USDT_BSC);

  // Result to show under buttons
  const [planOut, setPlanOut] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [apiKey, setApiKey] = useState<string>("");

  const daysLeft = useMemo(() => computeDaysLeft(expiresAt), [expiresAt]);
  const willExpireSoon = typeof daysLeft === "number" && daysLeft > 0 && daysLeft <= 3;

  const chainLabel = useMemo(() => {
    if (!chainId) return "—";
    return CHAINS.find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`;
  }, [chainId]);

  // Restore last result
  useEffect(() => {
    try {
      const k = localStorage.getItem("fg_api_key") || "";
      const p = localStorage.getItem("fg_plan") || "";
      const ex = localStorage.getItem("fg_expires_at") || "";
      if (k) setApiKey(k);
      if (p) setPlanOut(p);
      if (ex) setExpiresAt(ex);
    } catch {}
  }, []);

  useEffect(() => {
    const eth = (window as any).ethereum;
    setHasMM(!!eth);
    if (!eth) return;

    eth
      .request?.({ method: "eth_accounts" })
      .then((accs: string[]) => {
        if (accs?.[0]) setAddress(accs[0]);
      })
      .catch(() => {});

    eth
      .request?.({ method: "eth_chainId" })
      .then((cid: string) => setChainId(parseInt(cid, 16)))
      .catch(() => {});

    const onAccounts = (accs: string[]) => setAddress(accs?.[0] ?? "");
    const onChain = (cid: string) => setChainId(parseInt(cid, 16));

    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);

    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  // Auto refresh balances when connected & on BSC
  useEffect(() => {
    if (!address) return;
    if (chainId !== TARGET_CHAIN_ID_DEC) return;
    refreshBalances(DEFAULT_USDT_BSC, DEFAULT_USDT_DECIMALS).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, chainId]);

  async function connect() {
    setError("");
    setTxHash("");
    setPaymentId("");

    const eth = (window as any).ethereum;
    if (!eth) {
      setError("MetaMask not found. Install MetaMask extension and refresh.");
      setStatus("error");
      return;
    }

    try {
      setStatus("connecting");
      const accs: string[] = await eth.request({ method: "eth_requestAccounts" });
      const cid: string = await eth.request({ method: "eth_chainId" });

      setAddress(accs?.[0] ?? "");
      setChainId(parseInt(cid, 16));
      setStatus("connected");
    } catch (e: any) {
      setStatus("error");
      setError(normalizeEthersError(e));
    }
  }

  async function ensureBSC() {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("MetaMask not found");

    const currentChainId: string = await eth.request({ method: "eth_chainId" });
    if (currentChainId === TARGET_CHAIN_ID_HEX) return;

    setStatus("switching");

    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: TARGET_CHAIN_ID_HEX }],
      });
    } catch (switchError: any) {
      if (switchError?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [BSC_PARAMS],
        });
        await eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: TARGET_CHAIN_ID_HEX }],
        });
      } else {
        throw switchError;
      }
    } finally {
      setStatus("connected");
    }
  }

  async function refreshBalances(tokenAddr?: string, tokenDecimals?: number) {
    const eth = (window as any).ethereum;
    if (!eth || !address) return;

    try {
      const provider = new ethers.BrowserProvider(eth);

      const bnb = await provider.getBalance(address);
      setBnBWei(bnb);

      const tAddr = tokenAddr || usdtAddress || DEFAULT_USDT_BSC;
      const tDec =
        typeof tokenDecimals === "number"
          ? tokenDecimals
          : usdtDecimals || DEFAULT_USDT_DECIMALS;

      setUsdtAddress(tAddr);
      setUsdtDecimals(tDec);

      const erc20 = new ethers.Contract(
        tAddr,
        ["function balanceOf(address) view returns (uint256)"],
        provider
      );

      const bal: bigint = await erc20.balanceOf(address);
      setUsdtRaw(bal);
    } catch {
      setUsdtRaw(0n);
    }
  }

  async function payUSDT(plan: "PRO" | "VIP") {
    setError("");
    setTxHash("");
    setPaymentId("");

    // Clear previous result
    setPlanOut("");
    setExpiresAt("");
    setApiKey("");

    const eth = (window as any).ethereum;
    if (!eth) {
      setError("MetaMask not found.");
      setStatus("error");
      return;
    }
    if (!address) {
      setError("Connect MetaMask first.");
      setStatus("error");
      return;
    }

    try {
      await ensureBSC();

      const cidHex: string = await eth.request({ method: "eth_chainId" });
      const cidDec = parseInt(cidHex, 16);
      if (cidDec !== TARGET_CHAIN_ID_DEC) {
        throw new Error("Please switch MetaMask to BSC (BNB Chain) to pay with USDT.");
      }

      setStatus("creating");

      const provider = new ethers.BrowserProvider(eth);
      const signer = await provider.getSigner();
      const wallet = await signer.getAddress();

      // 1) Create payment on backend
      const res = await fetch(`${API_BASE}/api/checkout/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          plan_code: plan,
          chain_id: TARGET_CHAIN_ID_DEC,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`checkout/create failed: ${text}`);
      }

      const data: {
        payment_id: string | number;
        chain_id: number;
        token_address: string;
        to_address: string;
        amount: string;
        decimals: number;
      } = await res.json();

      const pid = String(data.payment_id);
      setPaymentId(pid);

      const tokenAddr = data.token_address || DEFAULT_USDT_BSC;
      const tokenDec = typeof data.decimals === "number" ? data.decimals : DEFAULT_USDT_DECIMALS;

      setUsdtAddress(tokenAddr);
      setUsdtDecimals(tokenDec);

      await refreshBalances(tokenAddr, tokenDec);

      const amountRaw = ethers.parseUnits(String(data.amount), tokenDec);

      // Pre-checks
      const bnbBal = await provider.getBalance(wallet);
      if (bnbBal <= 0n) {
        throw new Error("Not enough BNB for gas. Please add a small amount of BNB on BSC.");
      }

      const usdt = new ethers.Contract(
        tokenAddr,
        [
          "function balanceOf(address) view returns (uint256)",
          "function transfer(address to, uint256 amount) returns (bool)",
        ],
        signer
      );

      const uBal: bigint = await usdt.balanceOf(wallet);
      if (uBal < amountRaw) {
        throw new Error("Not enough USDT for this payment. Please top up your USDT (BSC) balance.");
      }

      // 2) Transfer
      setStatus("paying");
      const tx = await usdt.transfer(data.to_address, amountRaw);
      setTxHash(tx.hash);

      // 3) Wait 1 conf
      setStatus("confirming");
      await tx.wait(1);

      // 4) Confirm backend -> returns api_key + plan + expires
      const res2 = await fetch(`${API_BASE}/api/checkout/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_id: Number(pid),
          tx_hash: tx.hash,
        }),
      });

      if (!res2.ok) {
        const text = await res2.text();
        throw new Error(`checkout/confirm failed: ${text}`);
      }

      const out: ConfirmOut = await res2.json();

      if (!out?.ok || !out?.api_key) {
        throw new Error("Payment confirmed, but API key was not returned.");
      }

      setPlanOut(out.plan || "");
      setExpiresAt(out.expires_at || "");
      setApiKey(out.api_key || "");

      // Persist
      try {
        localStorage.setItem("fg_api_key", out.api_key || "");
        localStorage.setItem("fg_plan", out.plan || "");
        localStorage.setItem("fg_expires_at", out.expires_at || "");
      } catch {}

      setStatus("success");
      await refreshBalances(tokenAddr, tokenDec);
    } catch (e: any) {
      setStatus("error");
      setError(normalizeEthersError(e));
    }
  }

  const connected = !!address;
  const busy =
    status === "connecting" ||
    status === "switching" ||
    status === "creating" ||
    status === "paying" ||
    status === "confirming";

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="kicker">Checkout</div>
          <div className="mt-1 text-xl font-black">MetaMask → USDT (BSC) → Activate plan</div>
          <div className="mt-2 muted text-sm">
            Requirements: <b>USDT on BSC</b> for the plan + a small amount of <b>BNB</b> for gas.
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <button className="btn btnPrimary" type="button" onClick={connect} disabled={busy}>
            {connected ? "Connected" : status === "connecting" ? "Connecting…" : "Connect MetaMask"}
          </button>

          <button className="btn" type="button" disabled={!connected || busy} onClick={() => payUSDT("PRO")}>
            {status === "switching"
              ? "Switching network…"
              : status === "creating"
                ? "Creating payment…"
                : status === "paying" || status === "confirming"
                  ? "Processing…"
                  : "Choose PRO ($4.99 / 30d)"}
          </button>

          <button className="btn" type="button" disabled={!connected || busy} onClick={() => payUSDT("VIP")}>
            {status === "switching"
              ? "Switching network…"
              : status === "creating"
                ? "Creating payment…"
                : status === "paying" || status === "confirming"
                  ? "Processing…"
                  : "Choose VIP ($14.99 / 30d)"}
          </button>
        </div>
      </div>

      <div className="mt-4 muted text-sm">
        Status:{" "}
        <b>
          {!hasMM
            ? "MetaMask not detected"
            : !connected
              ? "Not connected"
              : status === "switching"
                ? "Switching to BSC…"
                : status === "creating"
                  ? "Creating payment…"
                  : status === "paying"
                    ? "Sending transaction…"
                    : status === "confirming"
                      ? "Confirming on-chain…"
                      : status === "success"
                        ? "Activated ✅"
                        : "Connected"}
        </b>{" "}
        • Network: <b>{chainLabel}</b> • Address: <b>{connected ? shortAddr(address) : "—"}</b>
        {paymentId ? (
          <>
            {" "}
            • Payment: <b>{paymentId}</b>
          </>
        ) : null}
        {txHash ? (
          <>
            {" "}
            • TX: <b>{shortAddr(txHash)}</b>
          </>
        ) : null}
      </div>

      {/* Result under buttons */}
      {(apiKey || planOut) ? (
        <div className="mt-4 card p-4">
          <div className="kicker">Your Subscription</div>
          <div className="mt-2 text-sm">
            Plan: <b>{planOut || "—"}</b>
            <br />
            Expires: <b>{formatExpireDate(expiresAt)}</b>
            <br />
            <span
              style={{
                color: daysColor(calcDaysLeft(expiresAt)),
                fontWeight: 700,
              }}
            >
              Days left: {calcDaysLeft(expiresAt)}
            </span>

          </div>

          {willExpireSoon ? (
            <div className="mt-3" style={{ color: "rgba(255,200,0,0.95)", fontSize: 13, fontWeight: 900 }}>
              ⚠️ Your plan will expire soon. Please renew to avoid switching to FREE.
            </div>
          ) : null}

          {apiKey ? (
            <div className="mt-3">
              <div className="kicker">API Key</div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <code className="px-3 py-2 rounded bg-black/20 text-sm break-all">{apiKey}</code>
                <button
                  className="btn btnGhost text-sm"
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(apiKey);
                    } catch {}
                  }}
                >
                  Copy
                </button>

                <button
                  className="btn btnGhost text-sm"
                  type="button"
                  onClick={() => {
                    try {
                      localStorage.removeItem("fg_api_key");
                      localStorage.removeItem("fg_plan");
                      localStorage.removeItem("fg_expires_at");
                    } catch {}
                    setApiKey("");
                    setPlanOut("");
                    setExpiresAt("");
                  }}
                >
                  Clear
                </button>
              </div>

              <div className="mt-2 muted text-xs">
                Tip: this key is saved in your browser (localStorage) so it stays after refresh.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {connected ? (
        <div className="mt-3 grid md:grid-cols-2 gap-3">
          <div className="card p-4">
            <div className="kicker">Balances (BSC)</div>
            <div className="mt-2 text-sm">
              BNB (gas): <b>{fmt(bnBWei, 18, 6)}</b>
              <br />
              USDT: <b>{fmt(usdtRaw, usdtDecimals, 6)}</b>
            </div>
            <div className="mt-2 muted text-xs">
              If USDT is 0, click Refresh (and ensure you are on <b>BSC</b>).
            </div>
            <div className="mt-3">
              <button className="btn btnGhost text-sm" type="button" onClick={() => refreshBalances()}>
                Refresh balances
              </button>
            </div>
          </div>

          <div className="card p-4">
            <div className="kicker">Tips</div>
            <div className="mt-2 muted text-sm leading-relaxed">
              • You need <b>USDT (BSC)</b> to pay. <br />
              • You need a bit of <b>BNB</b> for gas. <br />
              • If MetaMask warns about wrong network, approve the switch to <b>BSC</b>.
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3" style={{ color: "rgba(255,120,120,0.95)", fontSize: 14, fontWeight: 800 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}