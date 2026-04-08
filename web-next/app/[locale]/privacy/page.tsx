import {getTranslations} from "next-intl/server";

export default async function PrivacyPage() {
  const t = await getTranslations("privacy");

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <div className="max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-semibold mb-4">
          {t("title")}
        </h1>

        <p className="muted mb-8">{t("updated")}</p>

        <div className="space-y-8 text-sm md:text-base leading-7">
          <section>
            <h2 className="text-xl font-semibold mb-3">{t("overviewTitle")}</h2>
            <p>{t("overviewText1")}</p>
            <p className="mt-3">{t("overviewText2")}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">{t("collectTitle")}</h2>

            <h3 className="text-lg font-medium mb-2">{t("apiKeyTitle")}</h3>
            <p>{t("apiKeyText")}</p>

            <h3 className="text-lg font-medium mt-5 mb-2">{t("installIdTitle")}</h3>
            <p>{t("installIdText")}</p>

            <h3 className="text-lg font-medium mt-5 mb-2">{t("websiteDataTitle")}</h3>
            <p>{t("websiteDataText")}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">{t("notCollectTitle")}</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t("notCollect1")}</li>
              <li>{t("notCollect2")}</li>
              <li>{t("notCollect3")}</li>
              <li>{t("notCollect4")}</li>
              <li>{t("notCollect5")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">{t("useTitle")}</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t("use1")}</li>
              <li>{t("use2")}</li>
              <li>{t("use3")}</li>
              <li>{t("use4")}</li>
              <li>{t("use5")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">{t("thirdPartyTitle")}</h2>
            <p>{t("thirdPartyText")}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">{t("disclaimerTitle")}</h2>
            <p>{t("disclaimerText1")}</p>
            <p className="mt-3">{t("disclaimerText2")}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">{t("termsTitle")}</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t("terms1")}</li>
              <li>{t("terms2")}</li>
              <li>{t("terms3")}</li>
              <li>{t("terms4")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">{t("securityTitle")}</h2>
            <p>{t("securityText")}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">{t("liabilityTitle")}</h2>
            <p>{t("liabilityText")}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">{t("changesTitle")}</h2>
            <p>{t("changesText")}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">{t("contactTitle")}</h2>
            <p>{t("contactText")}</p>
            <p className="mt-2">
              <a
                href="mailto:sentipulseapp@gmail.com"
                className="underline hover:no-underline"
              >
                sentipulseapp@gmail.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}