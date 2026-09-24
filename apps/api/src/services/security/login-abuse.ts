/**
 * Keys and timings for login abuse control.
 *
 * Deliberately free of imports so the rules can be asserted on their own,
 * without a Fastify instance, a database or Redis.
 */

/** How long a failure counter lives, in seconds. */
export const FAIL_WINDOW_SEC = 900

/** Longest artificial delay applied to a failed attempt, in milliseconds. */
export const MAX_BACKOFF_MS = 2_000

/**
 * Failures from one client, for one account.
 *
 * The lock lives here rather than on the email alone. Keyed on the email by
 * itself, anyone who knew the owner's address could hold the account locked
 * for as long as they cared to keep posting wrong passwords: ten failures
 * inside the window denied every subsequent attempt, including the correct
 * password from the owner's own machine, and the per-IP ceiling of twenty a
 * minute left an attacker ample room to keep it topped up. An unauthenticated
 * stranger could switch the instance off.
 *
 * Counting per client means the lock falls on whoever is failing. The owner at
 * another address is unaffected.
 */
export function failKey(email: string, clientIp: string): string {
  return `arciin:login-fails:${email.toLowerCase()}:${clientIp}`
}

/**
 * Failures against one account from anywhere.
 *
 * This one never denies a request. It only decides how long a failed attempt
 * is made to wait, so an attacker spreading attempts across many addresses
 * still gets slower while the owner keeps a working front door.
 */
export function accountKey(email: string): string {
  return `arciin:login-fails-account:${email.toLowerCase()}`
}

/** Exponential, capped, and applied only after a failure. */
export function backoffMs(accountFailures: number): number {
  if (accountFailures <= 1) return 0
  return Math.min(2 ** (accountFailures - 1) * 100, MAX_BACKOFF_MS)
}
