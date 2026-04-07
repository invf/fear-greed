import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import HeroPreview from "@/components/HeroPreview";

const CHROME_STORE_URL =
  process.env.NEXT_PUBLIC_CHROME_STORE_URL ||
  "https://chromewebstore.google.com/detail/hojdloiangngafadoiihffnknnjbebmm";

export default async function ExtensionHero() {
  const t = await getTranslations("landingExtension.hero");
  const locale = await getLocale();

  return (
    <section className="containerMax px-4 py-6">
      <div className="card glow p-6 md:p-8">
        <div className="grid md:grid-cols-2 gap-6 items-center relative">
          <div>
            <div className="badge kicker">{t("kicker")}</div>

            <h1 className="mt-2 text-4xl md:text-5xl font-black leading-tight">
              {t("title")}
            </h1>

            <p className="mt-4 text-base md:text-lg muted max-w-xl">
              {t("subtitle")}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={CHROME_STORE_URL}
                target="_blank"
                rel="noreferrer"
                className="btn btnPrimary"
              >
                {t("ctaPrimary")}
              </a>

              <Link href={`/${locale}/pricing`} className="btn btnGhost">
                {t("ctaSecondary")}
              </Link>
            </div>

            <p className="mt-4 muted text-sm">{t("trustLine")}</p>
          </div>

          <div>
            <HeroPreview />
          </div>
        </div>
      </div>
    </section>
  );
}