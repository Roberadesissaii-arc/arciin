import { type ElementType, type ReactNode } from "react"
import {
  CircleCheck,
  CloudUpload,
  Download,
  FingerprintPattern,
  Info,
  LayoutDashboard,
  Link2,
  Loader2,
  Pencil,
  Trash2,
  TriangleAlert,
  Ban,
  Shield,
  Smartphone,
} from "lucide-react"
import { toast } from "sonner"

import {
  deleteCopy,
  fileUpdatedCopy,
  folderCreatedCopy,
  folderCredentialErrorCopy,
  folderLockedCopy,
  folderLockRemovedCopy,
  folderRenamedCopy,
  folderUnlockedCopy,
  assetsMovedCopy,
  importFailedCopy,
  importFileCopy,
  importStartedCopy,
  uploadBatchCopy,
  uploadStartedCopy,
  uploadBatchFailedCopy,
  uploadFailedCopy,
  uploadFileCopy,
  uploadMobileFileCopy,
  uploadFolderPrepareCopy,
  ipPolicyToastCopy,
  accountToastCopy,
  accountErrorCopy,
  apiKeyToastCopy,
  apiKeyErrorCopy,
  welcomeBackCopy,
  type DeleteToastKind,
  type IpPolicyAction,
  type AccountToastKind,
  type AccountErrorKind,
  type ApiKeyToastKind,
} from "@/lib/notifications/toast-copy"
import { toastLucideIcon, toastSourceIcon } from "@/lib/notifications/toast-icon"
import {
  ACCOUNT_ERROR_ICON,
  ACCOUNT_TOAST_CLASS,
  ACCOUNT_TOAST_ICON,
  API_KEY_ICON,
  FOLDER_TOAST_ICONS,
  toastSurfaceClass,
} from "@/lib/notifications/toast-registry"
import { formatSecurityIpToastDescription } from "@/lib/security/ip-forbidden"

export const UPLOAD_LIFECYCLE_TOAST_ID = "arciin-upload-lifecycle"
export const IMPORT_LIFECYCLE_TOAST_ID = "arciin-import-lifecycle"
export const TOAST_SETTINGS_PREVIEW_ID = "arciin-settings-preview"

/** @deprecated Use UPLOAD_LIFECYCLE_TOAST_ID */
export const UPLOAD_PENDING_TOAST_ID = UPLOAD_LIFECYCLE_TOAST_ID

function toastIcon(Icon: ElementType) {
  return toastLucideIcon(Icon)
}

function actionToast(
  title: string,
  options: {
    description?: ReactNode
    className: string
    icon: ReactNode
    duration?: number
    id?: string | number
  },
) {
  return toast(title, {
    description: options.description,
    className: options.className,
    icon: options.icon,
    duration: options.duration ?? 4800,
    id: options.id,
  })
}

export function dismissUploadPendingToast() {
  toast.dismiss(UPLOAD_LIFECYCLE_TOAST_ID)
}

export function dismissImportLifecycleToast() {
  toast.dismiss(IMPORT_LIFECYCLE_TOAST_ID)
}

export function notifyUploadStarted(fileName?: string, count?: number) {
  const copy = uploadStartedCopy(fileName, count)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("uploadPending"),
    icon: toastIcon(Loader2),
    duration: 3800,
    id: UPLOAD_LIFECYCLE_TOAST_ID,
  })
}

export function notifyUploadFolderPrepare(count: number) {
  const copy = uploadFolderPrepareCopy(count)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("uploadPending"),
    icon: toastIcon(CloudUpload),
    duration: 3200,
    id: UPLOAD_LIFECYCLE_TOAST_ID,
  })
}

export function notifyFileUploaded(
  fileName: string,
  destination?: string,
  id: string = UPLOAD_LIFECYCLE_TOAST_ID,
) {
  const copy = uploadFileCopy(fileName, destination)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("upload"),
    icon: toastIcon(CloudUpload),
    id,
  })
}

export function notifyMobileFileUploaded(
  fileName: string,
  destination?: string,
  id?: string | number,
) {
  const copy = uploadMobileFileCopy(fileName, destination)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("upload"),
    icon: toastIcon(Smartphone),
    duration: 5200,
    id,
  })
}

export function notifyLinkImported(
  fileName: string,
  destination?: string,
  sourceKey?: string,
) {
  dismissImportLifecycleToast()
  const copy = importFileCopy(fileName, destination)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("importComplete"),
    icon: sourceKey
      ? toastSourceIcon(sourceKey, { fallback: Download })
      : toastIcon(Download),
    duration: 5200,
  })
}

