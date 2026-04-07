import { getTranslations } from "next-intl/server";

export default async function ExtensionComparison() {
  const t = await getTranslations("landingExtension.comparison");

  const left = [0, 1, 2, 3].map((i) => t(`left.items.${i}`));
  const right = [0, 1, 2, 3].map((i) => t(`right.items.${i}`));

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
          <div className="cardSoft p-5">
            <h3 className="text-lg font-black">{t("left.title")}</h3>
            <ul className="mt-4 space-y-3 text-sm muted">
              {left.map((item) => (
                <li key={item}>— {item}</li>
              ))}
            </ul>
          </div>

          <div className="card glow p-5">
            <h3 className="text-lg font-black">{t("right.title")}</h3>
            <ul className="mt-4 space-y-3 text-sm">
              {right.map((item) => (
                <li key={item}>— {item}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="cardSoft p-5">
          <p className="text-sm md:text-base leading-7">{t("bottomLine")}</p>
        </div>
      </div>
    </section>
  );
}