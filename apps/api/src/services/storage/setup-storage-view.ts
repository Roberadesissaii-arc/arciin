/**
 * The first-run wizard only needs enough to choose a folder.
 *
 * Full `StorageDiscovery` stays on authenticated settings routes.
 */

export type SetupStorageVolume = {
  id: string
  label: string
  arciinPath: string
  kind: "recommended" | "mount" | "runtime" | "os-root" | "custom" | "unmounted"
  totalBytes: number | null
  availableBytes: number | null
  writable: boolean
  recommended: boolean
  largeExternal: boolean
}

export type SetupUnmountedDevice = {
  id: string
  device: string
  name: string
  sizeLabel: string
  sizeBytes: number | null
  isLuks: boolean
  needsFormat?: boolean
  type: "disk" | "part"
  suggestedMountPoint: string
  suggestedArciinPath: string
}

export type SetupStorageDiscovery = {
  recommendedArciinPath: string
  isDockerRuntime: boolean
  volumes: SetupStorageVolume[]
  unmountedDevices: SetupUnmountedDevice[]
}

export function toSetupStorageDiscovery(discovery: {
  recommendedArciinPath: string
  isDockerRuntime: boolean
  volumes: Array<SetupStorageVolume & Record<string, unknown>>
  unmountedDevices: Array<SetupUnmountedDevice & Record<string, unknown>>
}): SetupStorageDiscovery {
  return {
    recommendedArciinPath: discovery.recommendedArciinPath,
    isDockerRuntime: discovery.isDockerRuntime,
    volumes: discovery.volumes.map((volume) => ({
      id: volume.id,
      label: volume.label,
      arciinPath: volume.arciinPath,
      kind: volume.kind,
      totalBytes: volume.totalBytes,
      availableBytes: volume.availableBytes,
      writable: volume.writable,
      recommended: volume.recommended,
      largeExternal: volume.largeExternal,
    })),
    unmountedDevices: discovery.unmountedDevices.map((device) => ({
      id: device.id,
      device: device.device,
      name: device.name,
      sizeLabel: device.sizeLabel,
      sizeBytes: device.sizeBytes,
      isLuks: device.isLuks,
      needsFormat: device.needsFormat,
      type: device.type,
      suggestedMountPoint: device.suggestedMountPoint,
      suggestedArciinPath: device.suggestedArciinPath,
    })),
  }
}
