/**
 * Asymmetric signing for hosted entitlement tokens.
 *
 * The v2 format signed tokens with HMAC-SHA256 under a secret that both the
 * license server and every self-hosted instance had to hold. That is not a
 * licensing scheme: whoever can verify can also sign, so any customer holding
 * the verification secret could mint themselves a Business token offline. It
 * also could not work in practice — `install.sh` generated a *random* verify
 * secret per install, so a vendor-signed token never matched.
 *
 * v3 uses Ed25519. The license server holds the private key; self-hosted
 * instances ship only public keys. A public verification key in open-source
 * code is exactly where a public key belongs.
 *
 * Keys are carried as base64url of the raw 32-byte Ed25519 scalar (the `x` /
 * `d` values of the JWK form) so they survive an environment variable intact.
 */

import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto"

export const LICENSE_TOKEN_ALG = "EdDSA" as const

/** Identifies which signing key produced a token, so keys can be rotated. */
export type LicenseKeyId = string

export type LicensePublicKeyEntry = {
  kid: LicenseKeyId
  /** base64url of the raw 32-byte Ed25519 public key. */
  publicKey: string
  /**
   * Set once a key is no longer used for signing. Retired keys stay in the
   * registry so tokens they signed keep verifying until they expire.
   */
  retiredAt?: string
}

/**
 * Public verification keys shipped with self-hosted Arciin.
 *
 * Rotation is additive: publish key B here, point the license server at B's
 * private half, let A-signed tokens age out through normal refresh, then delete
 * A's entry in a later release. Never remove a key while tokens it signed can
 * still be presented.
 */
export const LICENSE_PUBLIC_KEYS: readonly LicensePublicKeyEntry[] = [
  {
    kid: "arciin-lic-2026-01",
    publicKey: "n7SyyKmZ-gGXH1O7iYfdHdlifWNp4NwhgAfevJoxjps",
  },
]

const KEY_B64URL = /^[A-Za-z0-9_-]{43}$/

function assertKeyMaterial(value: string, label: string): string {
  const trimmed = value.trim()
  if (!KEY_B64URL.test(trimmed)) {
    throw new Error(
      `${label} must be base64url of a raw 32-byte Ed25519 key (43 characters). Generate one with: pnpm license:keygen`,
    )
  }
  return trimmed
}

export function parseLicensePublicKey(base64url: string): KeyObject {
  const x = assertKeyMaterial(base64url, "License public key")
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" })
}

/**
 * Private keys never reach a customer machine — this is called only inside the
 * license server, from an environment variable that is not in the repository.
 */
export function parseLicensePrivateKey(base64url: string): KeyObject {
  const d = assertKeyMaterial(base64url, "License signing key")
  const key = createPrivateKey({
    key: { kty: "OKP", crv: "Ed25519", d, x: derivePublicComponent(d) },
    format: "jwk",
  })
  return key
}

/**
 * Node needs `x` alongside `d` to import an Ed25519 JWK, but the public half is
 * derivable from the private scalar — so callers only have to carry one value.
 */
function derivePublicComponent(d: string): string {
  // Import via PKCS8 (which needs only the seed) and export the public half.
  const seed = Buffer.from(d, "base64url")
  const pkcs8 = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ])
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" })
  const jwk = createPublicKey(privateKey).export({ format: "jwk" }) as { x?: string }
  if (!jwk.x) throw new Error("Could not derive the public half of the license signing key.")
  return jwk.x
}

/** Public half of a signing key, for publishing into the registry. */
export function licensePublicKeyFromPrivate(base64urlPrivate: string): string {
  return derivePublicComponent(assertKeyMaterial(base64urlPrivate, "License signing key"))
}

export function signLicensePayload(signingInput: string, privateKey: KeyObject): string {
  return sign(null, Buffer.from(signingInput, "utf8"), privateKey).toString("base64url")
}

export function verifyLicenseSignature(
  signingInput: string,
  signature: string,
  publicKey: KeyObject,
): boolean {
  let sig: Buffer
  try {
    sig = Buffer.from(signature, "base64url")
  } catch {
    return false
  }
  // Ed25519 signatures are always 64 bytes; reject early rather than letting
  // `verify` decide, so malformed input cannot be mistaken for a bad key.
  if (sig.length !== 64) return false
  try {
    return verify(null, Buffer.from(signingInput, "utf8"), publicKey, sig)
  } catch {
    return false
  }
}

/** kid → parsed key, built once and reused. Parsing is not free. */
export type LicensePublicKeyRegistry = Map<LicenseKeyId, KeyObject>

export function buildPublicKeyRegistry(
  entries: readonly LicensePublicKeyEntry[] = LICENSE_PUBLIC_KEYS,
): LicensePublicKeyRegistry {
  const registry: LicensePublicKeyRegistry = new Map()
  for (const entry of entries) {
    registry.set(entry.kid, parseLicensePublicKey(entry.publicKey))
  }
  return registry
}

let defaultRegistry: LicensePublicKeyRegistry | null = null

/**
 * The registry shipped with this build, plus anything supplied through
 * `ARCIIN_LICENSE_PUBLIC_KEYS` (`kid:key,kid:key`). The override exists so a
 * self-hoster running against their own licensing authority — or a test — can
 * verify tokens without patching the binary.
 */
export function defaultPublicKeyRegistry(extraKeys?: string | null): LicensePublicKeyRegistry {
  if (!extraKeys) {
    if (!defaultRegistry) defaultRegistry = buildPublicKeyRegistry()
    return defaultRegistry
  }
  const registry = buildPublicKeyRegistry()
  for (const pair of extraKeys.split(",")) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(":")
    if (idx <= 0) {
      throw new Error("ARCIIN_LICENSE_PUBLIC_KEYS entries must be formatted as kid:publicKey.")
    }
    registry.set(trimmed.slice(0, idx).trim(), parseLicensePublicKey(trimmed.slice(idx + 1)))
  }
  return registry
}

/** Test seam: forget the cached registry. */
export function resetPublicKeyRegistryCache(): void {
  defaultRegistry = null
}
