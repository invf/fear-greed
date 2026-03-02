"use client";

import { useState } from "react";

export default function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 900);
  }

  return (
    <div className="card p-4">
      <div className="text-xs font-extrabold muted">{label}</div>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto px-3 py-2 rounded-xl"
  style={{ background: "rgba(11,14,17,0.35)", border: "1px solid rgba(43,49,57,0.9)" }}>
          {value || "—"}
        </code>
        <button className="btn btnPrimary" onClick={onCopy} disabled={!value}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}