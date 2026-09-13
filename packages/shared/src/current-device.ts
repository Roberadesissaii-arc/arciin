/**
 * Current paired Device is always taken from the authenticated session.
 * Never trust a client-supplied device id, IP, User-Agent, or hostname.
 */

export const DEVICE_RECENTLY_SEEN_MS = 10 * 60 * 1000

export function resolveCurrentDeviceId(
  pairedDeviceId: string | null | undefined,
  activeDeviceIds: readonly string[],
): string | null {
  if (!pairedDeviceId) return null
  return activeDeviceIds.includes(pairedDeviceId) ? pairedDeviceId : null
}

export type DevicePresence = "connected" | "active" | "trusted"

export function resolveDevicePresence(input: {
  isCurrentDevice: boolean
  lastSeenAt: Date | string | null
  now?: number
}): DevicePresence {
  if (input.isCurrentDevice) return "connected"
  if (!input.lastSeenAt) return "trusted"
  const then = new Date(input.lastSeenAt).getTime()
  if (!Number.isFinite(then)) return "trusted"
  const now = input.now ?? Date.now()
  return now - then <= DEVICE_RECENTLY_SEEN_MS ? "active" : "trusted"
}

export function devicePresenceLabel(presence: DevicePresence): string {
  switch (presence) {
    case "connected":
      return "Connected"
    case "active":
      return "Active"
    case "trusted":
      return "Trusted"
  }
}
