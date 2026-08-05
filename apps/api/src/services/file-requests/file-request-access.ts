/**
 * Resolving a File Request from its public token.
 *
 * Everything a public upload needs — instance, library, folder, owner — is read
 * from the row this returns. The public request body contributes files and
 * submitter details and nothing else. That is the entire security model, and it
 * only works if no caller anywhere reads a destination from user input.
 */

import { randomBytes, timingSafeEqual } from "node:crypto"

import type { FileRequest, Folder, Library } from "@prisma/client"
import type { FastifyInstance } from "fastify"

import { checkFileRequestAvailability, type FileRequestAvailabilityCode } from "@arciin/shared"

import { hashToken, hashPassword, verifyPassword } from "@/services/security/auth"

export function generateFileRequestToken() {
  // 24 random bytes = 192 bits. Not guessable, and short enough to paste.
  const rawToken = `frq_${randomBytes(24).toString("base64url")}`
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    tokenPrefix: rawToken.slice(0, 12),
  }
}

export async function hashAccessCode(code: string): Promise<string> {
  return hashPassword(code)
}

/**
 * Access-code check.
 *
 * Argon2 verification is already constant-time with respect to the code, but
 * the *absence* of a hash is not: returning early on "no code configured" would
 * answer instantly while a wrong code takes ~100ms, which tells an attacker
 * whether a code exists. The dummy verify keeps both paths expensive.
 */
const DUMMY_ARGON2_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$T7VD4dMxDs0lE1SoZ+kCzGYVSPKGvS8xJ7DBEUFEPbo"

export async function verifyAccessCode(
  storedHash: string | null,
  supplied: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) {
    // No code required. Still burn a verify so timing does not disclose that.
    await verifyPassword(supplied ?? "x", DUMMY_ARGON2_HASH).catch(() => false)
    return true
  }
  if (!supplied) {
    await verifyPassword("x", DUMMY_ARGON2_HASH).catch(() => false)
    return false
  }
  return verifyPassword(supplied, storedHash).catch(() => false)
}

/** Constant-time string compare for non-secret-derived comparisons. */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export type ResolvedFileRequest = FileRequest & {
  destinationFolder: Folder
  destinationLibrary: Library & { storageLocationId: string }
}

export async function resolveFileRequestByToken(
  fastify: FastifyInstance,
  rawToken: string,
): Promise<
  | { ok: true; request: ResolvedFileRequest }
  | { ok: false; code: FileRequestAvailabilityCode }
> {
  const tokenHash = hashToken(rawToken.trim())

  const request = await fastify.prisma.fileRequest.findUnique({
    where: { tokenHash },
    include: {
      destinationFolder: true,
      destinationLibrary: true,
    },
  })

  const availability = checkFileRequestAvailability({
    exists: Boolean(request),
    status: request?.status,
    revokedAt: request?.revokedAt,
    expiresAt: request?.expiresAt,
    maxFileCount: request?.maxFileCount,
    maxTotalBytes: request?.maxTotalBytes,
    currentFileCount: request?.currentFileCount,
    currentBytes: request?.currentBytes,
    destinationFolder: request?.destinationFolder ?? null,
    destinationLibrary: request?.destinationLibrary ?? null,
  })

  if (!availability.available) {
    return { ok: false, code: availability.code }
  }

  return { ok: true, request: request as ResolvedFileRequest }
}

/**
 * Public error shape.
 *
 * REVOKED / EXPIRED / LIMIT_REACHED are told to the recipient because they are
 * actionable — "ask the owner for a new link" is a useful answer. NOT_FOUND
 * covers both "no such link" and "the folder behind it is gone", and must stay
 * indistinguishable so a recipient cannot probe for links that once existed.
 */
export function publicFileRequestError(code: FileRequestAvailabilityCode) {
  switch (code) {
    case "REVOKED":
      return {
        status: 410,
        body: {
          error: { code: "REQUEST_REVOKED", message: "This upload link has been turned off." },
        },
      }
    case "EXPIRED":
      return {
        status: 410,
        body: { error: { code: "REQUEST_EXPIRED", message: "This upload link has expired." } },
      }
    case "LIMIT_REACHED":
      return {
        status: 409,
        body: {
          error: {
            code: "REQUEST_LIMIT_REACHED",
            message: "This upload link has reached its limit.",
          },
        },
      }
    default:
      return {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "This upload link is not available." } },
      }
  }
}
