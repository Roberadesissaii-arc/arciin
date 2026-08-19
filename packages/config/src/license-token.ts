/**
 * Hosted license token format (license.arciin.com).
 * Signed by the license server; verified by self-hosted instances.
 *
 * Format: arclic.v3.<base64url(json)>.<base64url(ed25519)>   ← current
 *         arclic.v2.<base64url(json)>.<base64url(hmac-sha256)> ← legacy
 *
 * v3 signs `arclic.v3.<body>` — the version travels inside the signed input, so
 * a token cannot be replayed as a different version by rewriting its header.
 */

import { createHmac, createHash, randomBytes, timingSafeEqual, type KeyObject } from "node:crypto"

import { featuresForPlan, type LicenseFeatureId, type LicensePlanId, isLicensePlanId } from "./entitlements"
import { keyDisplayPrefix, normalizeLicenseKey } from "./license"
import {
  LICENSE_TOKEN_ALG,
  signLicensePayload,
  verifyLicenseSignature,
  type LicenseKeyId,
  type LicensePublicKeyRegistry,
} from "./license-signing"

export const LICENSE_TOKEN_PREFIX = "arclic"
/** Version emitted by this build. v2 is still accepted on the way in. */
export const LICENSE_TOKEN_VERSION = "v3"
export const LICENSE_TOKEN_VERSION_LEGACY = "v2"

/**
 * Payload embedded in hosted license tokens.
 *
 * Field names and meanings are identical across v2 and v3 — only the signature
 * changed — so everything downstream of verification is version-agnostic. v3
 * adds `alg` and `kid` so the verifier knows which key to check against and
 * rotation stays additive.
 */
export type HostedLicenseTokenPayload = {
  v: 2 | 3
  licenseId: string
  plan: LicensePlanId
  status: "active" | "inactive" | "expired" | "revoked" | "grace"
  instanceId: string
  features: LicenseFeatureId[]
  serverLimit: number
  keyPrefix: string
  issuedAt: string
  expiresAt: string | null
  graceUntil: string | null
  /** Customer-facing activation id on the license server. */
  activationId?: string
  /** v3 only: signature algorithm. */
  alg?: typeof LICENSE_TOKEN_ALG
  /** v3 only: which signing key produced this token. */
  kid?: LicenseKeyId
}

export function defaultLicenseSigningSecret(): string {
  return "arciin-dev-license-signing-secret-change-me"
}

export function hashLicenseKey(rawKey: string): string {
  return createHash("sha256").update(normalizeLicenseKey(rawKey), "utf8").digest("hex")
}

/**
 * Customer-facing license key.
 *
 * Production keys are `arc_<plan>_<32 hex chars>` — 128 bits of CSPRNG. The
 * plan appears for human recognition only; the database record is the sole
 * authority on what a key entitles, and nothing parses the plan back out of the
 * visible string to make an entitlement decision.
 *
 * `kind: "demo"` keeps the old `arc_demo_<plan>_…` shape for the local
 * prototype portal, which must stay distinguishable from a real purchase.
 */
export function generateHostedLicenseKey(
  plan: LicensePlanId,
  kind: "lic" | "demo" = "lic",
): string {
  const suffix = randomBytes(16).toString("hex")
  return kind === "demo" ? `arc_demo_${plan}_${suffix}` : `arc_${plan}_${suffix}`
}

/** Shape check for anything that should be routed to the hosted authority. */
export function looksLikeHostedLicenseKey(rawKey: string): boolean {
  return /^ARC_(FREE|PRO|TEAM|BUSINESS|LIC|DEMO)_/i.test(rawKey.trim())
}

export function serverLimitNumber(plan: LicensePlanId, override?: number): number {
  if (typeof override === "number" && override > 0) return override
  if (plan === "business") return 99
  if (plan === "team") return 3
  return 1
}

