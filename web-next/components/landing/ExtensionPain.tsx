import { getTranslations } from "next-intl/server";

export default async function ExtensionPain() {
  const t = await getTranslations("landingExtension.pain");

  const items = [
    { title: t("items.0.title"), text: t("items.0.text") },
    { title: t("items.1.title"), text: t("items.1.text") },
    { title: t("items.2.title"), text: t("items.2.text") },
  ];

  return (
    <section className="containerMax px-4 py-6">
      <div className="space-y-6">
        <div>
          <div className="kicker">{t("kicker")}</div>
          <h2 className="mt-2 text-3xl md:text-4xl font-black leading-tight">
            {t("title")}
          </h2>
          <p className="mt-3 muted max-w-2xl">{t("subtitle")}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {items.map((item) => (
            <div key={item.title} className="cardSoft p-5">
              <h3 className="text-lg font-black leading-snug">{item.title}</h3>
              <p className="mt-3 text-sm leading-7 muted">{item.text}</p>
            </div>
          ))}
        </div>

        <div className="cardSoft p-5">
          <p className="text-sm md:text-base leading-7">{t("bottomLine")}</p>
        </div>
      </div>
    </section>
  );
}