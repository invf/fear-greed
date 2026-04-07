import { getTranslations } from "next-intl/server";

export default async function ExtensionFAQ() {
  const t = await getTranslations("landingExtension.faq");

  const items = [0, 1, 2, 3].map((i) => ({
    q: t(`items.${i}.q`),
    a: t(`items.${i}.a`),
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

        <div className="card overflow-hidden">
          {items.map((item, index) => (
            <div
              key={item.q}
              className={`p-5 ${
                index !== items.length - 1
                  ? "border-b border-[rgba(43,49,57,0.75)]"
                  : ""
              }`}
            >
              <h3 className="text-base md:text-lg font-black leading-snug">
                {item.q}
              </h3>
              <p className="mt-3 text-sm leading-7 muted">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}