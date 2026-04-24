import PlanCard from "@/components/PlanCard";
import CheckoutBox from "@/components/CheckoutBox";
import { getTranslations } from "next-intl/server";

export const metadata = {
  title: "Pricing • Fear & Greed",
  description: "Choose a plan and pay with MetaMask. Get your API key instantly."
};

function Step({
  n,
  title,
  text,
  stepLabel
}: {
  n: number;
  title: string;
  text: string;
  stepLabel: string;
}) {
  return (
    <div className="card p-5">
      <div className="kicker">
        {stepLabel} {n}
      </div>
      <div className="mt-2 text-xl font-black">{title}</div>
      <div className="mt-2 muted text-sm leading-relaxed">{text}</div>
    </div>
  );
}

export default async function PricingPage() {
  const t = await getTranslations("pricing");

  const PLANS = [
    {
      name: t("plans.free.name"),
      price: t("plans.free.price"),
      sub: t("plans.free.sub"),
      perks: [t("plans.free.p1"), t("plans.free.p2"), t("plans.free.p3")],
      cta: { label: t("plans.free.cta"), href: "/" }
    },
    {
      name: t("plans.pro.name"),
      price: t("plans.pro.price"),
      sub: t("plans.pro.sub"),
      perks: [t("plans.pro.p1"), t("plans.pro.p2"), t("plans.pro.p3"), t("plans.pro.p4"), t("plans.pro.p5")],
      cta: { label: t("plans.pro.cta"), href: "#checkout" },
      highlight: true
    },
    {
      name: t("plans.vip.name"),
      price: t("plans.vip.price"),
      sub: t("plans.vip.sub"),
      perks: [t("plans.vip.p1"), t("plans.vip.p2"), t("plans.vip.p3"), t("plans.vip.p4"), t("plans.vip.p5")],
      cta: { label: t("plans.vip.cta"), href: "#checkout" }
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="card glow p-6 md:p-8">
        <div className="kicker">{t("hero.kicker")}</div>
        <h1 className="mt-2 text-4xl md:text-5xl font-black leading-tight">
          {t("hero.title")} <span className="gradText">{t("hero.titleAccent")}</span>
        </h1>
        <p className="mt-4 muted text-base leading-relaxed max-w-2xl">
          {t("hero.subtitle")}
        </p>

        <div className="mt-6 flex gap-3 flex-wrap">
          <a className="btn btnPrimary" href="#plans">
            {t("hero.viewPlans")}
          </a>
          <a className="btn" href="#faq">
            {t("hero.faq")}
          </a>
          <a className="btn btnGhost" href="/">
            {t("hero.backHome")}
          </a>
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="card p-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="kicker">{t("plansSection.kicker")}</div>
            <div className="mt-2 text-3xl font-black">{t("plansSection.title")}</div>
            <div className="mt-2 muted text-sm">{t("plansSection.subtitle")}</div>
          </div>

          <span className="badge">
            <span className="kicker" style={{ margin: 0 }}>
              {t("badge.web3")}
            </span>
            <span className="muted text-sm font-extrabold">{t("badge.metamask")}</span>
          </span>
        </div>

        <div className="mt-5 grid md:grid-cols-3 gap-4">
          {PLANS.map((p) => (
            <PlanCard
              key={p.name}
              name={p.name}
              price={p.price}
              perks={p.perks}
              cta={p.cta}
              highlight={!!(p as any).highlight}
            />
          ))}
        </div>
      </section>

      {/* Checkout mock */}
      <section id="checkout" className="card p-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="kicker">{t("checkout.kicker")}</div>
            <div className="mt-2 text-3xl font-black">{t("checkout.title")}</div>
            <div className="mt-2 muted text-sm">{t("checkout.subtitle")}</div>
          </div>

          <span className="badge" style={{ borderColor: "rgba(240,185,11,0.45)" }}>
            <span className="kicker" style={{ margin: 0 }}>
              {t("badge.beta")}
            </span>
            <span className="muted text-sm font-extrabold">{t("badge.demo")}</span>
          </span>
        </div>

        <div className="mt-5 grid md:grid-cols-3 gap-4">
          <Step n={1} stepLabel={t("stepLabel")} title={t("steps.s1.title")} text={t("steps.s1.text")} />
          <Step n={2} stepLabel={t("stepLabel")} title={t("steps.s2.title")} text={t("steps.s2.text")} />
          <Step n={3} stepLabel={t("stepLabel")} title={t("steps.s3.title")} text={t("steps.s3.text")} />
        </div>

        <div className="mt-6">
          <CheckoutBox />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="card p-6">
        <div className="kicker">{t("faq.kicker")}</div>
        <div className="mt-2 text-3xl font-black">{t("faq.title")}</div>

        <div className="mt-5 grid md:grid-cols-2 gap-4">
          {[
            { q: t("faq.q1.q"), a: t("faq.q1.a") },
            { q: t("faq.q2.q"), a: t("faq.q2.a") },
            { q: t("faq.q3.q"), a: t("faq.q3.a") },
            { q: t("faq.q4.q"), a: t("faq.q4.a") }
          ].map((x) => (
            <div key={x.q} className="card p-5">
              <div className="text-lg font-black">{x.q}</div>
              <div className="mt-2 muted text-sm leading-relaxed">{x.a}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}