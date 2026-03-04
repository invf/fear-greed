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
  | "switching"
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

// Minimal ERC20 ABI (enough for payments + checks)
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
];

function normalizeWeb3Error(e: any, ctx?: { amount?: string; symbol?: string }) {
  const rawMsg: string = String(e?.shortMessage || e?.reason || e?.message || "");

  // MetaMask reject
  if (e?.code === 4001 || rawMsg.toLowerCase().includes("user rejected")) {
    return "Transaction was rejected in MetaMask.";
  }

  // Wrong network / chain issues
  if (
    rawMsg.toLowerCase().includes("wrong network") ||
    rawMsg.toLowerCase().includes("chain") && rawMsg.toLowerCase().includes("switch")
  ) {
    return "Please switch MetaMask to BSC (BNB Chain) and try again.";
  }

  // Token balance
  if (rawMsg.includes("transfer amount exceeds balance")) {
    const a = ctx?.amount ? ` ${ctx.amount}` : "";
    const s = ctx?.symbol ? ` ${ctx.symbol}` : " USDT";
    return `Not enough${s} on BSC. Please top up your balance and try again. (Need${a}${s})`;
  }

  // Gas / native balance
  if (
    rawMsg.toLowerCase().includes("insufficient funds for gas") ||
    rawMsg.toLowerCase().includes("intrinsic gas too low") ||
    rawMsg.toLowerCase().includes("gas required exceeds allowance")
  ) {
    return "Not enough BNB for gas fees. Please add a small amount of BNB to your wallet.";
  }

  // Sometimes ethers throws "CALL_EXCEPTION" with revert reason inside
  if (e?.code === "CALL_EXCEPTION" && rawMsg) {
    return rawMsg;
  }

  // fallback
  return rawMsg || "Payment failed.";
}

export default function CheckoutBox() {
  const [hasMM, setHasMM] = useState(false);
  const [address, setAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number | null>(null);

  const [status, setStatus] = useState<UiStatus>("idle");
  const [error, setError] = useState<string>("");

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
      setError(normalizeWeb3Error(e));
    }
  }

  // ✅ Ensure BSC is selected in MetaMask
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
      // 4902 = chain not added
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
    }
  }

  // ✅ Payment flow (BSC USDT)
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
      // 0) switch network to BSC automatically
      await ensureBSC();

      // double-check chain after switch
      const cidHex: string = await eth.request({ method: "eth_chainId" });
      const cidDec = parseInt(cidHex, 16);
      if (cidDec !== TARGET_CHAIN_ID_DEC) {
        throw new Error("Please switch MetaMask to BSC (BNB Chain) to pay with USDT.");
      }

      setStatus("paying");

      const provider = new ethers.BrowserProvider(eth);
      const signer = await provider.getSigner();
      const wallet = await signer.getAddress();

      // 🔴 TEMP user_id (works for MVP)
      // Later: create user in Supabase and map wallet -> users.id
      const user_id = wallet;

      // 1) backend provides token, merchant, amount (and optionally decimals/chain_id)
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
        amount: string; // "9" or "29"
        decimals?: number;
        chain_id?: number;
      } = await res.json();

      // Safety: if backend sends chain_id, enforce it
      if (typeof data.chain_id === "number" && data.chain_id !== TARGET_CHAIN_ID_DEC) {
        throw new Error(`Wrong network. Please use BSC (56). Backend requested chain ${data.chain_id}.`);
      }

      // 2) Prepare USDT contract with checks
      const usdt = new ethers.Contract(data.token_address, ERC20_ABI, signer);

      // Prefer token decimals from contract (more reliable than “18”)
      const decimals: number =
        typeof data.decimals === "number" ? data.decimals : Number(await usdt.decimals());

      const amountWei = ethers.parseUnits(String(data.amount), decimals);

      // ✅ Check token balance FIRST (avoid revert)
      const tokenBal: bigint = (await usdt.balanceOf(wallet)) as bigint;
      if (tokenBal < amountWei) {
        const humanBal = ethers.formatUnits(tokenBal, decimals);
        throw new Error(
          `Not enough USDT on BSC. You have ${humanBal} USDT but need ${data.amount} USDT.`
        );
      }

      // ✅ Check gas balance (BNB) — avoid “insufficient funds for gas”
      const bnbBal: bigint = await provider.getBalance(wallet);
      // Minimal threshold just for UX (you can tune this)
      if (bnbBal === 0n) {
        throw new Error("Not enough BNB for gas fees. Please add a small amount of BNB to your wallet.");
      }

      // 3) USDT transfer
      const tx = await usdt.transfer(data.merchant_address, amountWei);
      setTxHash(tx.hash);

      // 4) wait 1 confirmation
      setStatus("confirming");
      await tx.wait(1);

      // 5) confirm to backend (backend verifies tx receipt + Transfer event)
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
      setError(normalizeWeb3Error(e, { amount: plan === "PRO" ? "9" : "29", symbol: "USDT" }));
    }
  }

  const connected = !!address;
  const busy =
    status === "connecting" ||
    status === "switching" ||
    status === "paying" ||
    status === "confirming";

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="kicker">Checkout</div>
          <div className="mt-1 text-xl font-black">MetaMask → USDT (BSC) → Activate plan</div>
          <div className="mt-2 muted text-sm">
            Connect your wallet, choose a plan, and pay USDT on BSC. After confirmation, the backend activates your
            subscription and generates/activates an API key.
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <button className="btn btnPrimary" type="button" onClick={connect} disabled={busy}>
            {connected ? "Connected" : status === "connecting" ? "Connecting…" : "Connect MetaMask"}
          </button>

          <button className="btn" type="button" disabled={!connected || busy} onClick={() => payUSDT("PRO")}>
            {status === "switching"
              ? "Switching network…"
              : status === "paying" || status === "confirming"
                ? "Processing…"
                : "Choose PRO ($9 / 30d)"}
          </button>

          <button className="btn" type="button" disabled={!connected || busy} onClick={() => payUSDT("VIP")}>
            {status === "switching"
              ? "Switching network…"
              : status === "paying" || status === "confirming"
                ? "Processing…"
                : "Choose VIP ($29 / 30d)"}
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
                : status === "paying"
                  ? "Sending transaction…"
                  : status === "confirming"
                    ? "Confirming on-chain…"
                    : status === "success"
                      ? "Activated ✅"
                      : "Connected"}
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