export type DesktopAiToolsCapability = {
  supported: boolean
  protocolVersion: number
}

export type DesktopToolErrorCode =
  | "DESKTOP_OFFLINE"
  | "DESKTOP_TOOL_TIMEOUT"
  | "DESKTOP_TOOL_DENIED"
  | "DESKTOP_SCOPE_DENIED"
  | "DESKTOP_PATH_NOT_FOUND"
  | "DESKTOP_TOOL_UNSUPPORTED"
  | "DESKTOP_RESULT_INVALID"
  | "DESKTOP_REQUEST_EXPIRED"

export type DesktopToolStatus = "ok" | "error" | "denied"

export type DesktopToolRequest = {
  id: string
  version: number
  deviceId: string
  conversationId: string | null
  tool: string
  arguments: Record<string, unknown>
  /** Server-side class: metadata tools vs native confirmation. */
  confirmation: "none" | "required"
  createdAt: string
  expiresAt: string
}

export type DesktopToolResult = {
  requestId: string
  status: DesktopToolStatus
  result?: unknown
  error?: {
    code: DesktopToolErrorCode
    message: string
  }
  completedAt: string
}

export type DesktopToolEntry = {
  name: string
  kind: "file" | "folder"
  relativePath: string
  size: number | null
  modifiedAt: string | null
  scopeId: string
}
