/**
 * Where "get a license" / "view plans" sends someone from a running instance.
 *
 * Public website (pricing + checkout) is the product surface — same pages as
 * the Arciin_web marketing site. Account portal is separate and must not steal
 * pricing links (do not point NEXT_PUBLIC_ARCIIN_ACCOUNT_URL at a local portal
 * URL — that previously broke every upgrade CTA).
 *
 * The default is the real domain. It was arciin.vercel.app while the custom
 * domain was still being set up, which meant every "get a license" and "view
 * plans" button in a customer's instance pointed at a deployment URL rather
 * than the product — and told them so in the button text.
 * NEXT_PUBLIC_ARCIIN_WEBSITE_URL still overrides it for development.
 */

const DEFAULT_WEBSITE = "https://arciin.com"

function websiteBase(): string {
  const configured = process.env.NEXT_PUBLIC_ARCIIN_WEBSITE_URL
  return (configured || DEFAULT_WEBSITE).replace(/\/$/, "")
}

function accountBase(): string {
  const configured = process.env.NEXT_PUBLIC_ARCIIN_ACCOUNT_URL
  if (configured?.trim()) return configured.replace(/\/$/, "")
  return `${websiteBase()}/account`
}

/** Hostname for UI copy (“view plans on arciin.com”). */
export function websiteHostLabel(): string {
  try {
    return new URL(websiteBase()).host
  } catch {
    return "arciin.com"
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
