import "../globals.css";
import type { Metadata } from "next";

import { NextIntlClientProvider } from "next-intl";
import { getMessages, isLocale, defaultLocale } from "../../i18n";
import { getTranslations } from "next-intl/server";

import Header from "@/components/Header";
import Footer from "@/components/Footer";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://fear-greed-one.vercel.app";

const ALL_LOCALES = ["uk", "en", "es", "de", "ru", "zh-CN", "zh-TW"] as const;
type LocaleKey = (typeof ALL_LOCALES)[number];

function safeLocale(input: string): LocaleKey {
  return (isLocale(input) ? input : defaultLocale) as LocaleKey;
}

/**
 * ✅ Dynamic SEO per locale
 * Next 15: params is Promise -> await it
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const lc = safeLocale(locale);

  // We keep meta strings in messages under "meta" namespace
  const t = await getTranslations({ locale: lc, namespace: "meta" });

  const title = t("title");
  const description = t("description");

  // Alternate language URLs (home)
  const languages: Record<string, string> = {};
  for (const l of ALL_LOCALES) {
    languages[l] = `${SITE_URL}/${l}`;
  }

  return {
    title,
    description,
    metadataBase: new URL(SITE_URL),
    alternates: {
      canonical: `${SITE_URL}/${lc}`,
      languages,
    },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/${lc}`,
      siteName: "Fear & Greed • Crypto Panel",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const lc = safeLocale(locale);
  const messages = await getMessages(lc);

  return (
    <html lang={lc}>
      <body>
        <NextIntlClientProvider locale={lc} messages={messages}>
          <Header />
          <main className="containerMax px-4 py-6">{children}</main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}