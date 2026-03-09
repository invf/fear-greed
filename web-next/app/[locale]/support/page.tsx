import {getTranslations} from "next-intl/server";

export default async function SupportPage() {
  const t = await getTranslations("support");

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <div className="max-w-3xl">

        <h1 className="text-3xl font-semibold mb-6">
          {t("title")}
        </h1>

        <p className="mb-8">{t("subtitle")}</p>

        <h2 className="text-xl font-semibold mt-8 mb-3">
          {t("contactTitle")}
        </h2>

        <p>
          <a
            href="mailto:support@sentipulse.app"
            className="underline"
          >
            support@sentipulse.app
          </a>
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">
          {t("faqTitle")}
        </h2>

        <ul className="space-y-3 list-disc pl-6">
          <li>{t("faq1")}</li>
          <li>{t("faq2")}</li>
          <li>{t("faq3")}</li>
          <li>{t("faq4")}</li>
        </ul>

      </div>
    </main>
  );
}