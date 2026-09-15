import {
  desktopToolRequiresConfirmation,
  isDesktopChatToolName,
} from "@arciin/shared"
import type { DesktopToolName } from "@arciin/config"

import { getDesktopToolHub } from "./hub"

export async function executeDesktopChatTool(input: {
  name: string
  args: Record<string, unknown>
  userId: string
  deviceId: string | null
  conversationId: string | null
}): Promise<Record<string, unknown>> {
  if (!isDesktopChatToolName(input.name)) {
    return { error: "DESKTOP_TOOL_UNSUPPORTED", message: "Unknown This PC tool." }
  }

  if (!input.deviceId) {
    return { error: "DESKTOP_TOOL_UNSUPPORTED", message: "This PC is not enabled for this turn." }
  }

  if (desktopToolRequiresConfirmation(input.name) && input.args.confirmed !== true) {
    return {
      error: "DESKTOP_TOOL_DENIED",
      needsConfirmation: true,
      message:
        input.name === "desktop.upload_file_to_arciin"
          ? "Uploading from this PC needs explicit confirmation."
          : input.name === "desktop.enable_backup_for_folder"
            ? "Turning on Computer Backup for a folder needs explicit confirmation."
            : "Opening a local path needs confirmation.",
    }
  }

  const result = await getDesktopToolHub().dispatch({
    deviceId: input.deviceId,
    conversationId: input.conversationId,
    tool: input.name as DesktopToolName,
    arguments: input.args,
  })

  if (result.status !== "ok") {
    return {
      error: result.error?.code ?? "DESKTOP_TOOL_DENIED",
      message: result.error?.message ?? "This PC request failed.",
    }
  }

  return { ok: true, result: result.result }
}
