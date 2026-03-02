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

function shortAddr(a: string) {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

type UiStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "paying"
  | "confirming"
  | "success"
  | "error";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ||
  "https://fear-greed-24pr.onrender.com";

export default function CheckoutBox() {
  const [hasMM, setHasMM] = useState(false);
  const [address, setAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number | null>(null);

  const [status, setStatus] = useState<UiStatus>("idle");
  const [error, setError] = useState<string>("");

  // Optional: show tx hash to user
  const [txHash, setTxHash] = useState<string>("");

  const chainLabel = useMemo(() => {
    if (!chainId) return "—";
    return CHAINS.find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`;
  }, [chainId]);

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

  async function connect() {
    setError("");
    setTxHash("");
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
      setError(e?.message || "Failed to connect MetaMask");
    }
  }

  // ✅ Payment flow
  async function payUSDT(plan: "PRO" | "VIP") {
    setError("");
    setTxHash("");

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
      setStatus("paying");

      const provider = new ethers.BrowserProvider(eth);
      const signer = await provider.getSigner();
      const wallet = await signer.getAddress();

      // 🔴 TEMP user_id
      // Better later: map wallet -> users.id in Supabase
      const user_id = wallet; // ✅ workable temporary ID

      // 1) ask backend for checkout params (token, amount, merchant)
      const res = await fetch(`${API_BASE}/api/checkout/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, user_id, wallet }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`checkout/start failed: ${text}`);
      }

      const data: {
        token_address: string;
        merchant_address: string;
        amount: string; // "9" or "29" (or "9.0")
        decimals?: number; // optional
        chain_id?: number; // optional
      } = await res.json();

      const decimals = typeof data.decimals === "number" ? data.decimals : 18;

      // 2) send USDT transfer
      const usdt = new ethers.Contract(
        data.token_address,
        ["function transfer(address to, uint256 amount) returns (bool)"],
        signer
      );

      const amount = ethers.parseUnits(String(data.amount), decimals);

      const tx = await usdt.transfer(data.merchant_address, amount);
      setTxHash(tx.hash);

      // wait for mined (1 confirmation is ok for start)
      setStatus("confirming");
      await tx.wait(1);

      // 3) confirm to backend (backend verifies tx receipt + Transfer event)
      const res2 = await fetch(`${API_BASE}/api/checkout/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tx_hash: tx.hash, user_id, plan }),
      });

      if (!res2.ok) {
        const text = await res2.text();
        throw new Error(`checkout/confirm failed: ${text}`);
      }

      setStatus("success");
    } catch (e: any) {
      setStatus("error");
      setError(e?.message || "Payment failed");
    }
  }

  const connected = !!address;
  const busy = status === "connecting" || status === "paying" || status === "confirming";

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="kicker">Checkout</div>
          <div className="mt-1 text-xl font-black">MetaMask → USDT → Activate plan</div>
          <div className="mt-2 muted text-sm">
            Connect your wallet, choose a plan, and pay USDT. After confirmation, the backend will activate your
            subscription and generate/activate an API key.
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <button className="btn btnPrimary" type="button" onClick={connect} disabled={busy}>
            {connected ? "Connected" : status === "connecting" ? "Connecting…" : "Connect MetaMask"}
          </button>

          <button className="btn" type="button" disabled={!connected || busy} onClick={() => payUSDT("PRO")}>
            {status === "paying" || status === "confirming" ? "Processing…" : "Choose PRO ($9 / 30d)"}
          </button>

          <button className="btn" type="button" disabled={!connected || busy} onClick={() => payUSDT("VIP")}>
            {status === "paying" || status === "confirming" ? "Processing…" : "Choose VIP ($29 / 30d)"}
          </button>
        </div>
      </div>

      <div className="mt-4 muted text-sm">
        Status:{" "}
        <b>
          {hasMM
            ? connected
              ? status === "paying"
                ? "Sending transaction…"
                : status === "confirming"
                  ? "Confirming on-chain…"
                  : status === "success"
                    ? "Activated ✅"
                    : "Connected"
              : "Not connected"
            : "MetaMask not detected"}
        </b>{" "}
        • Network: <b>{chainLabel}</b> • Address: <b>{connected ? shortAddr(address) : "—"}</b>
        {txHash ? (
          <>
            {" "}
            • TX: <b>{shortAddr(txHash)}</b>
          </>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3" style={{ color: "rgba(255,120,120,0.95)", fontSize: 14, fontWeight: 700 }}>
          {error}
        </div>
      ) : null}

      {status === "success" ? (
        <div className="mt-3" style={{ color: "rgba(14,203,129,0.95)", fontSize: 14, fontWeight: 800 }}>
          Payment confirmed. Your plan is active.
        </div>
      ) : null}
    </div>
  );
}