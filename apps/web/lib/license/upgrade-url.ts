/**
 * Where "get a license" / "view plans" sends someone from a running instance.
 *
 * Public website (pricing + checkout) is the product surface — same pages as
 * the Arciin_web marketing site. Account portal is separate and must not steal
 * pricing links (do not point NEXT_PUBLIC_ARCIIN_ACCOUNT_URL at a local portal
 * URL — that previously broke every upgrade CTA).
 *
 * During development the marketing site is on Vercel. Switch
 * NEXT_PUBLIC_ARCIIN_WEBSITE_URL to https://arciin.com when the custom domain
 * is live.
 */

const DEFAULT_WEBSITE = "https://arciin.vercel.app"

function websiteBase(): string {
  const configured = process.env.NEXT_PUBLIC_ARCIIN_WEBSITE_URL
  return (configured || DEFAULT_WEBSITE).replace(/\/$/, "")
}

function accountBase(): string {
  const configured = process.env.NEXT_PUBLIC_ARCIIN_ACCOUNT_URL
  if (configured?.trim()) return configured.replace(/\/$/, "")
  return `${websiteBase()}/account`
}

/** Hostname for UI copy (“view plans on arciin.vercel.app”). */
export function websiteHostLabel(): string {
  try {
    return new URL(websiteBase()).host
  } catch {
    return "arciin.vercel.app"
  }
}

/** Plan browsing on the public site. */
export function pricingUrl(): string {
  return `${websiteBase()}/pricing`
}

/** Direct checkout intent for Pro / Team. */
export function checkoutUrl(plan: "pro" | "team" | "business"): string {
  return `${websiteBase()}/checkout?plan=${plan}`
}

/** Customer account portal (licenses already purchased). */
export function accountUrl(): string {
  return accountBase()
}
