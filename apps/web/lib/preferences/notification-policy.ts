import { DEFAULT_USER_PREFERENCES, type NotificationPreferences } from "@arciin/shared"

let active: NotificationPreferences = DEFAULT_USER_PREFERENCES.notifications

export function setNotificationPreferences(next: NotificationPreferences) {
  active = next
}

export function getNotificationPreferences() {
  return active
}

export function shouldShowUploadCompleteToast() {
  return active.uploadCompleteToast
}

export function shouldShowUploadFailedToast() {
  return active.uploadFailedToast
}

export function shouldPlayUploadSound() {
  return active.uploadSound
}

export function shouldShowActivityFeedToast() {
  return active.activityFeedToast
}

export function shouldShowSecurityEventsToast() {
  return active.securityEventsToast
}
