/** Event types shown on /security only — excluded from the general Activity feed. */
const SECURITY_ACTIVITY_PREFIXES = ["auth.", "security."] as const

export function isSecurityActivityType(type: string): boolean {
  return SECURITY_ACTIVITY_PREFIXES.some((prefix) => type.startsWith(prefix))
}
