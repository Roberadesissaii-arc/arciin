/**
 * Where "get a license" sends someone from inside a running instance.
 *
 * Defaults to the public website, which is where checkout and license delivery
 * actually live. It used to point at `localhost:3010` — the local prototype
 * portal — which is not a thing any customer has.
 *
 * The override exists because self-hosting is the product: an operator running
 * their own licensing authority, or an internal deployment with a private
 * portal, should be able to point this at their own page.
 */
const DEFAULT_WEBSITE = "https://arciin.com"

function websiteBase(): string {
  const configured =
    process.env.NEXT_PUBLIC_ARCIIN_ACCOUNT_URL || process.env.NEXT_PUBLIC_ARCIIN_WEBSITE_URL
  return (configured || DEFAULT_WEBSITE).replace(/\/$/, "")
}

/** Plan browsing — the honest default when we do not know what they want. */
export function pricingUrl(): string {
  return `${websiteBase()}/pricing`
}

/** Direct intent, for an explicit "upgrade to Pro" affordance. */
export function checkoutUrl(plan: "pro" | "team"): string {
  return `${websiteBase()}/checkout?plan=${plan}`
}
