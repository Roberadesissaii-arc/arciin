/** How long a mobile connection code stays valid (minutes). */
export const MOBILE_PAIRING_CODE_TTL_MINUTES = 10

/** Mobile session lifetime after successful pair (days). */
export const MOBILE_PAIRING_SESSION_DAYS = 90

export const MOBILE_DISCOVER_SERVICE_ID = "arciin" as const

/** Stored in Session.userAgent for mobile app logins (`Arciin Mobile · iPhone`). */
export const MOBILE_SESSION_USER_AGENT_PREFIX = "Arciin Mobile"
