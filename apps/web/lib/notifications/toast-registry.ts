import type { ElementType } from "react"
import {
  CircleCheck,
  CloudUpload,
  Download,
  Eye,
  EyeOff,
  FingerprintPattern,
  FolderLock,
  FolderOpen,
  FolderPlus,
  Info,
  Key,
  LayoutDashboard,
  Link2,
  Loader2,
  LockOpen,
  Pencil,
  Trash2,
  TriangleAlert,
  Ban,
  Shield,
  User,
  Camera,
  KeyRound,
  ShieldCheck,
  Monitor,
  LogOut,
} from "lucide-react"

import type { AccountToastKind, AccountErrorKind } from "@/lib/notifications/toast-copy"

/** Visual surface modifiers — one place for every action toast look. */
export const TOAST_SURFACE = {
  importPending: "arciin-action-toast arciin-action-toast--import-pending",
  importComplete: "arciin-action-toast arciin-action-toast--import",
  importFailed: "arciin-action-toast arciin-action-toast--import-failed",
  uploadPending: "arciin-action-toast arciin-action-toast--upload-pending",
  upload: "arciin-action-toast arciin-action-toast--upload",
  success: "arciin-action-toast arciin-action-toast--success",
  failed: "arciin-action-toast arciin-action-toast--failed",
  updated: "arciin-action-toast arciin-action-toast--updated",
  delete: "arciin-action-toast arciin-action-toast--delete",
  folderCreated: "arciin-action-toast arciin-action-toast--folder-created",
  folderLocked: "arciin-action-toast arciin-action-toast--folder-locked",
  folderUnlocked: "arciin-action-toast arciin-action-toast--folder-unlocked",
  folderLockRemoved: "arciin-action-toast arciin-action-toast--folder-lock-removed",
  folderRenamed: "arciin-action-toast arciin-action-toast--folder-renamed",
  folderHidden: "arciin-action-toast arciin-action-toast--folder-hidden",
  folderShown: "arciin-action-toast arciin-action-toast--folder-shown",
  welcome: "arciin-action-toast arciin-action-toast--welcome",
  password: "arciin-action-toast arciin-action-toast--password",
  account: "arciin-action-toast arciin-action-toast--account",
  accountPassword: "arciin-action-toast arciin-action-toast--account-password",
  accountSecurity: "arciin-action-toast arciin-action-toast--account-security",
  accountSessions: "arciin-action-toast arciin-action-toast--account-sessions",
  apiKey: "arciin-action-toast arciin-action-toast--api-key",
  ipBlocked: "arciin-action-toast arciin-action-toast--ip-blocked",
  ipAllowed: "arciin-action-toast arciin-action-toast--ip-allowed",
  shareFeedback: "arciin-action-toast arciin-action-toast--share-feedback",
  update: "arciin-action-toast arciin-action-toast--update",
  default: "arciin-action-toast",
} as const

export type ToastSurfaceKey = keyof typeof TOAST_SURFACE

export function toastSurfaceClass(key: ToastSurfaceKey): string {
  return `arciin-toast ${TOAST_SURFACE[key]}`
}

export const FOLDER_TOAST_ICONS = {
  created: FolderPlus,
  locked: FolderLock,
  unlocked: FolderOpen,
  lockRemoved: LockOpen,
  renamed: Pencil,
  credentialError: TriangleAlert,
  hidden: EyeOff,
  shown: Eye,
} as const

export const ACCOUNT_TOAST_CLASS: Record<AccountToastKind, string> = {
  profile_updated: toastSurfaceClass("account"),
  photo_updated: toastSurfaceClass("account"),
  photo_removed: toastSurfaceClass("account"),
  password_updated: toastSurfaceClass("accountPassword"),
  recovery_saved: toastSurfaceClass("accountSecurity"),
  session_revoked: toastSurfaceClass("accountSessions"),
  sessions_revoked_all: toastSurfaceClass("accountSessions"),
}

export const ACCOUNT_TOAST_ICON: Record<AccountToastKind, ElementType> = {
  profile_updated: User,
  photo_updated: Camera,
  photo_removed: User,
  password_updated: KeyRound,
  recovery_saved: ShieldCheck,
  session_revoked: Monitor,
  sessions_revoked_all: LogOut,
}

export const ACCOUNT_ERROR_ICON: Record<AccountErrorKind, ElementType> = {
  profile: User,
  photo_upload: Camera,
  photo_remove: User,
  password: KeyRound,
  recovery: ShieldCheck,
  session: Monitor,
  sign_out: LogOut,
}

export const API_KEY_ICON = Key

export const CORE_TOAST_ICONS = {
  success: CircleCheck,
  error: TriangleAlert,
  warning: TriangleAlert,
  info: Info,
  upload: CloudUpload,
  uploadPending: Loader2,
  import: Download,
  importPending: Link2,
  importFailed: Link2,
  delete: Trash2,
  updated: Pencil,
  moved: CircleCheck,
  welcome: LayoutDashboard,
  password: FingerprintPattern,
  ipBlocked: Ban,
  ipAllowed: Shield,
} as const