export function notifyUploadComplete(succeeded: number, total?: number) {
  const copy = uploadBatchCopy(succeeded, total ?? succeeded)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("upload"),
    icon: toastIcon(CloudUpload),
    duration: 5200,
    id: UPLOAD_LIFECYCLE_TOAST_ID,
  })
}

type ToastMeta = { id?: string | number; duration?: number }

export function notifySuccess(title: string, description?: string, meta?: ToastMeta) {
  return actionToast(title, {
    description,
    className: toastSurfaceClass("success"),
    icon: toastIcon(CircleCheck),
    duration: meta?.duration ?? 4200,
    id: meta?.id,
  })
}

export function notifyError(title: string, description?: string, meta?: ToastMeta) {
  return actionToast(title, {
    description,
    className: toastSurfaceClass("failed"),
    icon: toastIcon(TriangleAlert),
    duration: meta?.duration ?? 5000,
    id: meta?.id,
  })
}

export function notifyWarning(title: string, description?: string, meta?: ToastMeta) {
  return actionToast(title, {
    description,
    className: "arciin-action-toast",
    icon: toastIcon(TriangleAlert),
    duration: meta?.duration ?? 5000,
    id: meta?.id,
  })
}

export function notifyInfo(title: string, description?: string, meta?: ToastMeta) {
  return actionToast(title, {
    description,
    className: "arciin-action-toast",
    icon: toastIcon(Info),
    duration: meta?.duration ?? 4200,
    id: meta?.id,
  })
}

export function notifyPasswordSaved(count: number) {
  const title = count === 1 ? "1 credential saved" : `${count} credentials saved`
  return actionToast(title, {
    description: "Open Passwords in the sidebar to view.",
    className: toastSurfaceClass("password"),
    icon: toastIcon(FingerprintPattern),
    duration: 4800,
  })
}

export function notifyPasswordVault(title: string, description?: string) {
  return actionToast(title, {
    description,
    className: toastSurfaceClass("password"),
    icon: toastIcon(FingerprintPattern),
    duration: 4200,
  })
}

export function notifyPasswordVaultError(title: string, description?: string) {
  return actionToast(title, {
    description,
    className: toastSurfaceClass("failed"),
    icon: toastIcon(FingerprintPattern),
    duration: 5000,
  })
}

export function notifyAccount(kind: AccountToastKind, options?: { count?: number }) {
  const copy = accountToastCopy(kind, options)
  return actionToast(copy.title, {
    description: copy.description,
    className: ACCOUNT_TOAST_CLASS[kind],
    icon: toastIcon(ACCOUNT_TOAST_ICON[kind]),
    duration: 4200,
  })
}

export function notifyAccountError(kind: AccountErrorKind, message?: string) {
  const copy = accountErrorCopy(kind, message)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("failed"),
    icon: toastIcon(ACCOUNT_ERROR_ICON[kind]),
    duration: 5000,
  })
}

export function notifyWelcomeBack() {
  const copy = welcomeBackCopy()
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("welcome"),
    icon: toastIcon(LayoutDashboard),
    duration: 4200,
  })
}

export function notifyUploadFailed(fileName?: string, error?: string) {
  const copy = uploadFailedCopy(fileName, error)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("failed"),
    icon: toastIcon(TriangleAlert),
    duration: 6000,
  })
}

export function notifyImportFailed(fileName?: string, error?: string, sourceKey?: string) {
  dismissImportLifecycleToast()
  const copy = importFailedCopy(fileName, error)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("importFailed"),
    icon: sourceKey
      ? toastSourceIcon(sourceKey, { fallback: Link2 })
      : toastIcon(Link2),
    duration: 8000,
  })
}

export function notifyImportStarted(sourceKey?: string, sourceLabel?: string) {
  const copy = importStartedCopy(sourceLabel)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("importPending"),
    icon: sourceKey
      ? toastSourceIcon(sourceKey, { fallback: Link2, label: sourceLabel })
      : toastIcon(Link2),
    duration: 5200,
    id: IMPORT_LIFECYCLE_TOAST_ID,
  })
}

export function notifyDeleted(options?: { kind?: DeleteToastKind; count?: number }) {
  const copy = deleteCopy(options)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("delete"),
    icon: toastIcon(Trash2),
    duration: 4200,
  })
}

export function notifyFileUpdated(detail?: string) {
  const copy = fileUpdatedCopy(detail)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("updated"),
    icon: toastIcon(Pencil),
    duration: 4200,
  })
}

