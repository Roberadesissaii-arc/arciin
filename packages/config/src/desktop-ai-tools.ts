/** AI Desktop native-tool protocol. Independent of pairing and computer-backup versions. */
export const ARCIIN_AI_DESKTOP_TOOLS_PROTOCOL_VERSION = 1

export const DESKTOP_TOOL_SOCKET_PATH = "/desktop-tools"

export const DESKTOP_TOOL_REQUEST_EVENT = "desktop.tool.request"
export const DESKTOP_TOOL_RESULT_EVENT = "desktop.tool.result"

export const DESKTOP_TOOL_TIMEOUT_MS = 15_000
export const DESKTOP_TOOL_EXPIRY_MS = 20_000
export const DESKTOP_TOOL_MAX_CONCURRENT_PER_DEVICE = 2
export const DESKTOP_TOOL_MAX_PER_TURN = 4
export const DESKTOP_TOOL_MAX_RESULT_BYTES = 32_768
export const DESKTOP_TOOL_MAX_LIST_ENTRIES = 50
export const DESKTOP_TOOL_MAX_SEARCH_ENTRIES = 25
export const DESKTOP_TOOL_MAX_ARGUMENT_BYTES = 8_192

export const DESKTOP_TOOL_NAMES = [
  "desktop.list_directory",
  "desktop.search_files",
  "desktop.stat_file",
  "desktop.open_path",
  "desktop.upload_file_to_arciin",
  "desktop.enable_backup_for_folder",
] as const

export type DesktopToolName = (typeof DESKTOP_TOOL_NAMES)[number]

export const DESKTOP_METADATA_TOOL_NAMES = [
  "desktop.list_directory",
  "desktop.search_files",
  "desktop.stat_file",
] as const

export const DESKTOP_APPROVAL_REQUIRED_TOOL_NAMES = [
  "desktop.open_path",
  "desktop.upload_file_to_arciin",
  "desktop.enable_backup_for_folder",
] as const

export const AI_DESKTOP_COMPUTER_ACCESS_LEVELS = ["off", "metadata_only"] as const
export type AiDesktopComputerAccess = (typeof AI_DESKTOP_COMPUTER_ACCESS_LEVELS)[number]
