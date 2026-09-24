import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { authenticator } from "otplib"

/**
 * TOTP second factor.
 *
 * The algorithm comes from otplib rather than being written here: RFC 6238 is
 * easy to get subtly wrong, and a subtly wrong second factor is worse than an
 * honest absence of one.
 *
 * Two properties this module owns rather than delegates:
 *
 *   - the accepted window is one step either side, no wider. Each extra step
 *     is another thirty seconds in which a shoulder-surfed code still works.
 *   - a code is accepted once. otplib will happily verify the same code twice
 *     inside its window, so the caller records the step that was accepted and
 *     refuses anything at or below it.
 */

/** 30-second steps, ±1 step of clock tolerance. */
export const TOTP_STEP_SECONDS = 30
export const TOTP_WINDOW_STEPS = 1

authenticator.options = {
  step: TOTP_STEP_SECONDS,
  window: TOTP_WINDOW_STEPS,
}

export const RECOVERY_CODE_COUNT = 10

/** Base32 secret for a new enrolment. Never persisted in the clear. */
export function generateTotpSecret(): string {
  return authenticator.generateSecret()
}

/** The otpauth:// URI an authenticator app scans. */
export function buildOtpAuthUri(input: {
  secret: string
  accountName: string
  issuer: string
}): string {
  return authenticator.keyuri(input.accountName, input.issuer, input.secret)
}

/** Which 30-second step a moment falls in. Used to refuse a replayed code. */
export function totpStepFor(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS)
}

export type TotpCheck =
  | { ok: true; step: number }
  | { ok: false; reason: "malformed" | "invalid" | "replayed" }

/**
 * Verify a submitted code.
 *
 * `lastUsedStep` is the step of the last code this account accepted. A code
 * from that step or earlier is refused even when otplib considers it valid,
 * which is what stops the same six digits being replayed inside its window.
 */
export function verifyTotp(input: {
  token: string
  secret: string
  lastUsedStep: number | null
  atMs?: number
}): TotpCheck {
  const token = input.token.replace(/\s+/g, "")
  if (!/^\d{6}$/.test(token)) return { ok: false, reason: "malformed" }

  let valid = false
  try {
    valid = authenticator.check(token, input.secret)
  } catch {
    return { ok: false, reason: "invalid" }
  }
  if (!valid) return { ok: false, reason: "invalid" }

  const step = totpStepFor(input.atMs)
  if (input.lastUsedStep !== null && step <= input.lastUsedStep) {
    return { ok: false, reason: "replayed" }
  }
  return { ok: true, step }
}

/**
 * Recovery codes.
 *
 * Generated together, shown once, stored only as hashes. A plain SHA-256 is
 * the right tool here and Argon2 is not: these are 80 bits of machine-chosen
 * randomness, not a human-chosen password, so there is nothing to slow a
 * guesser down for.
 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(10).toString("hex").toUpperCase()
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`
  })
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-F0-9]/g, "")
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex")
}

/** Compare two hashes without leaking where they diverge. */
export function recoveryCodeHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
