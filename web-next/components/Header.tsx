"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

const CHROME_STORE_URL =
  process.env.NEXT_PUBLIC_CHROME_STORE_URL || "https://chromewebstore.google.com/";

type LocaleKey = "uk" | "en" | "es" | "de" | "ru" | "zh_CN" | "zh_TW";

const LOCALE_LABELS: Record<LocaleKey, string> = {
  uk: "Українська",
  en: "English",
  es: "Español",
  de: "Deutsch",
  ru: "Русский",
  zh_CN: "简体中文",
  zh_TW: "繁體中文",
};

function stripLocalePrefix(pathname: string) {
  return (pathname || "/").replace(/^\/(uk|en|es|de|ru|zh_CN|zh_TW)(?=\/|$)/, "") || "/";
}

export default function Header() {
  const t = useTranslations();
  const pathname = usePathname();
  const locale = useLocale() as LocaleKey;

  const nav = [
    { href: "/", key: "nav.home" },
    { href: "/pricing", key: "nav.pricing" },
    { href: "/docs", key: "nav.docs" },
  ] as const;

  const basePath = stripLocalePrefix(pathname);

  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{
        borderColor: "rgba(43,49,57,0.70)",
        background: "rgba(11,14,17,0.55)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="containerMax px-4 py-4 flex items-center justify-between gap-4">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-3">
          <span
            className="badge"
            style={{
              borderColor: "rgba(240,185,11,0.28)",
              background: "rgba(30,35,41,0.75)",
            }}
          >
            <span className="font-black gradText">{t("brand.title")}</span>
            <span className="muted text-sm font-extrabold">{t("brand.sub")}</span>
          </span>
        </Link>

        {/* NAV */}
        <nav className="flex items-center gap-2 flex-wrap justify-end">
          {nav.map((x) => {
            const active = basePath === x.href;

            return (
              <Link
                key={x.href}
                href={x.href}
                className={`btn text-sm ${active ? "" : "btnGhost"}`}
                style={
                  active
                    ? {
                        borderColor: "rgba(240,185,11,0.55)",
                        background: "rgba(240,185,11,0.14)",
                        boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
                      }
                    : undefined
                }
              >
                {t(x.key)}
              </Link>
            );
          })}

          {/* ⭐ New CTA */}
          <Link
            className="btn btnPrimary text-sm"
            href="/pricing#checkout"
            style={{ marginLeft: 6 }}
          >
            Get API Access
          </Link>

          {/* Install */}
          <a
            className="btn text-sm"
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              borderColor: "rgba(43,49,57,0.85)",
              background: "rgba(30,35,41,0.60)",
            }}
          >
            {t("nav.install")}
          </a>

          {/* Language dropdown */}
          {/* Language dropdown */}
            <div className="langWrap">
              <details className="langDetails">
                <summary className="btn btnGhost text-sm langSummary">
                  {LOCALE_LABELS[locale] ?? locale}
                  <span className="langArrow">▾</span>
                </summary>

                <div className="langMenu">
                  {(Object.keys(LOCALE_LABELS) as LocaleKey[]).map((lc) => {
                    const href = `/${lc}${basePath === "/" ? "" : basePath}`;
                    return (
                      <Link
                        key={lc}
                        href={href}
                        className={`langItem ${lc === locale ? "isActive" : ""}`}
                      >
                        <span className="langName">{LOCALE_LABELS[lc]}</span>
                      </Link>
                    );
                  })}
                </div>
              </details>
            </div>

          <style jsx>{`
              .langWrap{
                position: relative;
                margin-left: 6px;
              }

              .langDetails{
                position: relative;
              }

              .langSummary{
                display:flex;
                align-items:center;
                gap:8px;
                list-style:none;
              }

              .langSummary::-webkit-details-marker{
                display:none;
              }

              .langArrow{
                opacity:.6;
                font-size:12px;
              }

              /* 🔥 dropdown вниз */
              .langMenu{
                position:absolute;
                top: calc(100% + 10px);
                right: 0;

                display:flex;
                flex-direction: column;

                min-width: 240px;

                padding:8px;
                border-radius:14px;

                background: rgba(30,35,41,0.96);
                border:1px solid rgba(43,49,57,0.85);

                box-shadow: 0 22px 50px rgba(0,0,0,0.55);
                backdrop-filter: blur(14px);

                z-index: 9999;
                animation: langDrop .18s ease;
              }

              @keyframes langDrop{
                from{
                  opacity:0;
                  transform: translateY(-6px) scale(.98);
                }
                to{
                  opacity:1;
                  transform: translateY(0) scale(1);
                }
              }

              .langItem{
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:12px;

                padding:10px 12px;
                border-radius:12px;

                border:1px solid transparent;
                text-decoration:none;

                color: rgba(234,236,239,0.95);
                font-weight:800;
              }

              .langItem:hover{
                background: rgba(240,185,11,0.10);
                border-color: rgba(240,185,11,0.25);
              }

              .langItem.isActive{
                background: rgba(240,185,11,0.12);
                border-color: rgba(240,185,11,0.35);
              }

              .langName{
                font-weight:900;
              }


            `}</style>
        </nav>
      </div>
    </header>
  );
}