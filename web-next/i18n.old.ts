import { notFound } from "next/navigation";

export const locales = ["uk", "en", "es", "de", "ru", "zh_CN", "zh_TW"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "uk";

export function isLocale(v: string): v is Locale {
  return (locales as readonly string[]).includes(v);
}

export async function getMessages(locale: string) {
  if (!isLocale(locale)) notFound();
  return (await import(`./messages/${locale}.json`)).default;
}