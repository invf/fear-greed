import { getTranslations } from "next-intl/server";

export default async function ExtensionFeatures() {
  const t = await getTranslations("landingExtension.features");

  const features = [0, 1, 2, 3].map((i) => ({
    title: t(`items.${i}.title`),
    text: t(`items.${i}.text`),
  }));

  return (
    <section className="containerMax px-4 py-6">
      <div className="space-y-6">
        <div>
          <div className="kicker">{t("kicker")}</div>
          <h2 className="mt-2 text-3xl md:text-4xl font-black leading-tight">
            {t("title")}
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {features.map((feature) => (
            <div key={feature.title} className="card p-5">
              <h3 className="text-lg font-black leading-snug">{feature.title}</h3>
              <p className="mt-3 text-sm leading-7 muted">{feature.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}