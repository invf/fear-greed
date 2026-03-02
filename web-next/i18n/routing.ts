import {defineRouting} from "next-intl/routing";

export const routing = defineRouting({
  locales: ["uk", "en", "es", "de", "ru", "zh_CN", "zh_TW"] as const,
  defaultLocale: "uk"
});

export type AppLocale = (typeof routing.locales)[number];