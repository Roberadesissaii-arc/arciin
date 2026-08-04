function truncateFileName(name: string, max = 48): string {
  const trimmed = name.trim()
  if (trimmed.length <= max) return trimmed
  const dot = trimmed.lastIndexOf(".")
  if (dot > 0 && trimmed.length - dot <= 8) {
    const ext = trimmed.slice(dot)
    const base = trimmed.slice(0, max - ext.length - 1)
    return `${base}…${ext}`
  }
  return `${trimmed.slice(0, max - 1)}…`
}

export function uploadStartedCopy(fileName?: string, count?: number) {
  if (count && count > 1) {
    return {
      title: "Upload started",
      description: `${count} files are being sent to your server. Track progress in the upload queue below.`,
    }
  }
  const file = fileName ? truncateFileName(fileName) : "Your file"
  return {
    title: "Upload started",
    description: `${file} is being sent to your server. Track progress in the upload queue below.`,
  }
}

export function uploadFolderPrepareCopy(count: number) {
  return {
    title: "Preparing folder upload",
    description:
      count === 1
        ? "Arciin is setting up the folder structure before sending your file."
        : `Arciin is setting up folders for ${count} files before upload begins.`,
  }
}

export function uploadFileCopy(fileName: string, destination?: string) {
  const file = truncateFileName(fileName)
  const where = destination ? ` in ${destination}` : " to your library"
  return {
    title: "File uploaded",
    description: `${file} was saved${where}. Arciin detected the type and placed it where it belongs.`,
  }
}

export function uploadMobileFileCopy(fileName: string, destination?: string) {
  const file = truncateFileName(fileName)
  const where = destination ? ` in ${destination}` : " to your library"
  return {
    title: "Uploaded from your phone",
    description: `${file} was sent from Arciin mobile and saved${where}.`,
  }
}

export function importFileCopy(fileName: string, destination?: string) {
  const file = truncateFileName(fileName)
  const where = destination ? ` to ${destination}` : " to your library"
  return {
    title: "Link downloaded",
    description: `Arciin fetched ${file} from the link and saved it${where}. The file is ready to browse.`,
  }
}

export function uploadBatchCopy(succeeded: number, total: number) {
  if (total === 1) {
    return {
      title: "File uploaded",
      description:
        "Your file was saved on the server. Arciin classified it and added it to the right library.",
    }
  }
  return {
    title: `${succeeded} files uploaded`,
    description: `All ${succeeded} files were saved on your server. Arciin sorted each one into the correct library.`,
  }
}

export function uploadBatchFailedCopy(error?: string) {
  return {
    title: "Upload failed",
    description:
      error ??
      "Arciin could not save the file. Check your connection and try again, or see upload.log on the server.",
  }
}

export function uploadFailedCopy(fileName: string | undefined, error?: string) {
  const file = fileName ? truncateFileName(fileName) : null
  return {
    title: file ? `${file} could not upload` : "Upload failed",
    description:
      error ??
      "Something went wrong while saving the file. Try again or check upload.log on the server.",
  }
}

export function importFailedCopy(fileName: string | undefined, error?: string) {
  const file = fileName ? truncateFileName(fileName) : null
  return {
    title: file ? `${file} could not download` : "Link download failed",
    description:
      error ??
      "Arciin could not fetch this link. Check that the URL is public, then try again. See Jobs for details.",
  }
}

export function importStartedCopy(sourceLabel?: string) {
  const title = sourceLabel ? `Downloading from ${sourceLabel}` : "Downloading from link"
  return {
    title,
    description:
      "Arciin is fetching this file in the background. You will get another notice when it is ready.",
  }
}

export type DeleteToastKind =
  | "file"
  | "files"
  | "folder"
  | "webhook"
  | "database"
  | "row"
  | "vault"

