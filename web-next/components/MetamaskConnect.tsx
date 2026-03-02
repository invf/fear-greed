"use client";

import { useState } from "react";
import { connectWallet } from "@/lib/web3";

export default function MetamaskConnect({ onConnected }: { onConnected?: (addr: string) => void }) {
  const [addr, setAddr] = useState<string>("");
  const [err, setErr] = useState<string>("");

  async function onConnect() {
    setErr("");
    try {
      const a = await connectWallet();
      setAddr(a);
      onConnected?.(a);
    } catch (e: any) {
      setErr(String(e?.message || e || "MetaMask error"));
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-extrabold muted">WALLET</div>
          <div className="mt-1 font-black">{addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "Not connected"}</div>
          {err ? <div className="mt-2 text-sm" style={{ color: "#F6465D" }}>{err}</div> : null}
        </div>
        <button className="btn btnPrimary" onClick={onConnect}>
          {addr ? "Connected" : "Connect MetaMask"}
        </button>
      </div>
    </div>
  );
}