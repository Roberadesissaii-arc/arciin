import type { PrismaClient } from "@prisma/client"

import { apiConfig } from "@/config"
import { customOriginFromPublicUrl, setTrustedCustomPublicOrigin } from "@/plugins/cors-origins"
import { readOwnerMfaState } from "@/services/security/owner-mfa-policy"

type Log = { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void }

export type CustomPublicOriginState =
  | { trusted: true; origin: string; publicHost: boolean }
  | { trusted: false; reason: string }

/**
 * Decide whether a stored public URL becomes a trusted browser origin.
 *
 * A custom domain on the public internet is public Remote Access by another
 * route — the owner's own proxy or tunnel instead of Arciin's quick tunnel —
 * so it follows the same rule the v1.1.0 release set for every public path:
 * the owner's second factor must be enrolled. It does not need a paid plan:
 * the plan buys the tunnel helper, and running your own domain or reverse
 * proxy is part of Free. A LAN or private hostname needs neither.
 */
export function decideCustomPublicOrigin(
  publicUrl: string | null | undefined,
  ownerHasMfa: boolean,
  isProduction = apiConfig.isProduction,
): CustomPublicOriginState {
  const parsed = customOriginFromPublicUrl(publicUrl, { isProduction })
  if (parsed.origin === null) return { trusted: false, reason: parsed.reason }
  if (parsed.publicHost && !ownerHasMfa) return { trusted: false, reason: "owner-mfa-required" }
  return { trusted: true, origin: parsed.origin, publicHost: parsed.publicHost }
}

/**
 * Load InstanceConfig.publicUrl into the CORS runtime state.
 *
 * Called at startup and after anything that can change the answer: a Settings
 * save of the public URL, and the owner enrolling in or removing two-factor
 * authentication. Never throws — a failed read or a malformed stored value
 * leaves nothing extra trusted, and the instance keeps running.
 */
export async function refreshTrustedCustomPublicOrigin(
  prisma: PrismaClient,
  log?: Log,
): Promise<CustomPublicOriginState> {
  let state: CustomPublicOriginState
  try {
    const [instance, mfa] = await Promise.all([
      prisma.instanceConfig.findFirst({ select: { publicUrl: true } }),
      readOwnerMfaState(prisma),
    ])
    state = decideCustomPublicOrigin(instance?.publicUrl, mfa.ownerHasMfa)
  } catch (error) {
    state = { trusted: false, reason: "read-failed" }
    log?.warn({ err: error instanceof Error ? error.message : String(error) }, "Custom public origin could not be loaded; none trusted")
  }
  applyCustomPublicOriginState(state, log)
  return state
}

/** Set the runtime trust from a decision already made (e.g. from the row just written). */
export function applyCustomPublicOriginState(state: CustomPublicOriginState, log?: Log): void {
  setTrustedCustomPublicOrigin(state.trusted ? state.origin : null)
  if (state.trusted) {
    log?.info({ origin: state.origin }, "Custom public domain trusted for sign-in")
  } else if (state.reason !== "empty" && state.reason !== "quick-tunnel") {
    // Only reasons worth an operator's attention; never the stored value itself.
    log?.warn({ reason: state.reason }, "Configured public URL is not trusted as a browser origin")
  }
}
