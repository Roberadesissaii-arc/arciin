import type { PrismaClient } from "@prisma/client"

/**
 * When the owner's second factor is required rather than merely recommended.
 *
 * The policy is deliberately asymmetric. An instance that already exists must
 * not have its owner locked out by an upgrade — they are prompted, firmly, but
 * they can still sign in and they can still use the server on their own
 * network. Putting the server on the public internet is the moment the
 * password stops being the only thing between a stranger and the library, and
 * that is where enrolment becomes a requirement rather than advice.
 *
 * Nothing here can permanently switch enforcement off. There is no bypass flag
 * to find, because a bypass flag is the first thing worth attacking.
 */

export type OwnerMfaState = {
  ownerExists: boolean
  ownerHasMfa: boolean
  /** True once the owner has enrolled — sign-in then requires a code. */
  enforcedForOwner: boolean
}

export async function readOwnerMfaState(prisma: PrismaClient): Promise<OwnerMfaState> {
  const owner = await prisma.user.findFirst({
    where: { role: "OWNER", status: "ACTIVE" },
    select: { mfaEnabledAt: true },
    orderBy: { createdAt: "asc" },
  })

  const ownerHasMfa = Boolean(owner?.mfaEnabledAt)
  return {
    ownerExists: Boolean(owner),
    ownerHasMfa,
    // Enforcement follows enrolment rather than a separate switch, so the two
    // cannot disagree and there is no state where MFA is set up but ignored.
    enforcedForOwner: ownerHasMfa,
  }
}

export type PublicAccessVerdict =
  | { allowed: true }
  | { allowed: false; code: "OWNER_MFA_REQUIRED"; message: string }

/**
 * Whether public Remote Access may be turned on.
 *
 * LAN-only operation is unaffected: this is checked when opening the door to
 * the internet, not when using the server at home.
 */
export async function canEnablePublicRemoteAccess(
  prisma: PrismaClient,
): Promise<PublicAccessVerdict> {
  const state = await readOwnerMfaState(prisma)
  if (!state.ownerExists || state.ownerHasMfa) return { allowed: true }

  return {
    allowed: false,
    code: "OWNER_MFA_REQUIRED",
    message:
      "Set up two-factor authentication before enabling public Remote Access. " +
      "Settings → Two-factor authentication. Your server stays reachable on your own network in the meantime.",
  }
}
