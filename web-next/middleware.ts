import createMiddleware from "next-intl/middleware";
import {routing} from "./i18n/routing";

export default createMiddleware(routing);

// Не чіпаємо _next, файли з розширеннями, assets
export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"]
};