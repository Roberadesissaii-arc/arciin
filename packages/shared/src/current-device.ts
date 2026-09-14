/**
 * Current paired Device is always taken from the authenticated session.
 * Never trust a client-supplied device id, IP, User-Agent, or hostname.
 *
 * Desktop self-heal: after this Desktop has bootstrapped its trusted Device and
 * the user has a valid session, compare GET /api/auth/me session.pairedDeviceId
 * to this Desktop Device.id. Match → session is correct. Null or a different id
 * → clear only the user session cookie and sign in again. Do not revoke the
 * Device, delete its credential, or re-pair. The next login already has the
 * trusted-device cookie, so the new session becomes device-bound.
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
