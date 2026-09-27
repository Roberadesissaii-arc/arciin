/**
 * Partial-update semantics for App Data row payloads.
 *
 * PATCH used to write `payload` wholesale, so an external app that sent
 * `{ payload: { price: 13.99 } }` to change one price lost the row's category
 * and its image reference — silently, with a 200.
 *
 * The rules, per property of the patch:
 *
 *   object + object  merged recursively
 *   array            replaces the whole array (arrays have no stable identity
 *                    to merge by, and element-wise merging surprises people)
 *   primitive        replaces
 *   null             stored as null — it is a value, not a deletion
 *   omitted          left exactly as it was
 *
 * To remove a key or replace the whole payload, use PUT.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Keys that must never be written through a merge, whatever the parser allowed. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
}

export function mergeRecordPayload(existing: unknown, patch: Record<string, unknown>): Record<string, Json> {
  const base: Record<string, unknown> = isPlainObject(existing) ? existing : {}
  return mergeObjects(base, patch) as Record<string, Json>
}

function mergeObjects(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(target)) {
    if (!FORBIDDEN_KEYS.has(key)) out[key] = value
  }
  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(key)) continue
    if (value === undefined) continue
    const current = out[key]
    out[key] = isPlainObject(value) && isPlainObject(current) ? mergeObjects(current, value) : value
  }
  return out
}
