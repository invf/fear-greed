import {getTranslations} from "next-intl/server";

export default async function AboutPage() {
  const t = await getTranslations("about");

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <div className="max-w-3xl space-y-8">

        <h1 className="text-3xl md:text-4xl font-semibold">
          {t("title")}
        </h1>

        <p className="text-base leading-7">
          {t("intro")}
        </p>

        <section>
          <h2 className="text-xl font-semibold mb-3">
            {t("whatTitle")}
          </h2>

          <p className="leading-7">
            {t("whatText")}
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">
            {t("featuresTitle")}
          </h2>

          <ul className="list-disc pl-6 space-y-2">
            <li>{t("feature1")}</li>
            <li>{t("feature2")}</li>
            <li>{t("feature3")}</li>
            <li>{t("feature4")}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">
            {t("platformsTitle")}
          </h2>

          <ul className="list-disc pl-6 space-y-2">
            <li>Binance</li>
            <li>OKX</li>
            <li>Bybit</li>
            <li>TradingView</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">
            {t("disclaimerTitle")}
          </h2>

          <p className="leading-7">
            {t("disclaimerText")}
          </p>
        </section>

      </div>
    </main>
  );
}