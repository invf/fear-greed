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

// ✅ MVP: force BSC
const TARGET_CHAIN_ID_HEX = "0x38"; // 56
const TARGET_CHAIN_ID_DEC = 56;

// BSC chain params (for wallet_addEthereumChain)
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

  // User rejected
  if (e?.code === 4001 || m.includes("user rejected") || m.includes("rejected")) {
    return "Transaction was rejected in MetaMask.";
  }

  // Insufficient token balance
  if (m.includes("transfer amount exceeds balance") || m.includes("exceeds balance")) {
    return "Not enough USDT for this payment. Please top up your USDT (BSC) balance.";
  }

  // Insufficient gas
  if (m.includes("insufficient funds") || m.includes("gas") && m.includes("insufficient")) {
    return "Not enough BNB for network gas fee. Please add a small amount of BNB on BSC.";
  }

  // Wrong network hints
  if (m.includes("chain") && m.includes("switch")) {
    return "Please switch MetaMask to BSC (BNB Chain) to pay with USDT.";
  }

  return String(msg);
}

export default function CheckoutBox() {
  const [hasMM, setHasMM] = useState(false);
  const [address, setAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number | null>(null);

  const [status, setStatus] = useState<UiStatus>("idle");
  const [error, setError] = useState<string>("");

  const [txHash, setTxHash] = useState<string>("");
  const [paymentId, setPaymentId] = useState<string>("");

  // Show balances for user guidance
  const [bnBWei, setBnBWei] = useState<bigint>(0n);
  const [usdtRaw, setUsdtRaw] = useState<bigint>(0n);
  const [usdtDecimals, setUsdtDecimals] = useState<number>(18);
  const [usdtAddress, setUsdtAddress] = useState<string>("");

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

    const provider = new ethers.BrowserProvider(eth);
    const bnb = await provider.getBalance(address);
    setBnBWei(bnb);

    const tAddr = tokenAddr || usdtAddress;
    const tDec = typeof tokenDecimals === "number" ? tokenDecimals : usdtDecimals;

    if (tAddr) {
      const erc20 = new ethers.Contract(
        tAddr,
        ["function balanceOf(address) view returns (uint256)"],
        provider
      );
      const bal: bigint = await erc20.balanceOf(address);
      setUsdtRaw(bal);
      setUsdtDecimals(tDec);
      setUsdtAddress(tAddr);
    }
  }

  // ✅ Full payment flow: create -> transfer -> confirm
  async function payUSDT(plan: "PRO" | "VIP") {
    setError("");
    setTxHash("");
    setPaymentId("");

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
      // 0) switch network to BSC automatically
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

      // 1) create payment on backend (creates payment_id in Supabase)
      const res = await fetch(`${API_BASE}/api/checkout/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet, // ✅ backend maps wallet -> users.id
          plan_code: plan, // "PRO" | "VIP"
          chain_id: TARGET_CHAIN_ID_DEC, // 56
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`checkout/create failed: ${text}`);
      }

      const data: {
        payment_id: string;
        chain_id: number;
        token_address: string;
        to_address: string;
        amount: string; // human: "1" / "9" / "29"
        decimals: number; // token decimals
      } = await res.json();

      setPaymentId(data.payment_id);
      setUsdtAddress(data.token_address);
      setUsdtDecimals(data.decimals);

      // Update balances and do pre-checks
      await refreshBalances(data.token_address, data.decimals);

      const amountRaw = ethers.parseUnits(String(data.amount), data.decimals);

      // Basic pre-checks
      const bnbBal = await provider.getBalance(wallet);
      if (bnbBal <= 0n) {
        throw new Error("Not enough BNB for gas. Please add a small amount of BNB on BSC.");
      }

      const usdt = new ethers.Contract(
        data.token_address,
        ["function balanceOf(address) view returns (uint256)", "function transfer(address to, uint256 amount) returns (bool)"],
        signer
      );

      const uBal: bigint = await usdt.balanceOf(wallet);
      if (uBal < amountRaw) {
        throw new Error("Not enough USDT for this payment. Please top up your USDT (BSC) balance.");
      }

      // 2) transfer USDT
      setStatus("paying");
      const tx = await usdt.transfer(data.to_address, amountRaw);
      setTxHash(tx.hash);

      // 3) wait 1 confirmation
      setStatus("confirming");
      await tx.wait(1);

      // 4) confirm on backend (verifies receipt + Transfer event)
      const res2 = await fetch(`${API_BASE}/api/checkout/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_id: data.payment_id,
          tx_hash: tx.hash,
        }),
      });

      if (!res2.ok) {
        const text = await res2.text();
        throw new Error(`checkout/confirm failed: ${text}`);
      }

      // Optional: you can read returned api_key/expires and show it
      // const out = await res2.json();

      setStatus("success");
      await refreshBalances(data.token_address, data.decimals);
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
                  : "Choose PRO ($ / 30d)"}
          </button>

          <button className="btn" type="button" disabled={!connected || busy} onClick={() => payUSDT("VIP")}>
            {status === "switching"
              ? "Switching network…"
              : status === "creating"
                ? "Creating payment…"
                : status === "paying" || status === "confirming"
                  ? "Processing…"
                  : "Choose VIP ($ / 30d)"}
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
            • Payment: <b>{shortAddr(paymentId)}</b>
          </>
        ) : null}
        {txHash ? (
          <>
            {" "}
            • TX: <b>{shortAddr(txHash)}</b>
          </>
        ) : null}
      </div>

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
              If USDT is 0, make sure you are on <b>BSC</b> and USDT token is present.
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

      {status === "success" ? (
        <div className="mt-3" style={{ color: "rgba(14,203,129,0.95)", fontSize: 14, fontWeight: 900 }}>
          Payment confirmed. Your plan is active. Open Dashboard to see your API key.
        </div>
      ) : null}
    </div>
  );
}