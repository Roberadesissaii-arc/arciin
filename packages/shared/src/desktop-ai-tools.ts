import {
  DESKTOP_APPROVAL_REQUIRED_TOOL_NAMES,
  DESKTOP_METADATA_TOOL_NAMES,
  DESKTOP_TOOL_MAX_LIST_ENTRIES,
  DESKTOP_TOOL_MAX_SEARCH_ENTRIES,
  DESKTOP_TOOL_MAX_RESULT_BYTES,
  DESKTOP_TOOL_NAMES,
  type DesktopToolName,
} from "@arciin/config"
import type { DesktopToolEntry, DesktopToolErrorCode } from "@arciin/types"

const WINDOWS_DRIVE_ABS = /(^|[\\/])[a-zA-Z]:[\\/]/
const UNC_ABS = /(^|[\\/])\\\\|^\/\//
const FORBIDDEN_RESULT_KEYS = new Set([
  "contents",
  "content",
  "base64",
  "binary",
  "filecontents",
  "textcontent",
  "absolutepath",
  "fullpath",
  "localpath",
  "windowspath",
  "fileid",
  "volumeserial",
  "volumeserialnumber",
  "ntfsfileid",
  "ownersid",
  "username",
  "user",
])

export const DESKTOP_CHAT_TOOL_NAMES: readonly DesktopToolName[] = DESKTOP_TOOL_NAMES

export function isDesktopChatToolName(name: string | undefined): name is DesktopToolName {
  return Boolean(name && (DESKTOP_TOOL_NAMES as readonly string[]).includes(name))
}

export function isDesktopMetadataTool(name: string): boolean {
  return (DESKTOP_METADATA_TOOL_NAMES as readonly string[]).includes(name)
}

export function desktopToolRequiresConfirmation(name: string): boolean {
  return (DESKTOP_APPROVAL_REQUIRED_TOOL_NAMES as readonly string[]).includes(name)
}

export function allDesktopToolsWithheld(): Set<string> {
  return new Set(DESKTOP_TOOL_NAMES)
}

/**
 * When This PC is enabled for an eligible Device, metadata tools are visible.
 * Confirmation-class tools are also visible so the model can request them, but
 * execution still requires an explicit `confirmed: true` argument.
 */
export function desktopToolsWithheldWhenEnabled(): Set<string> {
  return new Set()
}

export function stringLooksLikeWindowsAbsolutePath(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return true
  if (trimmed.startsWith("\\\\") || trimmed.startsWith("//")) return true
  if (WINDOWS_DRIVE_ABS.test(trimmed) || UNC_ABS.test(trimmed)) return true
  return false
}

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

function walkForbidden(value: unknown, path: string[]): DesktopToolErrorCode | null {
  if (value == null) return null
  if (typeof value === "string") {
    if (stringLooksLikeWindowsAbsolutePath(value)) return "DESKTOP_RESULT_INVALID"
    return null
  }
  if (typeof value === "number" || typeof value === "boolean") return null
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const nested = walkForbidden(item, [...path, String(i)])
      if (nested) return nested
    }
    return null
  }
  if (typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_RESULT_KEYS.has(key.toLowerCase())) return "DESKTOP_RESULT_INVALID"
      const nested = walkForbidden(nestedValue, [...path, key])
      if (nested) return nested
    }
  }
  return null
}

export type SanitizedDesktopToolResult =
  | { ok: true; result: unknown }
  | { ok: false; code: DesktopToolErrorCode; message: string }

export function sanitizeDesktopToolResultPayload(
  payload: unknown,
  tool: DesktopToolName,
): SanitizedDesktopToolResult {
  if (payload == null) {
    return { ok: true, result: payload }
  }
  try {
    if (jsonByteLength(payload) > DESKTOP_TOOL_MAX_RESULT_BYTES) {
      return {
        ok: false,
        code: "DESKTOP_RESULT_INVALID",
        message: "The Desktop result was too large.",
      }
    }
  } catch {
    return {
      ok: false,
      code: "DESKTOP_RESULT_INVALID",
      message: "The Desktop result could not be read.",
    }
  }

  const forbidden = walkForbidden(payload, [])
  if (forbidden) {
    return {
      ok: false,
      code: forbidden,
      message: "The Desktop result contained disallowed fields or absolute paths.",
    }
  }

  if (tool === "desktop.list_directory" || tool === "desktop.search_files") {
    const entries = extractEntries(payload)
    if (entries) {
      const max =
        tool === "desktop.search_files"
          ? DESKTOP_TOOL_MAX_SEARCH_ENTRIES
          : DESKTOP_TOOL_MAX_LIST_ENTRIES
      if (entries.length > max) {
        return {
          ok: false,
          code: "DESKTOP_RESULT_INVALID",
          message: "The Desktop result listed too many entries.",
        }
      }
    }
  }

  return { ok: true, result: payload }
}

function extractEntries(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === "object" && Array.isArray((payload as { entries?: unknown }).entries)) {
    return (payload as { entries: unknown[] }).entries
  }
  return null
}

export function desktopOfflineToolError(): {
  error: DesktopToolErrorCode
  message: string
} {
  return {
    error: "DESKTOP_OFFLINE",
    message: "I can't reach this PC right now.",
  }
}

export const DESKTOP_CHAT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "desktop.list_directory",
      description:
        "List files and folders inside a granted This PC scope. Use an opaque scopeId and a root-relative path only — never a Windows absolute path.",
      parameters: {
        type: "object",
        properties: {
          scopeId: { type: "string", description: "Opaque native scope/root id granted by Desktop." },
          relativePath: {
            type: "string",
            description: "Path relative to that scope. Empty string means the scope root.",
          },
        },
        required: ["scopeId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "desktop.search_files",
      description:
        "Search granted This PC scopes by name. Returns metadata only — never file contents or absolute paths.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Filename or fragment to search for." },
          scopeIds: {
            type: "array",
            items: { type: "string" },
            description: "Opaque scope ids the user granted. Required.",
          },
          kind: { type: "string", description: "Optional filter: file | folder" },
          limit: { type: "number", description: "Max matches (capped by the server)." },
        },
        required: ["query", "scopeIds"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "desktop.stat_file",
      description: "Read metadata for one granted This PC entry. No file contents.",
      parameters: {
        type: "object",
        properties: {
          scopeId: { type: "string" },
          relativePath: { type: "string" },
        },
        required: ["scopeId", "relativePath"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "desktop.open_path",
      description:
        "Ask Desktop to open a granted path in the local UI. Requires confirmation. Native Desktop is the final gate.",
      parameters: {
        type: "object",
        properties: {
          scopeId: { type: "string" },
          relativePath: { type: "string" },
          confirmed: { type: "boolean", description: "Must be true after the user confirms." },
        },
        required: ["scopeId", "relativePath"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "desktop.upload_file_to_arciin",
      description:
        "Ask Desktop to upload one granted file into Arciin. Requires explicit confirmation. Bytes never leave the PC without native confirmation.",
      parameters: {
        type: "object",
        properties: {
          scopeId: { type: "string" },
          relativePath: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["scopeId", "relativePath"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "desktop.enable_backup_for_folder",
      description:
        "Ask Desktop to protect a granted folder with Computer Backup. Reuses the existing backup lifecycle. Requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          scopeId: { type: "string" },
          relativePath: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["scopeId"],
      },
    },
  },
]

export type { DesktopToolEntry, DesktopToolName }
