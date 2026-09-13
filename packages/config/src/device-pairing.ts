import { randomInt } from "node:crypto"

/** Desktop / device connection protocol. Independent of APP_VERSION. */
export const ARCIIN_DEVICE_PROTOCOL_VERSION = 1

export const ARCIIN_DISCOVERY_SERVICE = "arciin" as const

export const ARCIIN_MDNS_SERVICE_TYPE = "_arciin._tcp"

export const ARCIIN_DISCOVERY_PATH = "/.well-known/arciin"

export const DEVICE_PAIRING_CODE_DIGITS = 6

export const DEVICE_PAIRING_CODE_TTL_MS = 5 * 60_000

export const DEVICE_PAIRING_MAX_ATTEMPTS = 5

/** Endpoint/IP cap for unauthenticated pairing claims. */
export const DEVICE_PAIR_RATE_LIMIT = { limit: 10, windowSec: 60 } as const

/** Endpoint/IP cap for device bootstrap. */
export const DEVICE_SESSION_RATE_LIMIT = { limit: 30, windowSec: 60 } as const

export const DEVICE_NAME_MAX_LENGTH = 80

export const DEVICE_CREDENTIAL_BYTES = 32

export const DEVICE_SESSION_TTL_MS = 12 * 60 * 60_000

/** Coalesce lastSeenAt writes. */
export const DEVICE_LAST_SEEN_THROTTLE_MS = 5 * 60_000

export const TRUSTED_DEVICE_COOKIE_NAME = "arciin_trusted_device"

export const DEVICE_PLATFORMS = [
  "windows",
  "macos",
  "linux",
  "ios",
  "android",
  "other",
] as const

export const DEVICE_TYPES = ["desktop", "laptop", "phone", "tablet", "other"] as const

export type DevicePlatformInput = (typeof DEVICE_PLATFORMS)[number]
export type DeviceTypeInput = (typeof DEVICE_TYPES)[number]

export function generateDevicePairingCode(): string {
  const max = 10 ** DEVICE_PAIRING_CODE_DIGITS
  return String(randomInt(0, max)).padStart(DEVICE_PAIRING_CODE_DIGITS, "0")
}

export function formatDevicePairingCode(code: string): string {
  const digits = code.replace(/\D/g, "").padStart(DEVICE_PAIRING_CODE_DIGITS, "0")
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)}`
}

export function normalizeDevicePairingCode(code: string): string | null {
  const digits = code.replace(/\D/g, "")
  if (digits.length !== DEVICE_PAIRING_CODE_DIGITS) return null
  return digits
}

export function discoveryManifestLooksUnsafe(serialized: string): boolean {
  return [
    "email",
    "password",
    "storageRoot",
    "licenseSignedToken",
    "licenseKey",
    "setupToken",
    "DATABASE_URL",
    "REDIS",
    "users",
    "libraries",
    "session",
  ].some((key) => serialized.includes(key))
}

export function buildMdnsAdvertisementRecord(input: {
  protocolVersion?: number
  path?: string
  serverId?: string | null
}): {
  serviceType: string
  txt: Record<string, string>
} {
  const txt: Record<string, string> = {
    protocol: String(input.protocolVersion ?? ARCIIN_DEVICE_PROTOCOL_VERSION),
    path: input.path ?? ARCIIN_DISCOVERY_PATH,
  }
  if (input.serverId) {
    txt.sid = input.serverId
  }
  return {
    serviceType: ARCIIN_MDNS_SERVICE_TYPE,
    txt,
  }
}
