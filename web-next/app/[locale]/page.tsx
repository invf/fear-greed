import PlanCard from "@/components/PlanCard";
import HeroPreview from "@/components/HeroPreview";

const CHROME_STORE_URL =
  process.env.NEXT_PUBLIC_CHROME_STORE_URL || "https://chromewebstore.google.com/";

export default function HomePage() {
  return (
    <div className="space-y-6">
      {/* HERO */}
      <section className="card glow p-6 md:p-8">
        <div className="grid md:grid-cols-2 gap-6 items-center">
          <div>
            <div className="kicker">Extension for Binance / TradingView</div>
            <h1 className="mt-2 text-4xl md:text-5xl font-black leading-tight">
              Fear &amp; Greed <span className="gradText">Risk Panel</span>
              <br />
              прямо на графіку
            </h1>

            <p className="mt-4 muted text-base leading-relaxed">
              Multi-timeframe sentiment (15m/1h/4h/1d), Risk score 0–100, ліміти по плану та
              швидка валідація API ключа — усе в одному sidepanel.
            </p>

            <div className="mt-6 flex gap-3 flex-wrap">
              <a
                className="btn btnPrimary"
                href={CHROME_STORE_URL}
                target="_blank"
                rel="noreferrer"
              >
                Install Extension
              </a>
              <a className="btn" href="/pricing">
                View Pricing
              </a>
              <a className="btn btnGhost" href="/dashboard">
                Dashboard
              </a>
            </div>

            <div className="mt-5 flex gap-2 flex-wrap">
              <span className="badge">
                <span className="kicker" style={{ margin: 0 }}>
                  LIVE
                </span>
                <span className="muted text-sm font-extrabold">Quota / Plan sync</span>
              </span>
              <span className="badge" style={{ borderColor: "rgba(14,203,129,0.25)" }}>
                <span className="kicker" style={{ margin: 0 }}>
                  WEB3
                </span>
                <span className="muted text-sm font-extrabold">MetaMask billing ready</span>
              </span>
            </div>
          </div>

          {/* ULTRA PRO VIDEO PREVIEW */}
          <HeroPreview />
        </div>
      </section>

      {/* FEATURES */}
      <section className="grid md:grid-cols-3 gap-4">
        {[
          ["Multi-timeframe sentiment", "Швидко бачиш настрої ринку на 4 таймфреймах."],
          ["Risk score engine", "Єдиний бал 0–100 з поясненням (E, Spread, імпульс)."],
          ["Plans + quota", "Free/Pro/VIP: ліміти, used/limit, прозорий апгрейд."],
        ].map(([t, d]) => (
          <div key={t} className="card p-5">
            <div className="kicker">Feature</div>
            <div className="mt-2 text-xl font-black">{t}</div>
            <div className="mt-2 muted text-sm leading-relaxed">{d}</div>
          </div>
        ))}
      </section>

      {/* PRICING PREVIEW */}
      <section className="card p-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="kicker">Plans</div>
            <div className="mt-2 text-3xl font-black">Choose your quota</div>
            <div className="mt-2 muted text-sm">
              Сайт = маркетинг + білінг + керування ключем. Extension = продукт.
            </div>
          </div>

          <a className="btn btnPrimary" href="/pricing">
            Open Pricing
          </a>
        </div>

        <div className="mt-5 grid md:grid-cols-3 gap-4">
          <PlanCard
            name="Free"
            price="$0"
            perks={["Daily free limit", "Basic access", "Try the panel"]}
            cta={{ label: "Install Extension", href: "/" }}
          />
          <PlanCard
            name="Pro"
            price="$9 / mo"
            perks={["Higher quota", "Best for daily trading", "Fast validate + quota"]}
            cta={{ label: "Get PRO", href: "/pricing" }}
            highlight
          />
          <PlanCard
            name="VIP"
            price="$29 / mo"
            perks={["Very high quota", "Priority API", "Heavy usage"]}
            cta={{ label: "Get VIP", href: "/pricing" }}
          />
        </div>
      </section>
    </div>
  );
}