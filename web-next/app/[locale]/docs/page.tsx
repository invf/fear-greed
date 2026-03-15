import Link from "next/link";
import { getTranslations } from "next-intl/server";

export const metadata = {
  title: "Docs • Fear & Greed",
  description: "How to install the extension, get an API key, and troubleshoot common issues."
};

const CHROME_STORE_URL =
  process.env.NEXT_PUBLIC_CHROME_STORE_URL || "https://chromewebstore.google.com/detail/hojdloiangngafadoiihffnknnjbebmm";

function Card({
  title,
  kicker,
  children
}: {
  title: string;
  kicker?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      {kicker ? <div className="kicker">{kicker}</div> : null}
      <div className="mt-2 text-xl font-black">{title}</div>
      <div className="mt-3 muted text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function Step({
  n,
  title,
  children,
  stepLabel
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  stepLabel: string;
}) {
  return (
    <div className="card p-5">
      <div className="kicker">
        {stepLabel} {n}
      </div>
      <div className="mt-2 text-lg font-black">{title}</div>
      <div className="mt-3 muted text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function CodeBox({ children }: { children: React.ReactNode }) {
  return (
    <pre
      className="card p-4"
      style={{
        background: "rgba(11,14,17,0.45)",
        borderColor: "rgba(43,49,57,0.85)",
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        lineHeight: 1.4
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

export default async function DocsPage() {
  const t = await getTranslations("docs");

  return (
    <div className="space-y-6">
      {/* HERO */}
      <section className="card glow p-6 md:p-8">
        <div className="kicker">{t("hero.kicker")}</div>
        <h1 className="mt-2 text-4xl md:text-5xl font-black leading-tight">
          {t("hero.title")} <span className="gradText">{t("hero.titleAccent")}</span>
        </h1>
        <p className="mt-4 muted text-base leading-relaxed max-w-2xl">
          {t("hero.subtitle")}
        </p>

        <div className="mt-6 flex gap-3 flex-wrap">
          <a className="btn btnPrimary" href={CHROME_STORE_URL} target="_blank" rel="noreferrer">
            {t("hero.install")}
          </a>
          <Link className="btn" href="/pricing">
            {t("hero.pricing")}
          </Link>

        </div>
      </section>

      {/* QUICK START */}
      <section className="card p-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="kicker">{t("quick.kicker")}</div>
            <div className="mt-2 text-3xl font-black">{t("quick.title")}</div>
            <div className="mt-2 muted text-sm">{t("quick.subtitle")}</div>
          </div>

          <span className="badge">
            <span className="kicker" style={{ margin: 0 }}>
              {t("badge.tip")}
            </span>
            <span className="muted text-sm font-extrabold">{t("badge.tipText")}</span>
          </span>
        </div>

        <div className="mt-5 grid md:grid-cols-3 gap-4">
          <Step n={1} stepLabel={t("stepLabel")} title={t("steps.s1.title")}>
            {t("steps.s1.text")}
          </Step>

          <Step n={2} stepLabel={t("stepLabel")} title={t("steps.s2.title")}>
            {t("steps.s2.text")} <Link href="/pricing">{t("links.pricing")}</Link>.{" "}
            {t("steps.s2.text2")} <Link href="/dashboard">{t("links.dashboard")}</Link>.
          </Step>

          <Step n={3} stepLabel={t("stepLabel")} title={t("steps.s3.title")}>
            {t("steps.s3.text")}
          </Step>
        </div>
      </section>

      {/* WHERE IS SETTINGS */}
      <section className="grid md:grid-cols-2 gap-4">
        <Card kicker={t("cards.extension.kicker")} title={t("cards.extension.title")}>
          {t("cards.extension.text")}
        </Card>

        <Card kicker={t("cards.website.kicker")} title={t("cards.website.title")}>
          {t("cards.website.text")} <Link href="/dashboard">{t("links.dashboard")}</Link>.{" "}
          {t("cards.website.text2")} <Link href="/pricing">{t("links.pricing")}</Link>.
        </Card>
      </section>

      {/* TROUBLESHOOTING */}
      <section className="card p-6">
        <div className="kicker">{t("trouble.kicker")}</div>
        <div className="mt-2 text-3xl font-black">{t("trouble.title")}</div>

        <div className="mt-5 grid md:grid-cols-2 gap-4">
          <Card kicker={t("trouble.p1.kicker")} title={t("trouble.p1.title")}>
            {t("trouble.p1.text")}
          </Card>

          <Card kicker={t("trouble.p2.kicker")} title={t("trouble.p2.title")}>
            {t("trouble.p2.text")}
          </Card>

          <Card kicker={t("trouble.p3.kicker")} title={t("trouble.p3.title")}>
            {t("trouble.p3.text")} <Link href="/pricing">{t("links.pricing")}</Link>.
          </Card>

          <Card kicker={t("trouble.p4.kicker")} title={t("trouble.p4.title")}>
            {t("trouble.p4.text")}
          </Card>
        </div>

        <div className="mt-5">
          <div className="kicker">{t("example.kicker")}</div>
          <div className="mt-2 text-xl font-black">{t("example.title")}</div>
          <div className="mt-3 muted text-sm">{t("example.subtitle")}</div>

          <div className="mt-3">
            <CodeBox>
              {`{
  "valid": true,
  "plan": "PRO",
  "used": 3,
  "limit": 50,
  "remaining": 47,
  "day": "2026-02-23"
}`}
            </CodeBox>
          </div>
        </div>
      </section>

      {/* SECURITY */}
      <section className="grid md:grid-cols-2 gap-4">
        <Card kicker={t("security.s1.kicker")} title={t("security.s1.title")}>
          {t("security.s1.text")}
        </Card>

        <Card kicker={t("security.s2.kicker")} title={t("security.s2.title")}>
          {t("security.s2.text")}
        </Card>
      </section>

      {/* CTA */}
      <section className="card p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="kicker">{t("cta.kicker")}</div>
            <div className="mt-2 text-3xl font-black">{t("cta.title")}</div>
            <div className="mt-2 muted text-sm">{t("cta.subtitle")}</div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <Link className="btn btnPrimary" href="/pricing#checkout">
              {t("cta.goCheckout")}
            </Link>
            <a className="btn" href={CHROME_STORE_URL} target="_blank" rel="noreferrer">
              {t("cta.install")}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}