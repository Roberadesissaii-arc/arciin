export type DeviceStatus = "ACTIVE" | "REVOKED"

export type DevicePairingStatus = "PENDING" | "CLAIMED" | "CANCELLED" | "EXPIRED"

export type DevicePlatform = "WINDOWS" | "MACOS" | "LINUX" | "IOS" | "ANDROID" | "OTHER"

export type DeviceType = "DESKTOP" | "LAPTOP" | "PHONE" | "TABLET" | "OTHER"

export type ArciinDiscoveryManifest = {
  service: "arciin"
  protocolVersion: number
  serverId: string
  instanceName: string
  version: string
  pairingSupported: boolean
  pairingAvailable: boolean
  webUrl: string
  mdns: {
    serviceType: string
    advertised: boolean
  }
}

export type PairedDevicePublic = {
  id: string
  name: string
  platform: DevicePlatform
  deviceType: DeviceType
  status: DeviceStatus
  pairedAt: string
  lastSeenAt: string | null
  appVersion: string | null
  protocolVersion: number
}

export type DevicePairResult = {
  device: Pick<PairedDevicePublic, "id" | "name" | "platform" | "status" | "deviceType">
  credential: string
}

export type DeviceSessionResult = {
  device: Pick<PairedDevicePublic, "id" | "name" | "platform" | "status">
  expiresAt: string
}

export type DeviceSettingsSnapshot = {
  devices: PairedDevicePublic[]
  pairing: {
    expiresAt: string
    createdAt: string
  } | null
  ttlMinutes: number
  protocolVersion: number
  instanceName: string
  localUrl: string | null
  mdns: {
    serviceType: string
    advertised: boolean
  }
}
