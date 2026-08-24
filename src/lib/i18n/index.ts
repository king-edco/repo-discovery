import { en, type Messages } from "./en";

// i18n foundation. English is the default and only locale for now; adding a
// locale = new dictionary file + an entry in `dictionaries` + the locale code
// in `locales`. Locale selection (cookie/Accept-Language/route segment) plugs
// into `resolveLocale` later without touching components.

export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

const dictionaries: Record<Locale, Messages> = { en };

export function resolveLocale(hint?: string | null): Locale {
  return hint === "en" ? "en" : defaultLocale;
}

export function getMessages(locale?: string | null): Messages {
  return dictionaries[resolveLocale(locale)];
}

export type { Messages };
