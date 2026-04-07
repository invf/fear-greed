import { getTranslations } from "next-intl/server";

export default async function ExtensionHowItWorks() {
  const t = await getTranslations("landingExtension.howItWorks");

  const steps = [0, 1, 2].map((i) => ({
    kicker: t(`steps.${i}.kicker`),
    title: t(`steps.${i}.title`),
    text: t(`steps.${i}.text`),
  }));

  return (
    <section className="containerMax px-4 py-6">
      <div className="card p-6 md:p-8">
        <div>
          <div className="kicker">{t("kicker")}</div>
          <h2 className="mt-2 text-3xl md:text-4xl font-black leading-tight">
            {t("title")}
          </h2>
          <p className="mt-3 muted max-w-2xl">{t("subtitle")}</p>
        </div>

        <div className="mt-6 grid md:grid-cols-3 gap-4">
          {steps.map((step) => (
            <div key={step.title} className="cardSoft p-5">
              <div className="kicker">{step.kicker}</div>
              <h3 className="mt-2 text-lg font-black leading-snug">{step.title}</h3>
              <p className="mt-3 text-sm leading-7 muted">{step.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}