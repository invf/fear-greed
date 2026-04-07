import { getTranslations } from "next-intl/server";

const CHROME_STORE_URL =
  process.env.NEXT_PUBLIC_CHROME_STORE_URL ||
  "https://chromewebstore.google.com/detail/hojdloiangngafadoiihffnknnjbebmm";

export default async function ExtensionCTA() {
  const t = await getTranslations("landingExtension.cta");

  return (
    <section className="containerMax px-4 py-6">
      <div className="card glow p-6 md:p-8">
        <h2 className="text-3xl md:text-4xl font-black leading-tight max-w-3xl">
          {t("title")}
        </h2>

        <p className="mt-4 text-base md:text-lg muted max-w-2xl">
          {t("subtitle")}
        </p>

        <div className="mt-6">
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noreferrer"
            className="btn btnPrimary"
          >
            {t("button")}
          </a>
        </div>

        <p className="mt-4 text-sm muted">{t("note")}</p>
      </div>
    </section>
  );
}