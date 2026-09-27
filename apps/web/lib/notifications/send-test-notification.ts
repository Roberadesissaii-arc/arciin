import { toast } from "@/lib/notifications/arciin-toast"

import {
  getNotificationPreferences,
  shouldPlayUploadSound,
  shouldShowActivityFeedToast,
  shouldShowSecurityEventsToast,
  shouldShowUploadCompleteToast,
  shouldShowUploadFailedToast,
} from "@/lib/preferences/notification-policy"
import {
  notifyUploadComplete,
  notifyUploadFailed,
} from "@/lib/notifications/toast-actions"
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
        toast.info("Upload complete toasts are off", {
          description: "Enable the toggle above, then try again.",
        })
        return false
      }
      notifyUploadComplete(1, 1)
      return true
    case "upload-failed":
      if (!prefs.uploadFailedToast) {
        toast.info("Upload failed toasts are off", {
          description: "Enable the toggle above, then try again.",
        })
        return false
      }
      notifyUploadFailed(undefined, "This is what you see when an upload errors.")
      return true
    case "upload-sound":
      if (!prefs.uploadSound) {
        toast.info("Upload sound is off", {
          description: "Enable the toggle above, then try again.",
        })
        return false
      }
      void playUploadCompleteSound()
      toast.info("Test: upload sound", {
        description: "Played the completion tone for this browser.",
      })
      return true
    case "activity":
      if (!prefs.activityFeedToast) {
        toast.info("Activity toasts are off", {
          description: "Enable the toggle above, then try again.",
        })
        return false
      }
      toast.info("Test: activity event", {
        description: "Live activity from uploads and the API will look like this.",
      })
      return true
    case "security":
      if (!prefs.securityEventsToast) {
        toast.info("Security toasts are off", {
          description: "Enable the toggle above, then try again.",
        })
        return false
      }
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
    toast.info("All notification channels are off", {
      description: "Turn on at least one toggle to run a test.",
    })
  }
  return sent
}
