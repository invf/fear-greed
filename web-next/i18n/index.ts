export const locales = ["uk", "en", "es", "de", "ru", "zh_CN", "zh_TW"] as const;
export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = "uk";

export function isLocale(x: string): x is AppLocale {
  return (locales as readonly string[]).includes(x);
}

export async function getMessages(locale: AppLocale) {
  return (await import(`../messages/${locale}.json`)).default;
}