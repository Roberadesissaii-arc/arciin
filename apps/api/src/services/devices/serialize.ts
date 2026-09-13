import type { Device } from "@prisma/client"
import type { PairedDevicePublic } from "@arciin/types"

export function serializePairedDevice(device: Device): PairedDevicePublic {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    deviceType: device.deviceType,
    status: device.status,
    pairedAt: device.pairedAt.toISOString(),
    lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
    appVersion: device.appVersion,
    protocolVersion: device.protocolVersion,
  }
}

export function serializePairedDeviceSummary(device: Device) {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    deviceType: device.deviceType,
    status: device.status,
  }
}
