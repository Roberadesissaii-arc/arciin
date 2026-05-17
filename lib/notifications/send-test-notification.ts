import { toast } from "sonner"

import {
  getNotificationPreferences,
  shouldPlayUploadSound,
  shouldShowActivityFeedToast,
  shouldShowSecurityEventsToast,
  shouldShowUploadCompleteToast,
  shouldShowUploadFailedToast,
} from "@/lib/preferences/notification-policy"
import { recordInboxNotification } from "@/lib/notifications/record-inbox-notification"
import { playUploadCompleteSound } from "@/lib/preferences/upload-sound"

export type NotificationTestKind =
  | "upload-complete"
  | "upload-failed"
  | "upload-sound"
  | "activity"
  | "security"

export function sendTestNotification(kind: NotificationTestKind) {
  const prefs = getNotificationPreferences()

  switch (kind) {
    case "upload-complete":
      if (!prefs.uploadCompleteToast) {
        toast.message("Upload complete toasts are off", {
          description: "Enable the toggle above, then try again.",
        })
        return false
      }
      recordInboxNotification({
        title: "Test: upload complete",
        message: "You would see this after a file finishes uploading.",
        variant: "success",
        source: "upload",
      })
      toast.success("Test: upload complete", {
        description: "You would see this after a file finishes uploading.",
      })
      return true
    case "upload-failed":
      if (!prefs.uploadFailedToast) {
        toast.message("Upload failed toasts are off", {
          description: "Enable the toggle above, then try again.",
        })
        return false
      }
      recordInboxNotification({
        title: "Test: upload failed",
        message: "You would see this when an upload errors.",
        variant: "error",
        source: "upload",
      })
      toast.error("Test: upload failed", {
        description: "You would see this when an upload errors.",
      })
      return true
    case "upload-sound":
      if (!prefs.uploadSound) {
        toast.message("Upload sound is off", {
          description: "Enable the toggle above, then try again.",
        })
        return false
      }
      void playUploadCompleteSound()
      toast.message("Test: upload sound", {
        description: "Played the completion tone for this browser.",
      })
      return true
    case "activity":
      if (!prefs.activityFeedToast) {
        toast.message("Activity toasts are off", {
          description: "Enable the toggle above, then try again.",
        })
        return false
      }
      recordInboxNotification({
        title: "Test: activity event",
        message: "Live activity from uploads and the API will look like this.",
        variant: "default",
        source: "activity",
      })
      toast.message("Test: activity event", {
        description: "Live activity from uploads and the API will look like this.",
      })
      return true
    case "security":
      if (!prefs.securityEventsToast) {
        toast.message("Security toasts are off", {
          description: "Enable the toggle above, then try again.",
        })
        return false
      }
      recordInboxNotification({
        title: "Test: security alert",
        message: "Failed sign-ins and similar events use this style when alerts are on.",
        variant: "warning",
        source: "security",
      })
      toast.warning("Test: security alert", {
        description: "Failed sign-ins and similar events use this style when alerts are on.",
      })
      return true
    default:
      return false
  }
}

export function notificationPrefsSummary() {
  const p = getNotificationPreferences()
  return {
    uploadCompleteToast: p.uploadCompleteToast,
    uploadFailedToast: p.uploadFailedToast,
    uploadSound: p.uploadSound,
    activityFeedToast: p.activityFeedToast,
    securityEventsToast: p.securityEventsToast,
  }
}

export function anyNotificationChannelEnabled() {
  const p = getNotificationPreferences()
  return (
    p.uploadCompleteToast ||
    p.uploadFailedToast ||
    p.uploadSound ||
    p.activityFeedToast ||
    p.securityEventsToast
  )
}

/** Respect toggles for a quick “all enabled types” smoke test. */
export function sendTestNotificationSuite() {
  let sent = 0
  if (shouldShowUploadCompleteToast() && sendTestNotification("upload-complete")) sent += 1
  if (shouldShowUploadFailedToast()) {
    window.setTimeout(() => {
      sendTestNotification("upload-failed")
    }, 400)
    sent += 1
  }
  if (shouldShowActivityFeedToast()) {
    window.setTimeout(() => {
      sendTestNotification("activity")
    }, 800)
    sent += 1
  }
  if (shouldShowSecurityEventsToast()) {
    window.setTimeout(() => {
      sendTestNotification("security")
    }, 1200)
    sent += 1
  }
  if (shouldPlayUploadSound()) {
    void playUploadCompleteSound()
    sent += 1
  }
  if (sent === 0) {
    toast.message("All notification channels are off", {
      description: "Turn on at least one toggle to run a test.",
    })
  }
  return sent
}
