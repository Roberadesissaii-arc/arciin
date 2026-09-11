import { timingSafeEqual } from "node:crypto"

import type { FastifyReply, FastifyRequest } from "fastify"

import { apiConfig } from "@/config"

/** Header the first-run wizard sends. Never accepted from the query string. */
export const SETUP_TOKEN_HEADER = "x-arciin-setup-token"

/** Length-safe compare so a guess cannot leak the token via timing. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Setup credential from a trusted request location.
 *
 * Header is preferred. POST body `setupToken` is accepted so prepare can share
 * the claim payload shape. Query-string tokens are ignored on purpose — they
 * land in access logs and browser history.
 */
export function extractSetupToken(request: FastifyRequest): string | null {
  const header = request.headers[SETUP_TOKEN_HEADER]
  if (typeof header === "string" && header.trim()) return header.trim()
  if (Array.isArray(header)) {
    const first = header.find((value) => typeof value === "string" && value.trim())
    if (first) return first.trim()
  }

  const body = request.body
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const token = (body as { setupToken?: unknown }).setupToken
    if (typeof token === "string" && token.trim()) return token.trim()
  }

  return null
}

export type SetupAuthorization =
  | { ok: true }
  | { ok: false; status: 401 | 403; code: "SETUP_TOKEN_REQUIRED" | "INVALID_SETUP_TOKEN" }

export function evaluateSetupAuthorization(request: FastifyRequest): SetupAuthorization {
  const provided = extractSetupToken(request)
  if (!provided) {
    return { ok: false, status: 401, code: "SETUP_TOKEN_REQUIRED" }
  }
  if (!constantTimeEqual(provided, apiConfig.setupToken)) {
    return { ok: false, status: 403, code: "INVALID_SETUP_TOKEN" }
  }
  return { ok: true }
}

export async function requireSetupAuthorization(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const result = evaluateSetupAuthorization(request)
  if (result.ok) return true

  const message =
    result.code === "SETUP_TOKEN_REQUIRED"
      ? "A setup token is required before this instance is claimed."
      : "The setup token is invalid."

  reply.status(result.status).send({
    error: { code: result.code, message },
  })
  return false
}
