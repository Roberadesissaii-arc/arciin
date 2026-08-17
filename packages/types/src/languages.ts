/**
 * Languages a transcript can be translated into.
 *
 * Tags only. The names come from `Intl.DisplayNames`, which every runtime here
 * already ships, so this list never has to carry — or keep correct — a label
 * per language per locale. A reader in French sees French names for free.
 *
 * Deliberately broad rather than the handful the UI happens to demo. Arciin is
 * self-hosted and its users are not all in one place; Amharic and Oromo matter
 * as much here as Spanish.
 */

export const TRANSLATION_LANGUAGE_TAGS = [
  "af", "am", "ar", "az", "be", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de",
  "el", "en", "eo", "es", "et", "eu", "fa", "fi", "fil", "fr", "ga", "gl", "gu",
  "ha", "he", "hi", "hr", "hu", "hy", "id", "ig", "is", "it", "ja", "jv", "ka",
  "kk", "km", "kn", "ko", "ku", "ky", "lo", "lt", "lv", "mk", "ml", "mn", "mr",
  "ms", "mt", "my", "ne", "nl", "no", "ny", "om", "pa", "pl", "ps", "pt", "ro",
  "ru", "rw", "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "st", "su", "sv",
  "sw", "ta", "te", "tg", "th", "ti", "tk", "tr", "tt", "ug", "uk", "ur", "uz",
  "vi", "xh", "yi", "yo", "zh", "zu",
] as const

export type TranslationLanguageTag = (typeof TRANSLATION_LANGUAGE_TAGS)[number]

/**
 * A readable name for a tag: "am" → "Amharic".
 *
 * Falls back to the tag itself rather than guessing, because showing a wrong
 * language name is worse than showing a code the user can look up.
 */
export function languageName(tag: string | null | undefined, locale?: string): string {
  if (!tag) return ""
  try {
    const display = new Intl.DisplayNames(locale ? [locale] : undefined, {
      type: "language",
    }).of(tag)
    if (display && display.toLowerCase() !== tag.toLowerCase()) return display
  } catch {
    /* unknown or unsupported tag — show it as given */
  }
  return tag
}

/** The selector's options, sorted by how they read rather than by tag. */
export function translationLanguageOptions(
  locale?: string,
): { tag: string; name: string }[] {
  return TRANSLATION_LANGUAGE_TAGS.map((tag) => ({ tag, name: languageName(tag, locale) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Whether two tags mean the same language.
 *
 * Compares the primary subtag, so "en-GB" and "en" are the same language and
 * translating between them is a request worth refusing before it is paid for.
 */
export function isSameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const base = (tag: string) => tag.trim().toLowerCase().split(/[-_]/)[0]
  return base(a) === base(b)
}
