import type { Device } from "@prisma/client"
import type { FastifyRequest } from "fastify"

import {
  extractDeviceAuthorization,
  readTrustedDeviceCookie,
} from "@/services/devices/device-cookie"
import {
  findActiveDeviceByCredential,
  resolveDeviceSessionToken,
} from "@/services/devices/pairing"

/**
 * Resolve a previously paired device from the Device credential header or
 * the short-lived trusted-device cookie. This is not user authentication.
 */
export async function resolveTrustedPairedDevice(
  request: FastifyRequest,
): Promise<Device | null> {
  const credential = extractDeviceAuthorization(request)
  if (credential) {
    try {
      return await findActiveDeviceByCredential(request.server.prisma, credential)
    } catch {
      return null
    }
  }

  const cookie = readTrustedDeviceCookie(request)
  if (!cookie) return null
  return resolveDeviceSessionToken(request.server.prisma, cookie)
}