function encodeBody(payload: HostedLicenseTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

/**
 * Decode and sanity-check a token body. Callers must have verified the
 * signature first — this only rejects payloads that are structurally wrong.
 */
function decodeBody(
  body: string,
  expectedVersion: 2 | 3,
  options?: { expectedInstanceId?: string },
): HostedLicenseTokenPayload | null {
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as HostedLicenseTokenPayload
    if (payload.v !== expectedVersion) return null
    if (!isLicensePlanId(payload.plan)) return null
    if (!Array.isArray(payload.features)) return null
    if (options?.expectedInstanceId && payload.instanceId !== options.expectedInstanceId) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

/** Legacy HMAC signing. Retained only to exercise the v2 acceptance path. */
export function signHostedLicenseTokenV2(
  payload: HostedLicenseTokenPayload,
  secret: string,
): string {
  const body = encodeBody({ ...payload, v: 2, alg: undefined, kid: undefined })
  const sig = createHmac("sha256", secret).update(body).digest("base64url")
  return `${LICENSE_TOKEN_PREFIX}.${LICENSE_TOKEN_VERSION_LEGACY}.${body}.${sig}`
}

/** @deprecated v2 HMAC signing — use {@link signHostedLicenseToken}. */
export const signHostedLicenseTokenLegacy = signHostedLicenseTokenV2

/**
 * Sign a v3 entitlement token with the vendor's Ed25519 private key.
 *
 * Only the license server can call this meaningfully; a self-hosted instance
 * has public keys only, which is the entire point of the format.
 */
export function signHostedLicenseToken(
  payload: HostedLicenseTokenPayload,
  privateKey: KeyObject,
  kid: LicenseKeyId,
): string {
  const body = encodeBody({ ...payload, v: 3, alg: LICENSE_TOKEN_ALG, kid })
  const signingInput = `${LICENSE_TOKEN_PREFIX}.${LICENSE_TOKEN_VERSION}.${body}`
  const sig = signLicensePayload(signingInput, privateKey)
  return `${signingInput}.${sig}`
}

export type VerifyLicenseTokenOptions = {
  expectedInstanceId?: string
  /** kid → public key. Required to accept v3 tokens. */
  publicKeys?: LicensePublicKeyRegistry
  /**
   * Legacy shared secret. Supplied only while an instance is still holding a
   * v2 token from before the Ed25519 migration; omit it and v2 is rejected.
   */
  legacyHmacSecret?: string | null
}

/**
 * Verify an entitlement token of either version.
 *
 * Dispatches on the version segment, so a v2 token can never be verified with
 * v3 rules or vice versa. Returns the payload, or null for anything that fails
 * — malformed, wrong version, unknown kid, tampered body, bad signature, or
 * bound to a different instance.
 */
export function verifyHostedLicenseToken(
  token: string,
  options?: VerifyLicenseTokenOptions,
): HostedLicenseTokenPayload | null {
  const parts = token.split(".")
  if (parts.length !== 4 || parts[0] !== LICENSE_TOKEN_PREFIX) return null

  const version = parts[1]
  const body = parts[2]!
  const sig = parts[3]!

  if (version === LICENSE_TOKEN_VERSION) {
    const registry = options?.publicKeys
    if (!registry) return null
    // The kid lives in the body, which is not yet trusted — but reading it only
    // selects a candidate key. A wrong or attacker-chosen kid simply fails the
    // signature check below.
    const unverified = decodeBody(body, 3)
    if (!unverified?.kid) return null
    const publicKey = registry.get(unverified.kid)
    if (!publicKey) return null
    if (unverified.alg !== LICENSE_TOKEN_ALG) return null
    const signingInput = `${LICENSE_TOKEN_PREFIX}.${LICENSE_TOKEN_VERSION}.${body}`
    if (!verifyLicenseSignature(signingInput, sig, publicKey)) return null
    return decodeBody(body, 3, options)
  }

  if (version === LICENSE_TOKEN_VERSION_LEGACY) {
    const secret = options?.legacyHmacSecret
    if (!secret) return null
    const expected = createHmac("sha256", secret).update(body).digest("base64url")
    try {
      const a = Buffer.from(sig)
      const b = Buffer.from(expected)
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    } catch {
      return null
    }
    return decodeBody(body, 2, options)
  }

  return null
}

/** Version segment of a token, without verifying it. For migration decisions. */
export function licenseTokenVersion(token: string): 2 | 3 | null {
  const parts = token.split(".")
  if (parts.length !== 4 || parts[0] !== LICENSE_TOKEN_PREFIX) return null
  if (parts[1] === LICENSE_TOKEN_VERSION) return 3
  if (parts[1] === LICENSE_TOKEN_VERSION_LEGACY) return 2
  return null
}

export function buildHostedTokenPayload(input: {
  licenseId: string
  plan: LicensePlanId
  status: HostedLicenseTokenPayload["status"]
  instanceId: string
  serverLimit: number
  keyPrefix: string
  expiresAt: Date | string | null
  graceUntil: Date | string | null
  activationId?: string
  issuedAt?: Date
}): HostedLicenseTokenPayload {
  const expiresAt =
    input.expiresAt instanceof Date
      ? input.expiresAt.toISOString()
      : input.expiresAt
  const graceUntil =
    input.graceUntil instanceof Date
      ? input.graceUntil.toISOString()
      : input.graceUntil

  return {
    v: 3,
    licenseId: input.licenseId,
    plan: input.plan,
    status: input.status,
    instanceId: input.instanceId,
    features: [...featuresForPlan(input.plan)] as LicenseFeatureId[],
    serverLimit: input.serverLimit,
    keyPrefix: input.keyPrefix || keyDisplayPrefix(input.licenseId),
    issuedAt: (input.issuedAt ?? new Date()).toISOString(),
    expiresAt,
    graceUntil,
    activationId: input.activationId,
  }
}

export type LicenseServerActivateResponse = {
  token: string
  payload: HostedLicenseTokenPayload
  license: {
    id: string
    plan: LicensePlanId
    status: string
    serverLimit: number
    expiresAt: string | null
    graceDays: number
    keyPrefix: string
  }
  activation: {
    id: string
    instanceId: string
    instanceName: string | null
    lastCheckInAt: string | null
    activatedAt: string
  }
  servers: {
    activated: number
    limit: number
  }
}

export type LicenseServerDemoResponse = {
  licenseKey: string
  license: {
    id: string
    plan: LicensePlanId
    status: string
    serverLimit: number
    expiresAt: string | null
    graceDays: number
    keyPrefix: string
    createdAt: string
  }
  customer: {
    id: string
    name: string
    email: string
  }
}

export type LicenseServerStatusResponse = {
  license: {
    id: string
    plan: LicensePlanId
    status: string
    serverLimit: number
    expiresAt: string | null
    graceDays: number
    keyPrefix: string
    createdAt: string
  }
  customer: {
    id: string
    name: string
    email: string
  } | null
  activations: Array<{
    id: string
    instanceId: string
    instanceName: string | null
    instanceVersion: string | null
    hostname: string | null
    lastCheckInAt: string | null
    activatedAt: string
    deactivatedAt: string | null
    active: boolean
  }>
  servers: {
    activated: number
    limit: number
  }
}