export function notifyFolderCreated(folderName: string, locked?: boolean) {
  const copy = folderCreatedCopy(folderName, locked)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("folderCreated"),
    icon: toastIcon(FOLDER_TOAST_ICONS.created),
    duration: 4800,
  })
}

export function notifyFolderLocked(folderName?: string) {
  const copy = folderLockedCopy(folderName)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("folderLocked"),
    icon: toastIcon(FOLDER_TOAST_ICONS.locked),
    duration: 4800,
  })
}

export function notifyFolderUnlocked(folderName?: string) {
  const copy = folderUnlockedCopy(folderName)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("folderUnlocked"),
    icon: toastIcon(FOLDER_TOAST_ICONS.unlocked),
    duration: 4800,
  })
}

export function notifyFolderLockRemoved(folderName?: string) {
  const copy = folderLockRemovedCopy(folderName)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("folderLockRemoved"),
    icon: toastIcon(FOLDER_TOAST_ICONS.lockRemoved),
    duration: 4800,
  })
}

export function notifyFolderRenamed(folderName: string) {
  const copy = folderRenamedCopy(folderName)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("folderRenamed"),
    icon: toastIcon(FOLDER_TOAST_ICONS.renamed),
    duration: 4200,
  })
}

export function notifyFolderCredentialError(message?: string) {
  const copy = folderCredentialErrorCopy(message)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("failed"),
    icon: toastIcon(FOLDER_TOAST_ICONS.credentialError),
    duration: 6000,
  })
}

function isFolderCredentialMessage(message?: string): boolean {
  if (!message) return false
  return (
    message.includes("Incorrect account password") ||
    message.includes("Incorrect vault PIN")
  )
}

export function notifyFolderActionError(
  error: unknown,
  fallbackTitle = "Could not complete folder action",
) {
  const message = error instanceof Error ? error.message : undefined
  if (isFolderCredentialMessage(message)) {
    return notifyFolderCredentialError(message)
  }
  return notifyError(fallbackTitle, message ?? "Something went wrong. Try again.")
}

export function notifyAssetsMoved(count: number, destination?: string) {
  const copy = assetsMovedCopy(count, destination)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("success"),
    icon: toastIcon(CircleCheck),
    duration: 4200,
  })
}

export function notifyIpBlocked(title: string, description: string, meta?: ToastMeta) {
  return actionToast(title, {
    description,
    className: toastSurfaceClass("ipBlocked"),
    icon: toastIcon(Ban),
    duration: meta?.duration ?? 4800,
    id: meta?.id,
  })
}

export function notifyIpPolicy(action: IpPolicyAction, ip: string, meta?: ToastMeta) {
  const copy = ipPolicyToastCopy(action, ip)
  const isDeny = action === "blocked" || action === "disallowlisted"
  return actionToast(copy.title, {
    description: copy.description,
    className: isDeny
      ? toastSurfaceClass("ipBlocked")
      : toastSurfaceClass("ipAllowed"),
    icon: toastIcon(isDeny ? Ban : Shield),
    duration: meta?.duration ?? (isDeny ? 4800 : 4200),
    id: meta?.id,
  })
}

/** @deprecated Use notifyIpPolicy("unblocked" | "allowlisted", ip) */
export function notifyIpUnblocked(title: string, description: string, meta?: ToastMeta) {
  return actionToast(title, {
    description,
    className: toastSurfaceClass("ipAllowed"),
    icon: toastIcon(Shield),
    duration: meta?.duration ?? 4200,
    id: meta?.id,
  })
}

export function notifyApiRequestBlocked(title: string, description?: string, meta?: ToastMeta) {
  return actionToast(title || "API request blocked", {
    description:
      formatSecurityIpToastDescription(description) ??
      "A client was denied by your perimeter policy.",
    className: toastSurfaceClass("ipBlocked"),
    icon: toastIcon(Ban),
    duration: meta?.duration ?? 5000,
    id: meta?.id,
  })
}

export function notifyApiKey(kind: ApiKeyToastKind, options?: { name?: string }) {
  const copy = apiKeyToastCopy(kind, options)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("apiKey"),
    icon: toastIcon(API_KEY_ICON),
    duration: 4800,
    id: `arciin-api-key-${kind}`,
  })
}

export function notifyApiKeyError(message?: string) {
  const copy = apiKeyErrorCopy(message)
  return actionToast(copy.title, {
    description: copy.description,
    className: toastSurfaceClass("failed"),
    icon: toastIcon(API_KEY_ICON),
    duration: 5000,
  })
}

export { uploadBatchFailedCopy, type IpPolicyAction }
