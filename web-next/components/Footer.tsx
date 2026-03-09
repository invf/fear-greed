import Link from "next/link";
import {getLocale, getTranslations} from "next-intl/server";

export default async function Footer() {
  const t = await getTranslations("footer");
  const locale = await getLocale();

  return (
    <footer className="border-t" style={{ borderColor: "rgba(43,49,57,0.9)" }}>
      <div className="max-w-5xl mx-auto px-4 py-6 text-sm muted flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>© {new Date().getFullYear()} {t("copyright")}</div>

        <div className="flex gap-4">
          <Link href={`/${locale}/privacy`} className="hover:underline">
            {t("privacy")}
          </Link>
          <Link href={`/${locale}/support`} className="hover:underline">
            {t("support")}
          </Link>
          <Link href={`/${locale}/about`} className="hover:underline">
              {t("about")}
           </Link>
        </div>
      </div>
    </footer>
  );
}