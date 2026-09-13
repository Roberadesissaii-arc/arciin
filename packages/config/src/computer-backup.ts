/** Computer backup protocol. Independent of pairing protocol and APP_VERSION. */
export const ARCIIN_COMPUTER_BACKUP_PROTOCOL_VERSION = 1

export const ARCIIN_SYNC_AUTHORIZATION_SCHEME = "ArciinSync"

export const COMPUTERS_LIBRARY_DEFINITION = {
  name: "Computers",
  slug: "computers",
  kind: "COMPUTER",
  icon: "computer",
} as const

export const BACKUP_CREDENTIAL_PREFIX = "arcsync_"
export const BACKUP_CREDENTIAL_BYTES = 32

export const BACKUP_HEARTBEAT_THROTTLE_MS = 60_000
export const BACKUP_GRANT_LAST_USED_THROTTLE_MS = 60_000

export const BACKUP_RELATIVE_PATH_MAX = 1024
export const BACKUP_PATH_SEGMENT_MAX = 255
export const BACKUP_PATH_DEPTH_MAX = 32
export const BACKUP_DISPLAY_NAME_MAX = 120
export const BACKUP_CLIENT_ENTRY_ID_MAX = 128
export const BACKUP_SOURCE_PATH_ID_MAX = 128
export const BACKUP_OPERATION_ID_MAX = 128

export const BACKUP_ENABLE_RATE_LIMIT = { limit: 10, windowSec: 60 } as const
export const BACKUP_SYNC_RATE_LIMIT = { limit: 120, windowSec: 60 } as const
export const BACKUP_UPLOAD_RATE_LIMIT = { limit: 60, windowSec: 60 } as const
export const BACKUP_HEARTBEAT_RATE_LIMIT = { limit: 30, windowSec: 60 } as const

export const SYNC_ROOT_KINDS = [
  "DESKTOP",
  "DOCUMENTS",
  "PICTURES",
  "VIDEOS",
  "MUSIC",
  "DOWNLOADS",
  "CUSTOM",
] as const

export type SyncRootKindInput = (typeof SYNC_ROOT_KINDS)[number]