export function deleteCopy(options?: { kind?: DeleteToastKind; count?: number }) {
  const kind = options?.kind ?? "file"
  const count = options?.count ?? 1

  switch (kind) {
    case "files":
      return {
        title: count === 1 ? "Moved to Trash" : `${count} files moved to Trash`,
        description:
          count === 1
            ? "The file is in Settings → Trash for 30 days. Restore it anytime, or it deletes itself after that."
            : `${count} files are in Settings → Trash for 30 days. Restore them anytime, or they delete themselves after that.`,
      }
    case "folder":
      return {
        title: "Folder deleted",
        description:
          "The folder and everything inside it were removed from your library.",
      }
    case "webhook":
      return {
        title: "Webhook deleted",
        description: "The webhook was removed. Arciin will no longer send events to that URL.",
      }
    case "database":
      return {
        title: "Database deleted",
        description: "The database and its tables were removed from this instance.",
      }
    case "row":
      return {
        title: "Row deleted",
        description: "The row was removed from the table in PostgreSQL.",
      }
    case "vault":
      return {
        title: "Vault cleared",
        description: `${count} saved ${count === 1 ? "entry was" : "entries were"} removed from the password vault.`,
      }
    default:
      return {
        title: "Moved to Trash",
        description:
          "The file is in Settings → Trash for 30 days. Restore it anytime, or it deletes itself after that.",
      }
  }
}

export function fileUpdatedCopy(detail?: string) {
  return {
    title: "File updated",
    description:
      detail ??
      "Your changes were saved. The new name and badge settings are now visible on the file.",
  }
}

