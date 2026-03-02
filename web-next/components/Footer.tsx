import { getTranslations } from "next-intl/server";

export default async function Footer() {
  const t = await getTranslations("footer");

  return (
    <footer className="border-t" style={{ borderColor: "rgba(43,49,57,0.9)" }}>
      <div className="max-w-5xl mx-auto px-4 py-6 text-sm muted">
        © {new Date().getFullYear()} {t("copyright")}
      </div>
    </footer>
  );
}