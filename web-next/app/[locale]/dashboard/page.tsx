"use client";

import { useEffect, useState } from "react";
import CopyBox from "@/components/CopyBox";
import MetamaskConnect from "@/components/MetamaskConnect";
import { apiGet } from "@/lib/api";

export default function DashboardPage() {
  const [apiKey, setApiKey] = useState("");
  const [plan, setPlan] = useState("FREE");
  const [quota, setQuota] = useState<string>("—");
  const [err, setErr] = useState("");

  // Це демо: якщо в тебе вже є ендпоінт видачі ключа — підключиш тут.
  // Поки просто читаємо план/валідність по validate, якщо є ключ.
  async function refreshStatus(key?: string) {
    setErr("");
    const k = (key ?? apiKey).trim();
    if (!k) {
      setPlan("FREE");
      setQuota("—");
      return;
    }

    // validate-key (те, що вже є в extension)
    const r = await apiGet("/api/validate-key", {
      headers: { "X-Api-Key": k, "X-Install-Id": "web-demo" }
    });

    const data = (r.data?.data ?? r.data?.detail ?? r.data) || {};
    if (!r.ok) {
      setPlan(String(data.plan || "FREE"));
      setErr(String(data.status || "invalid"));
      return;
    }

    setPlan(String(data.plan || "FREE"));
    setErr("");
  }

  useEffect(() => {
    // якщо хочеш — можеш зберігати apiKey в localStorage
    const saved = localStorage.getItem("fg_api_key") || "";
    if (saved) {
      setApiKey(saved);
      refreshStatus(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSaveKey() {
    localStorage.setItem("fg_api_key", apiKey.trim());
    refreshStatus();
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="text-3xl font-black">Dashboard</div>
        <div className="mt-2 muted">
          Тут буде керування підпискою, quota і API key (для extension).
        </div>

        <div className="mt-5 grid md:grid-cols-2 gap-4">
          <MetamaskConnect />
          <div className="card p-4" style={{ background: "rgba(11,14,17,0.22)" }}>
            <div className="text-xs font-extrabold muted">PLAN</div>
            <div className="mt-1 text-2xl font-black">{plan}</div>
            <div className="mt-2 muted text-sm">Quota: {quota}</div>
            {err ? <div className="mt-2 text-sm" style={{ color: "#F6465D" }}>Status: {err}</div> : null}
          </div>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-xs font-extrabold muted">API KEY</div>
          <div className="mt-2 flex gap-2">
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl"
              style={{ background: "rgba(11,14,17,0.35)", border: "1px solid rgba(43,49,57,0.9)" }}
              placeholder="Paste your API key..."
            />
            <button className="btn btnPrimary" onClick={onSaveKey}>
              Save
            </button>
          </div>
          <div className="mt-2 muted text-sm">
            В extension цей ключ зберігається в Chrome storage. Тут — просто демо.
          </div>
        </div>

        <CopyBox label="COPY API KEY" value={apiKey.trim()} />
      </section>

      <section className="card p-6">
        <div className="font-black">Далі (коли будеш готовий)</div>
        <div className="mt-2 muted text-sm">
          Тут додамо: Generate/Regenerate key, Upgrade plan, та історію оплат (tx).
        </div>
      </section>
    </div>
  );
}