function truncateFolderName(name: string, max = 40): string {
  const trimmed = name.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

export function folderCreatedCopy(folderName: string, locked?: boolean) {
  const name = truncateFolderName(folderName)
  if (locked) {
    return {
      title: "Folder created and locked",
      description: `${name} is ready in your library. Enter your password or vault PIN to open it on any device.`,
    }
  }
  return {
    title: "Folder created",
    description: `${name} is ready in your library. Drop files here or move assets into it.`,
  }
}

export function folderLockedCopy(folderName?: string) {
  const name = folderName ? truncateFolderName(folderName) : "This folder"
  return {
    title: "Folder locked",
    description: `${name} now requires your account password or vault PIN to open.`,
  }
}

export function folderUnlockedCopy(folderName?: string) {
  const name = folderName ? truncateFolderName(folderName) : "This folder"
  return {
    title: "Folder unlocked",
    description: `You can browse ${name} for the next 15 minutes on this device.`,
  }
}

export function folderLockRemovedCopy(folderName?: string) {
  const name = folderName ? truncateFolderName(folderName) : "This folder"
  return {
    title: "Folder lock removed",
    description: `${name} is open for everyone with library access again.`,
  }
}

export function folderRenamedCopy(folderName: string) {
  const name = truncateFolderName(folderName)
  return {
    title: "Folder renamed",
    description: `The folder is now called ${name}. Links and paths were updated.`,
  }
}

export function folderHiddenFromAllFilesCopy(folderName: string) {
  const name = truncateFolderName(folderName)
  return {
    title: "Hidden from All Files",
    description: `${name} and its subfolders stay in your library — open the folder to browse. They no longer appear in All Files or Overview.`,
  }
}

export function folderShownInAllFilesCopy(folderName: string) {
  const name = truncateFolderName(folderName)
  return {
    title: "Shown in All Files",
    description: `${name} and its subfolders appear again in All Files and Overview recent uploads.`,
  }
}

export function folderCredentialErrorCopy(message?: string) {
  return {
    title: "Could not verify credentials",
    description:
      message ??
      "Check your account password or vault PIN and try again.",
  }
}

export function assetsMovedCopy(count: number, destination?: string) {
  const where = destination ? ` to ${destination}` : ""
  if (count === 1) {
    return {
      title: "File moved",
      description: `The file was moved${where}. It should appear in the new location right away.`,
    }
  }
  return {
    title: `${count} files moved`,
    description: `All ${count} files were moved${where}. They should appear in the new location right away.`,
  }
}

export function welcomeBackCopy() {
  return {
    title: "Welcome back.",
    description: "You're signed in to your dashboard. Uploads, libraries, and activity are ready.",
  }
}

export type IpPolicyAction = "blocked" | "unblocked" | "allowlisted" | "disallowlisted"

export function ipPolicyToastCopy(action: IpPolicyAction, ip: string) {
  switch (action) {
    case "blocked":
      return {
        title: "IP blocked",
        description: `${ip} can no longer reach this instance. API and sign-in from that network are denied.`,
      }
    case "unblocked":
      return {
        title: "IP unblocked",
        description: `${ip} was removed from the blocklist and may connect again unless other rules apply.`,
      }
    case "allowlisted":
      return {
        title: "IP allowlisted",
        description: `${ip} is now permitted under your perimeter policy. That network can reach this instance.`,
      }
    case "disallowlisted":
      return {
        title: "Removed from allowlist",
        description: `${ip} is no longer on the allowlist. Access now follows your blocklist and remaining rules.`,
      }
  }
}

/** Pull a dotted IP (optional CIDR) from security log / realtime messages. */
export function extractClientIpFromSecurityText(text?: string): string | null {
  if (!text?.trim()) return null
  const match = text.match(/\b(\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?)\b/)
  return match?.[1] ?? null
}

export type AccountToastKind =
  | "profile_updated"
  | "photo_updated"
  | "photo_removed"
  | "password_updated"
  | "recovery_saved"
  | "session_revoked"
  | "sessions_revoked_all"

export function accountToastCopy(kind: AccountToastKind, options?: { count?: number }) {
  switch (kind) {
    case "profile_updated":
      return {
        title: "Profile updated",
        description: "Your display name and email are saved on this Arciin instance.",
      }
    case "photo_updated":
      return {
        title: "Profile photo updated",
        description: "Your avatar is visible in the sidebar and across the app.",
      }
    case "photo_removed":
      return {
        title: "Profile photo removed",
        description: "Arciin will show your initials until you upload a new photo.",
      }
    case "password_updated":
      return {
        title: "Password updated",
        description: "Your new password is active. Other signed-in devices keep their sessions until they expire or you revoke them.",
      }
    case "recovery_saved":
      return {
        title: "Security question saved",
        description: "Use it on the sign-in screen if you forget your password. Self-hosted instances cannot send email reset links.",
      }
    case "session_revoked": {
      const n = options?.count ?? 1
      return {
        title: n === 1 ? "Session revoked" : `${n} sessions revoked`,
        description:
          n === 1
            ? "That device was signed out and must log in again."
            : "Those devices were signed out and must log in again.",
      }
    }
    case "sessions_revoked_all":
      return {
        title: "Other sessions revoked",
        description: "Every device except this one was signed out. They will need to log in again.",
      }
  }
}

export type AccountErrorKind =
  | "profile"
  | "photo_upload"
  | "photo_remove"
  | "password"
  | "recovery"
  | "session"
  | "sign_out"

export function accountErrorCopy(kind: AccountErrorKind, message?: string) {
  const defaults: Record<AccountErrorKind, { title: string; description: string }> = {
    profile: {
      title: "Could not update profile",
      description: "Check your name and email, then try again.",
    },
    photo_upload: {
      title: "Could not upload photo",
      description: "Use JPEG, PNG, WebP, or GIF under the size limit.",
    },
    photo_remove: {
      title: "Could not remove photo",
      description: "Try again in a moment.",
    },
    password: {
      title: "Could not change password",
      description: "Verify your current password and that the new one is at least 8 characters.",
    },
    recovery: {
      title: "Could not save security question",
      description: "Use a question of at least 4 characters and an answer of at least 2.",
    },
    session: {
      title: "Could not revoke session",
      description: "The session may already have expired. Refresh the list and try again.",
    },
    sign_out: {
      title: "Could not sign out everywhere",
      description: "Try again or sign out from this device only.",
    },
  }
  const base = defaults[kind]
  return {
    title: base.title,
    description: message?.trim() || base.description,
  }
}

export type ApiKeyToastKind = "created" | "rotated" | "revoked" | "copied"

export function apiKeyToastCopy(kind: ApiKeyToastKind, options?: { name?: string }) {
  const name = options?.name?.trim()
  switch (kind) {
    case "created":
      return {
        title: "API key created",
        description: name
          ? `"${name}" is ready. Copy the secret now — Arciin will not show the full key again.`
          : "Copy the secret now — Arciin will not show the full key again.",
      }
    case "rotated":
      return {
        title: "API key rotated",
        description: name
          ? `"${name}" has a new secret. The previous value stopped working immediately.`
          : "The previous secret stopped working. Copy the new key from the panel on the right.",
      }
    case "revoked":
      return {
        title: "API key revoked",
        description: name
          ? `"${name}" can no longer authenticate. Replace it in any scripts or integrations that used it.`
          : "This key can no longer authenticate. Replace it in any scripts or integrations that used it.",
      }
    case "copied":
      return {
        title: "API key copied",
        description: "The full secret is on your clipboard. Store it somewhere safe before closing the panel.",
      }
  }
}

export function apiKeyErrorCopy(message?: string) {
  return {
    title: "API key action failed",
    description: message?.trim() || "Try again in a moment.",
  }
}
