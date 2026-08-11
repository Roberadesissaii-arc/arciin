import { createHmac, scryptSync, timingSafeEqual } from "node:crypto"

import { apiConfig } from "@/config"

/**
 * Short-lived, single-asset tokens for `<video>` / `<audio>` / `<img>` URLs.
 *
 * Media elements cannot send an Authorization header, so the credential has to
 * travel in the query string — where it ends up in browser history, in a
 * Referer, and in any screenshot or shared link. Today that credential is the
 * full session token, and the API accepts `?access_token=` on *every*
 * authenticated route, so one leaked video URL is account takeover.
 *
 * These tokens are scoped to one asset and expire in minutes, so a leak costs
 * that asset for that window instead of the account.
 *
 * Stateless by design: an HMAC over `assetId|userId|exp` needs no table, no
 * Redis, and no revocation list. The tradeoff is that a minted token cannot be
 * withdrawn early — acceptable at this lifetime, and the reason the lifetime is
 * short.
 */

const KEY_LEN = 32
const VERSION = "v1"

/** Long enough to start a long video, short enough that a leaked URL rots fast. */
export const MEDIA_TOKEN_TTL_SECONDS = 15 * 60

/**
 * Downloads of large originals can outlive playback tokens on a slow link, and
 * a stalled download restarting from zero is worse than the marginal exposure.
 */
export const MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS = 60 * 60

export type MediaTokenScope = "stream" | "download"

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  // Same material as the other subkeys, with its own domain salt so a media
  // token can never be replayed as a vault or webhook secret.
  const material = apiConfig.ARCIIN_ENCRYPTION_KEY ?? apiConfig.SESSION_SECRET
  cachedKey = scryptSync(material, "arciin-media-token-v1", KEY_LEN)
  return cachedKey
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function payloadOf(assetId: string, userId: string, scope: MediaTokenScope, exp: number): string {
  return `${VERSION}.${assetId}.${userId}.${scope}.${exp}`
}

function sign(payload: string): string {
  return base64url(createHmac("sha256", getKey()).update(payload).digest())
}

export type SignedMediaToken = {
  token: string
  expiresAt: string
}

export function signMediaToken(input: {
  assetId: string
  userId: string
  scope?: MediaTokenScope
  ttlSeconds?: number
}): SignedMediaToken {
  const scope = input.scope ?? "stream"
  const ttl =
    input.ttlSeconds ??
    (scope === "download" ? MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS : MEDIA_TOKEN_TTL_SECONDS)
  const exp = Math.floor(Date.now() / 1000) + ttl
  const payload = payloadOf(input.assetId, input.userId, scope, exp)
  return {
    // The user id travels in the token because the request carries no other
    // credential. It is not a secret, and it cannot be swapped: the signature
    // covers it. The asset id is not repeated — the verifier takes that from
    // the route it is serving, which is what binds the token to one asset.
    token: `${VERSION}.${scope}.${exp}.${base64url(input.userId)}.${sign(payload)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  }
}

export type MediaTokenVerification =
  | { ok: true; userId: string; scope: MediaTokenScope }
  | { ok: false; reason: "malformed" | "expired" | "invalid" }

/** Verify a token against the asset being served. */
export function verifyMediaToken(input: {
  token: string
  assetId: string
}): MediaTokenVerification {
  const parts = input.token.split(".")
  if (parts.length !== 5) return { ok: false, reason: "malformed" }

  const [version, scope, expRaw, userRaw, signature] = parts as [
    string, string, string, string, string,
  ]
  if (version !== VERSION) return { ok: false, reason: "malformed" }
  if (scope !== "stream" && scope !== "download") return { ok: false, reason: "malformed" }

  const exp = Number.parseInt(expRaw, 10)
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" }
  if (exp * 1000 <= Date.now()) return { ok: false, reason: "expired" }

  let userId: string
  try {
    userId = Buffer.from(userRaw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
  } catch {
    return { ok: false, reason: "malformed" }
  }
  if (!userId) return { ok: false, reason: "malformed" }

  const expected = sign(payloadOf(input.assetId, userId, scope, exp))
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid" }
  }

  return { ok: true, userId, scope }
}
